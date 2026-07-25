/**
 * LIFECYCLE GUARD — Mission token-budget awareness banner escalation (#3).
 *
 * The turn loop surfaces live budget usage so the agent can exit on its own
 * terms BEFORE the hard cut + blunt force-liquidation. `buildMissionBudgetBanner`
 * maps `fraction = tokensUsed / budget` to three escalating tiers. The existing
 * `budget-pressure.test.ts` asserts the tiers at 0.75 / 0.9 / 0.97 and silence
 * below 0.7; THIS guard pins the exact TIER BOUNDARIES (0.7 / 0.85 / 0.95) and
 * their inclusivity, so a `<`-vs-`<=` regression that shifts a threshold by one
 * tier is caught.
 */

import { describe, expect, it } from "vitest";
import { buildMissionBudgetBanner } from "@vex-agent/engine/prompts/budget-pressure.js";

describe("buildMissionBudgetBanner — tier boundary inclusivity", () => {
  it("is silent below the 0.7 informational threshold (incl. no-budget null)", () => {
    expect(buildMissionBudgetBanner(null)).toBe("");
    expect(buildMissionBudgetBanner(0.6999)).toBe("");
  });

  it("0.70 (inclusive) enters the informational tier, not silence and not ACTION REQUIRED", () => {
    const b = buildMissionBudgetBanner(0.7);
    expect(b).not.toBe("");
    expect(b).toMatch(/runway is getting short/);
    expect(b).not.toMatch(/ACTION REQUIRED/);
  });

  it("just below 0.85 is still informational", () => {
    expect(buildMissionBudgetBanner(0.8499)).toMatch(/runway is getting short/);
  });

  it("0.85 (inclusive) escalates to ACTION REQUIRED / FLATTEN, not CRITICAL", () => {
    const b = buildMissionBudgetBanner(0.85);
    expect(b).toMatch(/ACTION REQUIRED/);
    expect(b).toMatch(/FLATTEN/);
    expect(b).not.toMatch(/CRITICAL/);
  });

  it("just below 0.95 is still ACTION REQUIRED", () => {
    expect(buildMissionBudgetBanner(0.9499)).toMatch(/ACTION REQUIRED/);
  });

  it("0.95 (inclusive) escalates to CRITICAL", () => {
    expect(buildMissionBudgetBanner(0.95)).toMatch(/CRITICAL/);
    expect(buildMissionBudgetBanner(1.0)).toMatch(/CRITICAL/);
  });
});
