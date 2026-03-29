import { describe, it, expect } from "vitest";

import { missionToDraft, domainToRow, freezeDraft, draftToPromptContext } from "../../../../echo-agent/engine/mission/mapper.js";
import type { Mission } from "../../../../echo-agent/db/repos/missions.js";

function makeMission(overrides: Partial<Mission> = {}): Mission {
  return {
    id: "mission-1",
    rootSessionId: "session-1",
    status: "ready",
    title: "SOL DCA",
    goal: "Accumulate 10 SOL over 7 days",
    constraintsJson: { deadline: "2026-04-04" },
    successCriteriaJson: ["Accumulated 10 SOL"],
    stopConditionsJson: ["capital_depleted", "deadline_reached"],
    riskProfile: "conservative",
    capitalSourceJson: { type: "wallet", amount: "500 USDC" },
    allowedProtocols: ["solana"],
    allowedChains: ["solana"],
    allowedWallets: ["solana"],
    createdAt: "2026-03-28T10:00:00Z",
    updatedAt: "2026-03-28T10:00:00Z",
    approvedAt: "2026-03-28T10:05:00Z",
    ...overrides,
  };
}

describe("mission mapper", () => {
  // ── missionToDraft ──────────────────────────────────────────

  describe("missionToDraft", () => {
    it("converts Mission row to domain MissionDraft", () => {
      const draft = missionToDraft(makeMission());
      expect(draft.title).toBe("SOL DCA");
      expect(draft.goal).toBe("Accumulate 10 SOL over 7 days");
      expect(draft.capitalSource).toBe("wallet");
      expect(draft.startingCapital).toBe("500 USDC");
      expect(draft.allowedChains).toEqual(["solana"]);
      expect(draft.riskProfile).toBe("conservative");
      expect(draft.successCriteria).toEqual(["Accumulated 10 SOL"]);
      expect(draft.stopConditions).toEqual(["capital_depleted", "deadline_reached"]);
      expect(draft.deadline).toBe("2026-04-04");
    });

    it("returns null for empty fields", () => {
      const draft = missionToDraft(makeMission({
        title: null, goal: null, riskProfile: null,
        capitalSourceJson: {}, allowedChains: [], allowedProtocols: [],
        allowedWallets: [], successCriteriaJson: [], stopConditionsJson: [],
        constraintsJson: {},
      }));
      expect(draft.title).toBeNull();
      expect(draft.goal).toBeNull();
      expect(draft.capitalSource).toBeNull();
      expect(draft.startingCapital).toBeNull();
      expect(draft.allowedChains).toBeNull();
      expect(draft.deadline).toBeNull();
    });
  });

  // ── domainToRow ─────────────────────────────────────────────

  describe("domainToRow", () => {
    it("converts domain fields to DB row shape", () => {
      const row = domainToRow({
        title: "Test",
        goal: "Test goal",
        riskProfile: "aggressive",
        allowedChains: ["solana", "ethereum"],
      });
      expect(row.title).toBe("Test");
      expect(row.goal).toBe("Test goal");
      expect(row.risk_profile).toBe("aggressive");
      expect(row.allowed_chains).toEqual(["solana", "ethereum"]);
    });

    it("converts capitalSource + startingCapital to capital_source_json", () => {
      const row = domainToRow({
        capitalSource: "wallet",
        startingCapital: "1000 USDC",
      });
      expect(row.capital_source_json).toEqual({ type: "wallet", amount: "1000 USDC" });
    });

    it("converts deadline to constraints_json", () => {
      const row = domainToRow({ deadline: "2026-04-04" });
      expect(row.constraints_json).toEqual({ deadline: "2026-04-04" });
    });

    it("converts null arrays to empty arrays", () => {
      const row = domainToRow({ allowedChains: null });
      expect(row.allowed_chains).toEqual([]);
    });

    it("skips undefined fields", () => {
      const row = domainToRow({ title: "Only title" });
      expect(row.title).toBe("Only title");
      expect(row.goal).toBeUndefined();
      expect(row.risk_profile).toBeUndefined();
    });

    it("returns empty object for empty input", () => {
      const row = domainToRow({});
      expect(Object.keys(row)).toHaveLength(0);
    });
  });

  // ── freezeDraft ─────────────────────────────────────────────

  describe("freezeDraft", () => {
    it("creates frozen mission snapshot", () => {
      const frozen = freezeDraft(makeMission());
      expect(frozen.id).toBe("mission-1");
      expect(frozen.title).toBe("SOL DCA");
      expect(frozen.goal).toBe("Accumulate 10 SOL over 7 days");
      expect(frozen.draft.allowedChains).toEqual(["solana"]);
      expect(frozen.approvedAt).toBe("2026-03-28T10:05:00Z");
    });

    it("uses defaults for null title/goal", () => {
      const frozen = freezeDraft(makeMission({ title: null, goal: null, approvedAt: null }));
      expect(frozen.title).toBe("Untitled Mission");
      expect(frozen.goal).toBe("");
    });
  });

  // ── draftToPromptContext ────────────────────────────────────

  describe("draftToPromptContext", () => {
    it("generates readable summary", () => {
      const ctx = draftToPromptContext(makeMission());
      expect(ctx).toContain("SOL DCA");
      expect(ctx).toContain("Accumulate 10 SOL");
      expect(ctx).toContain("wallet");
      expect(ctx).toContain("500 USDC");
      expect(ctx).toContain("conservative");
      expect(ctx).toContain("solana");
      expect(ctx).toContain("Accumulated 10 SOL");
      expect(ctx).toContain("2026-04-04");
    });

    it("handles empty mission gracefully", () => {
      const ctx = draftToPromptContext(makeMission({
        title: null, goal: null, riskProfile: null,
        capitalSourceJson: {}, allowedChains: [], constraintsJson: {},
      }));
      expect(ctx).toContain("(untitled)");
      expect(ctx).not.toContain("undefined");
    });
  });
});
