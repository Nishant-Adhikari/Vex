import { describe, it, expect } from "vitest";

import { validateDraft, getMissingFields, isReadyToStart } from "../../../../echo-agent/engine/mission/validator.js";
import type { Mission } from "../../../../echo-agent/db/repos/missions.js";

function makeMission(overrides: Partial<Mission> = {}): Mission {
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
    createdAt: "2026-03-28T10:00:00Z",
    updatedAt: "2026-03-28T10:00:00Z",
    approvedAt: null,
    ...overrides,
  };
}

function makeCompleteMission(): Mission {
  return makeMission({
    title: "SOL DCA Strategy",
    goal: "Accumulate 10 SOL",
    capitalSourceJson: { type: "wallet", amount: "500 USDC" },
    allowedWallets: ["solana"],
    allowedChains: ["solana"],
    allowedProtocols: ["solana"],
    riskProfile: "conservative",
    successCriteriaJson: ["Accumulated 10 SOL"],
    stopConditionsJson: ["capital_depleted", "deadline_reached"],
  });
}

describe("mission validator", () => {
  // ── validateDraft ───────────────────────────────────────────

  describe("validateDraft", () => {
    it("returns invalid for empty draft", () => {
      const result = validateDraft(makeMission());
      expect(result.valid).toBe(false);
      expect(result.missing.length).toBeGreaterThan(0);
    });

    it("returns valid for complete draft", () => {
      const result = validateDraft(makeCompleteMission());
      expect(result.valid).toBe(true);
      expect(result.missing).toHaveLength(0);
    });

    it("returns missing fields for partial draft", () => {
      const result = validateDraft(makeMission({ title: "Test", goal: "Test goal" }));
      expect(result.valid).toBe(false);
      expect(result.missing).not.toContain("title");
      expect(result.missing).not.toContain("goal");
      expect(result.missing).toContain("capitalSource");
      expect(result.missing).toContain("allowedChains");
    });
  });

  // ── getMissingFields ────────────────────────────────────────

  describe("getMissingFields", () => {
    it("returns all 10 required fields for empty draft", () => {
      const missing = getMissingFields(makeMission());
      expect(missing).toHaveLength(10);
    });

    it("returns empty for complete draft", () => {
      const missing = getMissingFields(makeCompleteMission());
      expect(missing).toHaveLength(0);
    });

    it("treats empty string as missing", () => {
      const missing = getMissingFields(makeMission({ title: "" }));
      expect(missing).toContain("title");
    });

    it("treats null as missing", () => {
      const missing = getMissingFields(makeMission({ title: null }));
      expect(missing).toContain("title");
    });

    it("treats empty arrays as missing", () => {
      const missing = getMissingFields(makeMission({
        allowedChains: [],
        allowedProtocols: [],
        allowedWallets: [],
        successCriteriaJson: [],
        stopConditionsJson: [],
      }));
      expect(missing).toContain("allowedChains");
      expect(missing).toContain("allowedProtocols");
      expect(missing).toContain("allowedWallets");
      expect(missing).toContain("successCriteria");
      expect(missing).toContain("stopConditions");
    });

    it("treats empty capitalSourceJson as missing capitalSource", () => {
      const missing = getMissingFields(makeMission({ capitalSourceJson: {} }));
      expect(missing).toContain("capitalSource");
      expect(missing).toContain("startingCapital");
    });

    it("recognizes populated capitalSourceJson", () => {
      const missing = getMissingFields(makeMission({
        capitalSourceJson: { type: "wallet", amount: "100 USDC" },
      }));
      expect(missing).not.toContain("capitalSource");
      expect(missing).not.toContain("startingCapital");
    });

    it("does not require deadline (optional)", () => {
      const complete = makeCompleteMission();
      const missing = getMissingFields(complete);
      expect(missing).not.toContain("deadline");
    });
  });

  // ── isReadyToStart ──────────────────────────────────────────

  describe("isReadyToStart", () => {
    it("returns false for empty draft", () => {
      expect(isReadyToStart(makeMission())).toBe(false);
    });

    it("returns true for complete draft", () => {
      expect(isReadyToStart(makeCompleteMission())).toBe(true);
    });

    it("returns false when one field is missing", () => {
      const almost = makeCompleteMission();
      almost.title = null;
      expect(isReadyToStart(almost)).toBe(false);
    });
  });
});
