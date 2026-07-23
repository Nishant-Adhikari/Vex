import { describe, it, expect } from "vitest";

import { buildMissionBudgetBanner } from "../../../../vex-agent/engine/prompts/budget-pressure.js";

describe("buildMissionBudgetBanner", () => {
  it("is empty with no budget box or well under the warning threshold", () => {
    expect(buildMissionBudgetBanner(null)).toBe("");
    expect(buildMissionBudgetBanner(0)).toBe("");
    expect(buildMissionBudgetBanner(0.5)).toBe("");
    expect(buildMissionBudgetBanner(0.699)).toBe("");
  });

  it("warns (informational) in the 70–85% band", () => {
    const b = buildMissionBudgetBanner(0.75);
    expect(b).toContain("75%");
    expect(b.toLowerCase()).toContain("runway");
    expect(b).not.toContain("ACTION REQUIRED");
  });

  it("directs a graceful flatten + finalize in the 85–95% band", () => {
    const b = buildMissionBudgetBanner(0.9);
    expect(b).toContain("ACTION REQUIRED");
    expect(b).toContain("FLATTEN");
    expect(b).toContain("mission_stop");
    expect(b).toContain("90%");
  });

  it("escalates to CRITICAL at ≥95%", () => {
    const b = buildMissionBudgetBanner(0.97);
    expect(b).toContain("CRITICAL");
    expect(b).toContain("mission_stop");
  });
});
