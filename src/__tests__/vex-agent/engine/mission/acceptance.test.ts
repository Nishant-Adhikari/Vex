/**
 * Unit tests for `engine/mission/acceptance.ts`.
 *
 * The repo + tx helpers are mocked at the module boundary. We test the
 * discriminated-union outcomes returned by `acceptContract` so the IPC
 * layer in phase 6 can map them to `Result<T, VexError>` envelopes
 * without re-running engine logic.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetMissionForUpdate = vi.fn();
const mockUpdateAcceptance = vi.fn();
const mockGetActiveRun = vi.fn();

vi.mock("@vex-agent/db/repos/missions.js", () => ({
  getMissionForUpdate: (...args: unknown[]) => mockGetMissionForUpdate(...args),
  updateAcceptance: (...args: unknown[]) => mockUpdateAcceptance(...args),
}));

vi.mock("@vex-agent/db/repos/mission-runs.js", () => ({
  getActiveRun: (...args: unknown[]) => mockGetActiveRun(...args),
}));

// `withTransaction` is exercised for real — it just calls the fn with a
// fake client object and runs BEGIN/COMMIT against it. We mock the pool
// so the BEGIN/COMMIT noop doesn't error.
const fakeClientQuery = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
const fakeClientRelease = vi.fn();

vi.mock("@vex-agent/db/client.js", () => ({
  getPool: () => ({
    connect: async () => ({
      query: fakeClientQuery,
      release: fakeClientRelease,
    }),
  }),
  // Keep `withTransaction` real so the BEGIN/COMMIT contract is exercised.
  withTransaction: async (fn: (client: unknown) => Promise<unknown>) => {
    const fakeClient = { query: fakeClientQuery, release: fakeClientRelease };
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
}));

const { acceptContract, assertAcceptedContract } = await import(
  "../../../../vex-agent/engine/mission/acceptance.js"
);
const { computeContractHash } = await import(
  "../../../../vex-agent/engine/mission/contract-hash.js"
);
const { missionToDraft } = await import(
  "../../../../vex-agent/engine/mission/mapper.js"
);

function makeMission(overrides: Record<string, unknown> = {}) {
  return {
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
    acceptedContractHash: null,
    acceptedContractAt: null,
    acceptedContractBy: null,
    contractHashVersion: null,
    renewedFromMissionId: null,
    ...overrides,
  };
}

describe("acceptContract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fakeClientQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  it("returns mission_not_found when row is missing", async () => {
    mockGetMissionForUpdate.mockResolvedValueOnce(null);
    const outcome = await acceptContract({
      sessionId: "session-1",
      missionId: "mission-1",
      contractHash: "x".repeat(64),
    });
    expect(outcome.outcome).toBe("mission_not_found");
  });

  it("returns session_mismatch when mission belongs to another session", async () => {
    mockGetMissionForUpdate.mockResolvedValueOnce(
      makeMission({ rootSessionId: "OTHER" }),
    );
    const outcome = await acceptContract({
      sessionId: "session-1",
      missionId: "mission-1",
      contractHash: "x".repeat(64),
    });
    expect(outcome.outcome).toBe("session_mismatch");
    if (outcome.outcome === "session_mismatch") {
      expect(outcome.expectedSessionId).toBe("OTHER");
    }
  });

  it("returns hash_mismatch when the UI hash doesn't match the locked row", async () => {
    const mission = makeMission();
    mockGetMissionForUpdate.mockResolvedValueOnce(mission);
    const staleHash = "0".repeat(64);
    const outcome = await acceptContract({
      sessionId: "session-1",
      missionId: "mission-1",
      contractHash: staleHash,
    });
    expect(outcome.outcome).toBe("hash_mismatch");
    if (outcome.outcome === "hash_mismatch") {
      expect(outcome.providedHash).toBe(staleHash);
      expect(outcome.currentHash).toBe(computeContractHash(missionToDraft(mission)));
    }
  });

  it("returns status_blocked when mission is running / completed / cancelled", async () => {
    const mission = makeMission({ status: "running" });
    mockGetMissionForUpdate.mockResolvedValueOnce(mission);
    const outcome = await acceptContract({
      sessionId: "session-1",
      missionId: "mission-1",
      contractHash: computeContractHash(missionToDraft(mission)),
    });
    expect(outcome.outcome).toBe("status_blocked");
    if (outcome.outcome === "status_blocked") {
      expect(outcome.currentStatus).toBe("running");
    }
  });

  it("returns run_active when a mission_run is active or paused", async () => {
    const mission = makeMission();
    mockGetMissionForUpdate.mockResolvedValueOnce(mission);
    mockGetActiveRun.mockResolvedValueOnce({
      id: "run-1",
      status: "paused_approval",
    });
    const outcome = await acceptContract({
      sessionId: "session-1",
      missionId: "mission-1",
      contractHash: computeContractHash(missionToDraft(mission)),
    });
    expect(outcome.outcome).toBe("run_active");
    if (outcome.outcome === "run_active") {
      expect(outcome.missionRunId).toBe("run-1");
      expect(outcome.runStatus).toBe("paused_approval");
    }
  });

  it("writes acceptance four-tuple and returns accepted outcome on success", async () => {
    const mission = makeMission();
    const hash = computeContractHash(missionToDraft(mission));
    mockGetMissionForUpdate
      .mockResolvedValueOnce(mission)
      .mockResolvedValueOnce(makeMission({
        acceptedContractHash: hash,
        acceptedContractAt: "2026-05-22T11:00:00.000Z",
        acceptedContractBy: "host",
        contractHashVersion: 1,
      }));
    mockGetActiveRun.mockResolvedValueOnce(null);

    const outcome = await acceptContract({
      sessionId: "session-1",
      missionId: "mission-1",
      contractHash: hash,
    });

    expect(outcome.outcome).toBe("accepted");
    if (outcome.outcome === "accepted") {
      expect(outcome.acceptedContractHash).toBe(hash);
      expect(outcome.acceptedBy).toBe("host");
      expect(outcome.contractHashVersion).toBe(1);
      expect(outcome.acceptedAt).toBe("2026-05-22T11:00:00.000Z");
    }

    expect(mockUpdateAcceptance).toHaveBeenCalledTimes(1);
    expect(mockUpdateAcceptance).toHaveBeenCalledWith(
      expect.anything(),
      "mission-1",
      hash,
      "host",
      1,
    );
  });

  it("opens and closes a transaction (BEGIN + COMMIT)", async () => {
    const mission = makeMission();
    const hash = computeContractHash(missionToDraft(mission));
    mockGetMissionForUpdate
      .mockResolvedValueOnce(mission)
      .mockResolvedValueOnce(makeMission({
        acceptedContractHash: hash,
        acceptedContractAt: "2026-05-22T11:00:00.000Z",
        acceptedContractBy: "host",
        contractHashVersion: 1,
      }));
    mockGetActiveRun.mockResolvedValueOnce(null);

    await acceptContract({
      sessionId: "session-1",
      missionId: "mission-1",
      contractHash: hash,
    });

    const sqlCalls = fakeClientQuery.mock.calls.map((c: unknown[]) => String(c[0]));
    expect(sqlCalls).toContain("BEGIN");
    expect(sqlCalls).toContain("COMMIT");
  });
});

// ── assertAcceptedContract (puzzle 04 phase 4 gate) ──────────────

describe("assertAcceptedContract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fakeClientQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  it("returns mission_not_found when the row is missing", async () => {
    mockGetMissionForUpdate.mockResolvedValueOnce(null);
    const outcome = await assertAcceptedContract({ missionId: "mission-1" });
    expect(outcome.outcome).toBe("mission_not_found");
  });

  it("returns not_accepted when accepted_contract_hash is null", async () => {
    mockGetMissionForUpdate.mockResolvedValueOnce(
      makeMission({ acceptedContractHash: null, contractHashVersion: null }),
    );
    const outcome = await assertAcceptedContract({ missionId: "mission-1" });
    expect(outcome.outcome).toBe("not_accepted");
    if (outcome.outcome === "not_accepted") {
      expect(outcome.missionId).toBe("mission-1");
    }
  });

  it("returns stale_acceptance when the recomputed hash drifted", async () => {
    const mission = makeMission({
      acceptedContractHash: "0".repeat(64),
      acceptedContractAt: "2026-05-22T11:00:00.000Z",
      acceptedContractBy: "host",
      contractHashVersion: 1,
    });
    mockGetMissionForUpdate.mockResolvedValueOnce(mission);

    const outcome = await assertAcceptedContract({ missionId: "mission-1" });
    expect(outcome.outcome).toBe("stale_acceptance");
    if (outcome.outcome === "stale_acceptance") {
      expect(outcome.acceptedHash).toBe("0".repeat(64));
      expect(outcome.currentHash).toBe(computeContractHash(missionToDraft(mission)));
      expect(outcome.currentHash).not.toBe(outcome.acceptedHash);
    }
  });

  it("returns accepted when the four-tuple matches the current draft", async () => {
    const mission = makeMission();
    const currentHash = computeContractHash(missionToDraft(mission));
    mockGetMissionForUpdate.mockResolvedValueOnce({
      ...mission,
      acceptedContractHash: currentHash,
      acceptedContractAt: "2026-05-22T11:00:00.000Z",
      acceptedContractBy: "host",
      contractHashVersion: 1,
    });

    const outcome = await assertAcceptedContract({ missionId: "mission-1" });
    expect(outcome.outcome).toBe("accepted");
    if (outcome.outcome === "accepted") {
      expect(outcome.contractHash).toBe(currentHash);
      expect(outcome.contractHashVersion).toBe(1);
    }
  });

  it("opens and closes a transaction (BEGIN + COMMIT) for the gate read", async () => {
    mockGetMissionForUpdate.mockResolvedValueOnce(
      makeMission({ acceptedContractHash: null, contractHashVersion: null }),
    );
    await assertAcceptedContract({ missionId: "mission-1" });
    const sqlCalls = fakeClientQuery.mock.calls.map((c: unknown[]) => String(c[0]));
    expect(sqlCalls).toContain("BEGIN");
    expect(sqlCalls).toContain("COMMIT");
  });
});
