import { describe, it, expect } from "vitest";
import {
  BENCHMARK_PAIRS,
  BENCHMARK_LANGS,
  type BenchmarkPair,
} from "../../../vex-agent/scripts/cross-lingual-benchmark-dataset.js";

/**
 * Surface guard for the A-045 data-literal split. Pins the public export
 * surface and the exact element order / id sequence of BENCHMARK_PAIRS so a
 * regrouping or accidental reorder in the per-language chunk modules is caught.
 */

const EXPECTED_IDS: readonly string[] = [
  // English (6)
  "en-balance",
  "en-swap",
  "en-slippage",
  "en-hold-eth",
  "en-pnl",
  "en-gas",
  // Polish (6)
  "pl-balance",
  "pl-swap",
  "pl-slippage",
  "pl-hold-eth",
  "pl-pnl",
  "pl-gas",
  // French (6)
  "fr-balance",
  "fr-swap",
  "fr-slippage",
  "fr-hold-eth",
  "fr-pnl",
  "fr-gas",
  // Chinese (6)
  "zh-balance",
  "zh-swap",
  "zh-slippage",
  "zh-hold-eth",
  "zh-pnl",
  "zh-gas",
  // Vietnamese (6)
  "vi-balance",
  "vi-swap",
  "vi-slippage",
  "vi-hold-eth",
  "vi-pnl",
  "vi-gas",
];

const REQUIRED_KEYS: ReadonlyArray<keyof BenchmarkPair> = [
  "id",
  "lang",
  "topic",
  "queryNative",
  "titleEn",
  "titleNative",
  "summaryEn",
  "summaryNative",
];

describe("cross-lingual-benchmark-dataset surface", () => {
  it("exposes exactly 30 benchmark pairs", () => {
    expect(BENCHMARK_PAIRS.length).toBe(30);
  });

  it("preserves the exact ordered id sequence (en→pl→fr→zh→vi, 6 each)", () => {
    expect(BENCHMARK_PAIRS.map((p) => p.id)).toEqual(EXPECTED_IDS);
  });

  it("BENCHMARK_LANGS deep-equals the canonical 5-tuple", () => {
    expect(BENCHMARK_LANGS).toEqual(["en", "pl", "fr", "zh", "vi"]);
  });

  it("every pair carries all 8 required string keys", () => {
    for (const pair of BENCHMARK_PAIRS) {
      for (const key of REQUIRED_KEYS) {
        expect(typeof pair[key]).toBe("string");
        expect(pair[key].length).toBeGreaterThan(0);
      }
    }
  });

  it("contains exactly 6 pairs per language", () => {
    const counts = new Map<string, number>();
    for (const pair of BENCHMARK_PAIRS) {
      counts.set(pair.lang, (counts.get(pair.lang) ?? 0) + 1);
    }
    for (const lang of BENCHMARK_LANGS) {
      expect(counts.get(lang)).toBe(6);
    }
    // No stray languages beyond the canonical tuple.
    expect(counts.size).toBe(BENCHMARK_LANGS.length);
  });
});
