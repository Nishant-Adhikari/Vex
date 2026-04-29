import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────

const mockCreateDraft = vi.fn();
const mockGetMission = vi.fn();
const mockUpdateDraft = vi.fn();
const mockSetStatus = vi.fn();

vi.mock("@vex-agent/db/repos/missions.js", () => ({
  createDraft: (...a: unknown[]) => mockCreateDraft(...a),
  getMission: (...a: unknown[]) => mockGetMission(...a),
  updateDraft: (...a: unknown[]) => mockUpdateDraft(...a),
  setStatus: (...a: unknown[]) => mockSetStatus(...a),
}));

vi.mock("@vex-agent/db/client.js", () => ({
  execute: vi.fn(),
  query: vi.fn().mockResolvedValue([]),
  queryOne: vi.fn().mockResolvedValue(null),
}));

const { createMissionDraft, applyMissionPatch, getMissionSetupState } = await import(
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
    allowedWallets: [],
    createdAt: "2026-03-29T10:00:00Z",
    updatedAt: "2026-03-29T10:00:00Z",
    approvedAt: null,
    ...overrides,
  };
}

describe("mission setup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── createMissionDraft ──────────────────────────────────────

  describe("createMissionDraft", () => {
    it("creates draft and returns setup state", async () => {
      const result = await createMissionDraft("session-1");
      expect(result.status).toBe("draft");
      expect(result.ready).toBe(false);
      expect(result.missingFields).toHaveLength(10);
      expect(mockCreateDraft).toHaveBeenCalledWith(
        expect.stringContaining("mission-"),
        "session-1",
      );
    });
  });

  // ── applyMissionPatch ───────────────────────────────────────

  describe("applyMissionPatch", () => {
    it("applies valid patch to draft", async () => {
      // First getMission call — before update
      mockGetMission.mockResolvedValueOnce(makeMission());
      // Second getMission call — after update
      mockGetMission.mockResolvedValueOnce(makeMission({
        title: "SOL DCA", goal: "Accumulate SOL",
      }));

      const result = await applyMissionPatch("mission-1", {
        title: "SOL DCA",
        goal: "Accumulate SOL",
      });

      expect(mockUpdateDraft).toHaveBeenCalledWith("mission-1", expect.objectContaining({
        title: "SOL DCA",
        goal: "Accumulate SOL",
      }));
      expect(result.currentDraft.title).toBe("SOL DCA");
      expect(result.ready).toBe(false); // Still missing fields
    });

    it("handles null/invalid patch gracefully", async () => {
      mockGetMission.mockResolvedValueOnce(makeMission());
      mockGetMission.mockResolvedValueOnce(makeMission());

      const result = await applyMissionPatch("mission-1", null);
      expect(mockUpdateDraft).not.toHaveBeenCalled();
      expect(result.ready).toBe(false);
    });

    it("handles completely invalid object", async () => {
      mockGetMission.mockResolvedValueOnce(makeMission());
      mockGetMission.mockResolvedValueOnce(makeMission());

      const result = await applyMissionPatch("mission-1", { badKey: "badValue" });
      expect(mockUpdateDraft).not.toHaveBeenCalled();
      expect(result.ready).toBe(false);
    });

    it("transitions to ready when all fields populated", async () => {
      const completeMission = makeMission({
        title: "SOL DCA",
        goal: "Accumulate 10 SOL",
        capitalSourceJson: { type: "wallet", amount: "500 USDC" },
        allowedWallets: ["solana"],
        allowedChains: ["solana"],
        allowedProtocols: ["solana"],
        riskProfile: "conservative",
        successCriteriaJson: ["Accumulated 10 SOL"],
        stopConditionsJson: ["capital_depleted"],
      });

      mockGetMission.mockResolvedValueOnce(makeMission({
        title: "SOL DCA", goal: "Accumulate 10 SOL",
        capitalSourceJson: { type: "wallet", amount: "500 USDC" },
        allowedWallets: ["solana"], allowedChains: ["solana"],
        allowedProtocols: ["solana"], riskProfile: "conservative",
        successCriteriaJson: ["Accumulated 10 SOL"],
      }));
      mockGetMission.mockResolvedValueOnce(completeMission);

      const result = await applyMissionPatch("mission-1", {
        stopConditions: ["capital_depleted"],
      });

      expect(result.ready).toBe(true);
      expect(result.status).toBe("ready");
      expect(result.missingFields).toHaveLength(0);
      expect(mockSetStatus).toHaveBeenCalledWith("mission-1", "ready");
    });

    it("does not re-transition if already ready", async () => {
      const readyMission = makeMission({
        status: "ready",
        title: "SOL DCA",
        goal: "Accumulate 10 SOL",
        capitalSourceJson: { type: "wallet", amount: "500 USDC" },
        allowedWallets: ["solana"],
        allowedChains: ["solana"],
        allowedProtocols: ["solana"],
        riskProfile: "conservative",
        successCriteriaJson: ["Accumulated 10 SOL"],
        stopConditionsJson: ["capital_depleted"],
      });

      mockGetMission.mockResolvedValueOnce(readyMission);
      mockGetMission.mockResolvedValueOnce(readyMission);

      await applyMissionPatch("mission-1", { title: "Updated title" });
      expect(mockSetStatus).not.toHaveBeenCalled();
    });

    it("throws for nonexistent mission", async () => {
      mockGetMission.mockResolvedValueOnce(null);
      await expect(applyMissionPatch("nonexistent", {})).rejects.toThrow("not found");
    });
  });

  // ── getMissionSetupState ────────────────────────────────────

  describe("getMissionSetupState", () => {
    it("returns null for nonexistent mission", async () => {
      mockGetMission.mockResolvedValueOnce(null);
      const result = await getMissionSetupState("nonexistent");
      expect(result).toBeNull();
    });

    it("returns current state with missing fields", async () => {
      mockGetMission.mockResolvedValueOnce(makeMission({ title: "Test" }));
      const result = await getMissionSetupState("mission-1");
      expect(result!.currentDraft.title).toBe("Test");
      expect(result!.missingFields.length).toBeGreaterThan(0);
      expect(result!.ready).toBe(false);
    });
  });
});
