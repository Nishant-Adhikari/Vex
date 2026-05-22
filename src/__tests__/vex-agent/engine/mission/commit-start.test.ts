/**
 * Unit tests for `engine/mission/commit-start.ts`.
 *
 * Repos + tx helpers are mocked; the test exercises the atomic gate
 * + state-flip + createRun discriminated outcomes. Full DB-backed
 * integration coverage lands in phase 8.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetMissionForUpdate = vi.fn();
const mockSetStatus = vi.fn();
const mockSetApprovedAt = vi.fn();
const mockGetActiveRun = vi.fn();
const mockCreateRun = vi.fn();

vi.mock("@vex-agent/db/repos/missions.js", () => ({
  getMissionForUpdate: (...a: unknown[]) => mockGetMissionForUpdate(...a),
  setStatus: (...a: unknown[]) => mockSetStatus(...a),
  setApprovedAt: (...a: unknown[]) => mockSetApprovedAt(...a),
}));

vi.mock("@vex-agent/db/repos/mission-runs.js", () => ({
  getActiveRun: (...a: unknown[]) => mockGetActiveRun(...a),
  createRun: (...a: unknown[]) => mockCreateRun(...a),
}));

const fakeClientQuery = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });

vi.mock("@vex-agent/db/client.js", () => ({
  getPool: () => ({
    connect: async () => ({
      query: fakeClientQuery,
      release: vi.fn(),
    }),
  }),
  withTransaction: async (fn: (client: unknown) => Promise<unknown>) => {
    const fakeClient = { query: fakeClientQuery };
    await fakeClientQuery("BEGIN");
    try {
      const result = await fn(fakeClient);
      await fakeClientQuery("COMMIT");
      return result;
    } catch (err) {
      await fakeClientQuery("ROLLBACK");
      throw err;
    }
  },
  executeWith: vi.fn(),
  queryOneWith: vi.fn().mockResolvedValue(null),
}));

const { commitMissionStart } = await import(
  "../../../../vex-agent/engine/mission/commit-start.js"
);
const { computeContractHash } = await import(
  "../../../../vex-agent/engine/mission/contract-hash.js"
);
const { missionToDraft } = await import(
  "../../../../vex-agent/engine/mission/mapper.js"
);

function makeMission(overrides: Record<string, unknown> = {}) {
  // A complete + accepted mission. Tests override fields to exercise
  // each rejection branch.
  const base = {
    id: "mission-1",
    rootSessionId: "session-1",
    status: "ready",
    title: "SOL DCA",
    goal: "Accumulate 10 SOL",
    constraintsJson: { deadline: "2026-04-04" },
    successCriteriaJson: ["Accumulated 10 SOL"],
    stopConditionsJson: ["capital_depleted"],
    riskProfile: "conservative",
    capitalSourceJson: { type: "wallet", amount: "500 USDC" },
    allowedProtocols: ["jupiter"],
    allowedChains: ["solana"],
    allowedWallets: ["solana"],
    createdAt: "2026-05-22T10:00:00.000Z",
    updatedAt: "2026-05-22T10:00:00.000Z",
    approvedAt: null,
    acceptedContractHash: null as string | null,
    acceptedContractAt: null as string | null,
    acceptedContractBy: null as string | null,
    contractHashVersion: null as number | null,
    renewedFromMissionId: null,
    ...overrides,
  };
  return base;
}

function makeAcceptedMission(overrides: Record<string, unknown> = {}) {
  const base = makeMission(overrides);
  const hash = computeContractHash(missionToDraft(base));
  return {
    ...base,
    acceptedContractHash: hash,
    acceptedContractAt: "2026-05-22T11:00:00.000Z",
    acceptedContractBy: "host",
    contractHashVersion: 1,
  };
}

describe("commitMissionStart", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fakeClientQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  it("returns mission_not_found when the row is missing", async () => {
    mockGetMissionForUpdate.mockResolvedValueOnce(null);
    const outcome = await commitMissionStart({
      missionId: "missing",
      runId: "run-1",
    });
    expect(outcome.outcome).toBe("mission_not_found");
    expect(mockSetStatus).not.toHaveBeenCalled();
    expect(mockCreateRun).not.toHaveBeenCalled();
  });

  it("returns not_accepted when acceptance four-tuple is absent", async () => {
    mockGetMissionForUpdate.mockResolvedValueOnce(makeMission());
    const outcome = await commitMissionStart({
      missionId: "mission-1",
      runId: "run-1",
    });
    expect(outcome.outcome).toBe("not_accepted");
    expect(mockCreateRun).not.toHaveBeenCalled();
  });

  it("returns not_accepted when contractHashVersion mismatches the current literal", async () => {
    const mission = makeAcceptedMission();
    mockGetMissionForUpdate.mockResolvedValueOnce({
      ...mission,
      contractHashVersion: 99, // ahead of CONTRACT_HASH_VERSION = 1
    });
    const outcome = await commitMissionStart({
      missionId: "mission-1",
      runId: "run-1",
    });
    expect(outcome.outcome).toBe("not_accepted");
  });

  it("returns stale_acceptance when the locked hash drifted", async () => {
    const mission = makeAcceptedMission();
    mockGetMissionForUpdate.mockResolvedValueOnce({
      ...mission,
      acceptedContractHash: "0".repeat(64),
    });
    const outcome = await commitMissionStart({
      missionId: "mission-1",
      runId: "run-1",
    });
    expect(outcome.outcome).toBe("stale_acceptance");
    if (outcome.outcome === "stale_acceptance") {
      expect(outcome.acceptedHash).toBe("0".repeat(64));
      expect(outcome.currentHash).toBe(computeContractHash(missionToDraft(mission)));
    }
    expect(mockCreateRun).not.toHaveBeenCalled();
  });

  it("returns not_ready when the locked draft is incomplete", async () => {
    const mission = makeAcceptedMission({ goal: null, title: null });
    mockGetMissionForUpdate.mockResolvedValueOnce({
      ...mission,
      acceptedContractHash: computeContractHash(missionToDraft(mission)),
    });
    const outcome = await commitMissionStart({
      missionId: "mission-1",
      runId: "run-1",
    });
    expect(outcome.outcome).toBe("not_ready");
    if (outcome.outcome === "not_ready") {
      expect(outcome.missingFields).toContain("goal");
      expect(outcome.missingFields).toContain("title");
    }
    expect(mockCreateRun).not.toHaveBeenCalled();
  });

  it("returns active_run_exists when a run is already live", async () => {
    mockGetMissionForUpdate.mockResolvedValueOnce(makeAcceptedMission());
    mockGetActiveRun.mockResolvedValueOnce({
      id: "run-existing",
      status: "running",
    });
    const outcome = await commitMissionStart({
      missionId: "mission-1",
      runId: "run-1",
    });
    expect(outcome.outcome).toBe("active_run_exists");
    if (outcome.outcome === "active_run_exists") {
      expect(outcome.missionRunId).toBe("run-existing");
    }
    expect(mockSetStatus).not.toHaveBeenCalled();
    expect(mockCreateRun).not.toHaveBeenCalled();
  });

  it("flips status → running, sets approved_at, creates run on the happy path", async () => {
    const mission = makeAcceptedMission();
    mockGetMissionForUpdate.mockResolvedValueOnce(mission);
    mockGetActiveRun.mockResolvedValueOnce(null);

    const outcome = await commitMissionStart({
      missionId: "mission-1",
      runId: "run-1",
    });

    expect(outcome.outcome).toBe("committed");
    if (outcome.outcome === "committed") {
      expect(outcome.runId).toBe("run-1");
      expect(outcome.mission.id).toBe("mission-1");
      expect(outcome.contractSnapshot.version).toBe(1);
    }
    // Every mutator receives the tx client (5th / 3rd arg) so the
    // writes ride the same lock as the SELECT FOR UPDATE that
    // opened the tx — the locked-row invariant codex required.
    expect(mockSetStatus).toHaveBeenCalledWith("mission-1", "running", expect.anything());
    expect(mockSetStatus.mock.calls[0]![2]).toBeDefined();
    expect(mockSetApprovedAt).toHaveBeenCalledWith("mission-1", expect.anything());
    expect(mockSetApprovedAt.mock.calls[0]![1]).toBeDefined();
    expect(mockCreateRun).toHaveBeenCalledTimes(1);
    const createArgs = mockCreateRun.mock.calls[0]!;
    expect(createArgs[0]).toBe("run-1");
    expect(createArgs[1]).toBe("mission-1");
    expect(createArgs[2]).toBe("session-1");
    // 4th arg = options object; 5th arg = tx client.
    expect(createArgs[4]).toBeDefined();
    expect(typeof createArgs[4]).toBe("object");
  });

  it("opens and closes a single tx (BEGIN + COMMIT)", async () => {
    mockGetMissionForUpdate.mockResolvedValueOnce(makeAcceptedMission());
    mockGetActiveRun.mockResolvedValueOnce(null);
    await commitMissionStart({ missionId: "mission-1", runId: "run-1" });
    const sqlCalls = fakeClientQuery.mock.calls.map((c: unknown[]) => String(c[0]));
    expect(sqlCalls).toContain("BEGIN");
    expect(sqlCalls).toContain("COMMIT");
    // No ROLLBACK on the happy path.
    expect(sqlCalls).not.toContain("ROLLBACK");
  });

  it("rolls back the tx if any step throws (no createRun leak)", async () => {
    const mission = makeAcceptedMission();
    mockGetMissionForUpdate.mockResolvedValueOnce(mission);
    mockGetActiveRun.mockResolvedValueOnce(null);
    mockSetStatus.mockRejectedValueOnce(new Error("simulated flip failure"));

    await expect(
      commitMissionStart({ missionId: "mission-1", runId: "run-1" }),
    ).rejects.toThrow("simulated flip failure");

    expect(mockCreateRun).not.toHaveBeenCalled();
    const sqlCalls = fakeClientQuery.mock.calls.map((c: unknown[]) => String(c[0]));
    expect(sqlCalls).toContain("ROLLBACK");
  });
});
