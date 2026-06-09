/**
 * Direct unit tests for the knowledge-import regime_tags validator (S6b FIX-2).
 *
 * An old backup may carry pre-F2 free-form tags ("bull_microcap"); the
 * validator must reject the ROW with an explicit error NAMING the bad tag —
 * never silently normalize/strip it (silent coercion would falsify durable
 * state) and never defer to the cryptic DB CHECK failure. Duplicates WITHIN
 * the valid vocabulary are deduped (canonicalization, refinement from the
 * S6b plan gate R2).
 */

import { describe, it, expect } from "vitest";

import { requireValidRegimeTagsOrUndefined } from "@vex-agent/scripts/knowledge-import/validators.js";

describe("requireValidRegimeTagsOrUndefined (S6b closed vocabulary)", () => {
  it("absent (undefined / null) maps to undefined → insertEntry default []", () => {
    expect(requireValidRegimeTagsOrUndefined(undefined, 3)).toBeUndefined();
    expect(requireValidRegimeTagsOrUndefined(null, 3)).toBeUndefined();
  });

  it("passes a valid in-vocabulary tag set through unchanged", () => {
    expect(requireValidRegimeTagsOrUndefined(["bull", "high_vol"], 3)).toEqual(["bull", "high_vol"]);
    expect(requireValidRegimeTagsOrUndefined([], 3)).toEqual([]);
  });

  it("rejects an out-of-vocab tag with an error NAMING the bad tag and the line", () => {
    expect(() => requireValidRegimeTagsOrUndefined(["bull", "bull_microcap"], 7)).toThrow(
      /line 7: regime_tags contains "bull_microcap"/,
    );
    // The closed vocabulary is spelled out for the operator fixing the backup.
    expect(() => requireValidRegimeTagsOrUndefined(["bull_microcap"], 7)).toThrow(
      /bull\|bear\|range\|high_vol\|low_vol/,
    );
  });

  it("does NOT silently normalize: a near-miss tag is an error, not a guess", () => {
    expect(() => requireValidRegimeTagsOrUndefined(["BULL"], 2)).toThrow(/"BULL"/);
    expect(() => requireValidRegimeTagsOrUndefined(["high"], 2)).toThrow(/"high"/); // vol tags are axis-qualified
  });

  it("dedupes repeated VALID tags (canonicalization), preserving first-seen order", () => {
    expect(requireValidRegimeTagsOrUndefined(["bull", "bull", "high_vol", "bull"], 5)).toEqual([
      "bull",
      "high_vol",
    ]);
  });

  it("still rejects a non-array shape with the original message", () => {
    expect(() => requireValidRegimeTagsOrUndefined("bull", 9)).toThrow(
      /regime_tags must be an array of strings/,
    );
    expect(() => requireValidRegimeTagsOrUndefined(["bull", 7], 9)).toThrow(
      /regime_tags must be an array of strings/,
    );
  });
});
