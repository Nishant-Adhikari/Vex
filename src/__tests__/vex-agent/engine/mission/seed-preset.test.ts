import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────
// Seeding reuses the EXACT validated draft-write pipeline the agent's
// mission_draft_update uses (extractMissionPatch → sanitizePatch →
// domainToRow → repo.updateDraft), so we mock the repo/tx boundary the
// same way `setup.test.ts` does and assert on the row the pipeline emits.

const mockGetMission = vi.fn();
const mockGetMissionBySession = vi.fn();
const mockGetMissionForUpdate = vi.fn();
const mockUpdateDraft = vi.fn();
const mockSetStatus = vi.fn();

vi.mock("@vex-agent/db/repos/missions.js", () => ({
  getMission: (...a: unknown[]) => mockGetMission(...a),
  getMissionBySession: (...a: unknown[]) => mockGetMissionBySession(...a),
  getMissionForUpdate: (...a: unknown[]) => mockGetMissionForUpdate(...a),
  updateDraft: (...a: unknown[]) => mockUpdateDraft(...a),
  setStatus: (...a: unknown[]) => mockSetStatus(...a),
}));

vi.mock("@vex-agent/db/client.js", () => ({
  execute: vi.fn(),
  query: vi.fn().mockResolvedValue([]),
  queryOne: vi.fn().mockResolvedValue(null),
  withTransaction: vi.fn(async (fn: (client: unknown) => unknown) => fn({})),
}));

const { seedMissionDraftForSession } = await import(
  "../../../../vex-agent/engine/mission/setup.js"
);

function makeMission(overrides = {}) {
  return {
    id: "mission-1",
    rootSessionId: "session-1",
    status: "draft",
    title: null,
    goal: null,
    constraintsJson: {},
    successCriteriaJson: [],
    stopConditionsJson: [],
    riskProfile: null,
    capitalSourceJson: {},
    allowedProtocols: [],
    allowedChains: [],
    // The session-create path already seeds allowed_wallets from the
    // selected (primary) wallet address, so a preset never sets it.
    allowedWallets: ["0x9ed2C77f"],
    createdAt: "2026-07-22T10:00:00Z",
    updatedAt: "2026-07-22T10:00:00Z",
    approvedAt: null,
    acceptedContractHash: null,
    acceptedContractAt: null,
    acceptedContractBy: null,
    contractHashVersion: null,
    renewedFromMissionId: null,
    ...overrides,
  };
}

// A structured seed shaped exactly like the PONS Scalper preset's `draft`.
const PONS_SEED = {
  title: "PONS Scalper",
  goal: "Catch one fast-moving PONS runner and manage it with a moonbag.",
  capitalSource: "primary wallet balance",
  startingCapital: "$20 (USD)",
  riskProfile: "aggressive",
  allowedChains: ["Robinhood Chain"],
  allowedProtocols: [
    "DexScreener (research)",
    "on-chain swap route (execution)",
  ],
  successCriteria: [
    "Sellability-gated single scalp",
    "8% stop-loss + take-profit set before entry",
    "At 2x recover initials and keep a 60-80% moonbag",
    "Trim/cut on 25-35% drawdown or a support break",
    "Force-close all positions before the 60-minute deadline",
  ],
  stopConditions: [
    "deadline_reached: 60-minute hard time-box elapsed",
    "capital_depleted: the full $20 budget is spent",
    "max_loss_hit: the 8% stop-loss triggers",
    "no_viable_opportunity: nothing clears the sellability gate",
  ],
  durationMinutes: 60,
};

describe("seedMissionDraftForSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetMissionForUpdate.mockResolvedValue(makeMission());
  });

  it("returns null when the session has no mission draft row", async () => {
    mockGetMissionBySession.mockResolvedValueOnce(null);
    const result = await seedMissionDraftForSession("session-x", PONS_SEED);
    expect(result).toBeNull();
    expect(mockUpdateDraft).not.toHaveBeenCalled();
  });

  it("resolves the mission for the session and applies the seed through the validated pipeline", async () => {
    mockGetMissionBySession.mockResolvedValueOnce(makeMission());
    mockGetMission.mockResolvedValueOnce(makeMission()); // existence guard
    mockGetMission.mockResolvedValueOnce(makeMission()); // reload after write

    await seedMissionDraftForSession("session-1", PONS_SEED);

    expect(mockGetMissionBySession).toHaveBeenCalledWith("session-1");
    // A single validated updateDraft with the structured fields mapped to
    // their DB columns — NOT a parallel writer.
    expect(mockUpdateDraft).toHaveBeenCalledTimes(1);
    const rowPatch = mockUpdateDraft.mock.calls[0]?.[1] as Record<string, unknown>;

    expect(rowPatch.title).toBe("PONS Scalper");
    expect(rowPatch.goal).toContain("PONS runner");
    expect(rowPatch.risk_profile).toBe("aggressive");
    expect(rowPatch.allowed_chains).toEqual(["Robinhood Chain"]);
    expect(rowPatch.allowed_protocols).toEqual([
      "DexScreener (research)",
      "on-chain swap route (execution)",
    ]);
    expect(rowPatch.success_criteria_json).toHaveLength(5);
    expect(rowPatch.stop_conditions_json).toHaveLength(4);
    // capitalSource + startingCapital collapse into capital_source_json.
    expect(rowPatch.capital_source_json).toEqual({
      type: "primary wallet balance",
      amount: "$20 (USD)",
    });
    // durationMinutes rides in constraints_json (drives the hard time-box).
    expect(
      (rowPatch.constraints_json as Record<string, unknown>).durationMinutes,
    ).toBe(60);
  });

  it("marks the draft ready once every required field is seeded (allowed_wallets already set at create)", async () => {
    const seeded = makeMission({
      title: "PONS Scalper",
      goal: "Catch one fast-moving PONS runner and manage it with a moonbag.",
      capitalSourceJson: { type: "primary wallet balance", amount: "$20 (USD)" },
      riskProfile: "aggressive",
      allowedChains: ["Robinhood Chain"],
      allowedProtocols: ["DexScreener (research)", "on-chain swap route (execution)"],
      successCriteriaJson: PONS_SEED.successCriteria,
      stopConditionsJson: PONS_SEED.stopConditions,
    });
    mockGetMissionBySession.mockResolvedValueOnce(makeMission());
    mockGetMission.mockResolvedValueOnce(makeMission()); // existence guard
    mockGetMission.mockResolvedValueOnce(seeded); // reload after write

    const result = await seedMissionDraftForSession("session-1", PONS_SEED);

    expect(result?.ready).toBe(true);
    expect(result?.status).toBe("ready");
    expect(result?.missingFields).toHaveLength(0);
    expect(mockSetStatus).toHaveBeenCalledWith("mission-1", "ready");
  });

  it("does not clobber already-seeded fields on a later empty/no-op patch", async () => {
    // Sanity: the validated pipeline only writes the columns present in the
    // patch, so a subsequent agent turn that emits nothing structured leaves
    // the seeded fields intact (no updateDraft call at all).
    mockGetMissionBySession.mockResolvedValueOnce(makeMission());
    mockGetMission.mockResolvedValueOnce(makeMission()); // existence guard
    mockGetMission.mockResolvedValueOnce(makeMission()); // reload

    await seedMissionDraftForSession("session-1", { badKey: "ignored" });
    expect(mockUpdateDraft).not.toHaveBeenCalled();
  });
});
