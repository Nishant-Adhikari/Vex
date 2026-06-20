import { describe, it, expect } from "vitest";
import {
  buildOverflowPreview,
  classifyShape,
} from "@vex-agent/engine/core/tool-output-overflow.js";

/**
 * P0-5 SEAM-1: the overflow preview allowlist now item-previews Polymarket-data
 * top-level list keys (a 5-item slice + `${key}TotalCount`) instead of
 * collapsing them to a bare integer in `otherArrayCounts`.
 */
describe("overflow preview — Polymarket-data list keys (P0-5)", () => {
  const POLYMARKET_KEYS = [
    "positions",
    "activity",
    "trades",
    "openInterest",
    "leaderboard",
    "builders",
    "volume",
    "holders",
  ] as const;

  function previewFor(key: string, itemCount: number): Record<string, unknown> {
    const list = Array.from({ length: itemCount }, (_, i) => ({ i }));
    const output = JSON.stringify({ count: itemCount, [key]: list });
    const shape = classifyShape(output);
    const preview = buildOverflowPreview(output, shape);
    return JSON.parse(preview) as Record<string, unknown>;
  }

  it.each(POLYMARKET_KEYS)("item-previews %s with a 5-item slice + total count", (key) => {
    const parsed = previewFor(key, 12);

    // The list key is sliced to 5, not collapsed to otherArrayCounts.
    expect(Array.isArray(parsed[key])).toBe(true);
    expect((parsed[key] as unknown[]).length).toBe(5);

    const meta = parsed._preview as Record<string, unknown>;
    expect(meta[`${key}TotalCount`]).toBe(12);
    // Not bucketed as an "other" array.
    const other = meta.otherArrayCounts as Record<string, number> | undefined;
    expect(other?.[key]).toBeUndefined();
  });

  it("does NOT add `markets` to the allowlist (collapses to a bare count)", () => {
    const output = JSON.stringify({
      markets: Array.from({ length: 9 }, (_, i) => ({ i })),
    });
    const parsed = JSON.parse(
      buildOverflowPreview(output, classifyShape(output)),
    ) as Record<string, unknown>;

    expect(parsed.markets).toBeUndefined();
    const meta = parsed._preview as Record<string, unknown>;
    const other = meta.otherArrayCounts as Record<string, number>;
    expect(other.markets).toBe(9);
  });

  it("preserves the load-bearing scalar count alongside the slice", () => {
    const parsed = previewFor("trades", 30);
    expect(parsed.count).toBe(30);
    const meta = parsed._preview as Record<string, unknown>;
    expect(meta.tradesTotalCount).toBe(30);
  });
});
