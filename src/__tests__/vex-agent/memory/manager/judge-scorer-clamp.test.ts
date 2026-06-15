/**
 * Pure unit tests for the judge-benchmark CLAMP scorer helpers (TEST-ONLY).
 *
 * Pins the RUNTIME-clamp invariant the HARD `clamp-applied` gate now enforces.
 * The old gate compared the clamped tier against the ORACLE ceiling on a
 * MISALIGNED rank scale (oracle-ceiling rank vs a collapsed source rank), which
 * (a) measured merit not the runtime invariant and (b) collapsed hypothesis=1 and
 * inferred=1 — so a clamp that returned 'inferred' where the runtime ceiling only
 * permits 'hypothesis' would WRONGLY pass. These helpers mirror the production
 * clamp (`consolidate.ts:clampSourceTier` / `maxTierForCeiling`) on the UNCOLLAPSED
 * scale, re-typed test-side (anti-circularity — no production import).
 *
 * Pure: no DB, no containers, no live tokens. Importing the scorer module only
 * pulls in the report-card + oracle data (both pure at load); none of it runs
 * unless a scoring function is called, which these tests do not.
 */

import { describe, it, expect } from "vitest";

import {
  clampWithinRuntimeCeiling,
  maxSourceForCeiling,
} from "../../../integration/eval/_judge-scorer.js";

describe("clampWithinRuntimeCeiling — HARD runtime-clamp invariant", () => {
  it("rejects a tier above the ceiling on the UNCOLLAPSED scale", () => {
    // THE regression the old collapsed SOURCE_RANK (hypothesis=inferred=1) could
    // not catch: runtime ceiling 'none' permits at most 'hypothesis'; 'inferred'
    // exceeds it and must FAIL the invariant.
    expect(clampWithinRuntimeCeiling("inferred", "none")).toBe(false);
  });

  it("accepts a tier at/under the ceiling cap", () => {
    expect(clampWithinRuntimeCeiling("hypothesis", "none")).toBe(true);
    expect(clampWithinRuntimeCeiling("inferred", "weak")).toBe(true);
    expect(clampWithinRuntimeCeiling("observed", "moderate")).toBe(true);
  });

  it("rejects tiers above the 'weak' cap", () => {
    expect(clampWithinRuntimeCeiling("observed", "weak")).toBe(false);
  });

  it("exempts user_confirmed from every ceiling (the human is the verifier)", () => {
    expect(clampWithinRuntimeCeiling("user_confirmed", "none")).toBe(true);
    expect(clampWithinRuntimeCeiling("user_confirmed", "weak")).toBe(true);
  });
});

describe("maxSourceForCeiling — ceiling → permitted max source tier", () => {
  it("mirrors consolidate.ts:maxTierForCeiling", () => {
    expect(maxSourceForCeiling("none")).toBe("hypothesis");
    expect(maxSourceForCeiling("weak")).toBe("inferred");
    expect(maxSourceForCeiling("moderate")).toBe("observed");
    expect(maxSourceForCeiling("strong")).toBe("observed");
  });
});
