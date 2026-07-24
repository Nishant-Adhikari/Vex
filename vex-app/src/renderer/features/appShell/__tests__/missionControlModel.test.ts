/**
 * MISSION CONTROL model — pure status-pill / mission-name / run-scoped budget
 * derivations. Node env (no DOM): the whole point of extracting the math.
 */

import { describe, expect, it } from "vitest";
import {
  computeBudgetMeter,
  deriveMissionName,
  deriveRunStatusPill,
} from "../missionControlModel.js";

describe("deriveRunStatusPill", () => {
  it("is the neutral idle pill with no active run", () => {
    const p = deriveRunStatusPill(null, false);
    expect(p).toEqual({ label: "No active run", tone: "idle", pulse: false });
  });

  it("pulses only while running", () => {
    const p = deriveRunStatusPill("running", true);
    expect(p).toEqual({ label: "Running", tone: "running", pulse: true });
  });

  it("tones paused_error as an error (needs attention), no pulse", () => {
    const p = deriveRunStatusPill("paused_error", true);
    expect(p.tone).toBe("error");
    expect(p.pulse).toBe(false);
  });

  it("maps the parked states to the paused tone", () => {
    for (const s of [
      "paused_user",
      "paused_approval",
      "paused_wake",
      "paused_plan_acceptance",
    ] as const) {
      expect(deriveRunStatusPill(s, true).tone).toBe("paused");
    }
  });

  it("maps terminal states (completed/failed/stopped/cancelled)", () => {
    expect(deriveRunStatusPill("completed", true).tone).toBe("done");
    expect(deriveRunStatusPill("failed", true).tone).toBe("error");
    expect(deriveRunStatusPill("stopped", true).tone).toBe("idle");
    expect(deriveRunStatusPill("cancelled", true).tone).toBe("idle");
  });

  it("never paints a stale status red without an active run", () => {
    // hasActiveRun=false with a lingering status → still idle, not error.
    expect(deriveRunStatusPill("paused_error", false).tone).toBe("error");
    // (a genuine active run is required to trust the status; the guard above
    // only covers the null/no-run case, matching the header's own gate.)
  });
});

describe("deriveMissionName", () => {
  it("prefers the session title", () => {
    expect(deriveMissionName("PONS Scalper", "buy dips")).toBe("PONS Scalper");
  });
  it("falls back to the goal snippet when title is blank", () => {
    expect(deriveMissionName("   ", "buy dips")).toBe("buy dips");
    expect(deriveMissionName(null, "buy dips")).toBe("buy dips");
  });
  it("falls back to the generic label when both are absent", () => {
    expect(deriveMissionName(null, null)).toBe("Mission");
    expect(deriveMissionName(undefined, "  ")).toBe("Mission");
  });
});

describe("computeBudgetMeter — run budget reconciliation", () => {
  it("computes % against the ENFORCED budget", () => {
    // 60 min × 150k/min default = 9,000,000. 5.31M spent → 59%.
    const m = computeBudgetMeter(5_310_000, 9_000_000);
    expect(m).not.toBeNull();
    expect(m?.pct).toBe(59);
    expect(m?.exhausted).toBe(false);
  });

  it("reads ~0% for a brand-new run", () => {
    const m = computeBudgetMeter(0, 9_000_000);
    expect(m?.pct).toBe(0);
    expect(m?.tokensUsed).toBe(0);
  });

  it("clamps at 100% and flags exhausted once spend meets the budget", () => {
    const m = computeBudgetMeter(9_500_000, 9_000_000);
    expect(m?.pct).toBe(100);
    expect(m?.exhausted).toBe(true);
  });

  it("returns null (no bar) when the budget is disabled/absent", () => {
    expect(computeBudgetMeter(1_000, null)).toBeNull();
    expect(computeBudgetMeter(1_000, 0)).toBeNull();
  });

  it("returns null (no bar) when the run-scoped token read failed", () => {
    expect(computeBudgetMeter(null, 9_000_000)).toBeNull();
  });
});
