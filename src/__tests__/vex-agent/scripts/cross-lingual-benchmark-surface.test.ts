/**
 * Surface test for the cross-lingual-benchmark B-000 grounding split.
 *
 * Pins the public façade export (`runBenchmark`) plus the pure scoring
 * internals that the split widened beyond the public surface (`cosine`,
 * `scoreMode`, `aggregate`). The orchestration and embedding phases are
 * network-bound and intentionally NOT exercised here — these assertions
 * guard the byte-identical math + Mode-A/B pool semantics + aggregate row
 * ordering that the split must preserve.
 */

import { describe, expect, it } from "vitest";

import { BENCHMARK_LANGS } from "../../../vex-agent/scripts/cross-lingual-benchmark-dataset.js";
import { runBenchmark } from "../../../vex-agent/scripts/cross-lingual-benchmark.js";
import {
  aggregate,
  cosine,
  scoreMode,
} from "../../../vex-agent/scripts/cross-lingual-benchmark/score.js";
import type { EmbeddedPair } from "../../../vex-agent/scripts/cross-lingual-benchmark/types.js";

// A minimal BenchmarkPair builder so the synthetic fixtures stay readable.
// queryEmbed / docEmbedA / docEmbedB are 2-D so the cosine math is trivial
// to reason about by hand.
function makePair(
  id: string,
  lang: (typeof BENCHMARK_LANGS)[number],
  topic: string,
  queryEmbed: number[],
  docEmbedA: number[],
  docEmbedB: number[],
): EmbeddedPair {
  return {
    pair: {
      id,
      lang,
      topic,
      queryNative: `q-${id}`,
      titleEn: `te-${id}`,
      titleNative: `tn-${id}`,
      summaryEn: `se-${id}`,
      summaryNative: `sn-${id}`,
    },
    queryEmbed,
    docEmbedA,
    docEmbedB,
  };
}

describe("cross-lingual-benchmark façade surface", () => {
  it("re-exports runBenchmark as a function", () => {
    expect(typeof runBenchmark).toBe("function");
  });
});

describe("cosine (full-normalization, byte-identical math)", () => {
  it("identity vectors → 1", () => {
    expect(cosine([1, 0, 0], [1, 0, 0])).toBe(1);
  });

  it("orthogonal vectors → 0", () => {
    expect(cosine([1, 0], [0, 1])).toBe(0);
  });

  it("zero-magnitude vector → 0 (denom guard)", () => {
    expect(cosine([0, 0], [1, 1])).toBe(0);
  });

  it("throws on dimension mismatch", () => {
    expect(() => cosine([1, 2, 3], [1, 2])).toThrow(/dim mismatch 3 vs 2/);
  });
});

describe("scoreMode — Mode-A dedupe vs Mode-B full pool", () => {
  it("Mode A collapses the pool to the canonical doc per topic; Mode B keeps all docs", () => {
    // 2 topics × 2 langs = 4 pairs. docEmbedA is identical across the two
    // language variants of a topic (the canonical EN doc), so Mode A must
    // dedupe to exactly 2 docs (one per topic). Mode B uses the unique native
    // docs, so its pool is all 4. We give every query a perfect match to its
    // own topic's canonical EN doc and an orthogonal distractor topic.
    const t1A = [1, 0];
    const t2A = [0, 1];
    const embedded: EmbeddedPair[] = [
      // topic t1
      makePair("t1-en", "en", "t1", [1, 0], t1A, [1, 0]),
      makePair("t1-pl", "pl", "t1", [1, 0], t1A, [0.9, 0.1]),
      // topic t2
      makePair("t2-en", "en", "t2", [0, 1], t2A, [0, 1]),
      makePair("t2-pl", "pl", "t2", [0, 1], t2A, [0.1, 0.9]),
    ];

    const modeA = scoreMode(embedded, "A");
    const modeB = scoreMode(embedded, "B");

    // One PerPairResult per query in both modes.
    expect(modeA).toHaveLength(4);
    expect(modeB).toHaveLength(4);

    // Mode A: target matched by topic against the 2-doc canonical pool.
    // Every query aligns perfectly with its own topic doc (rank 1, score 1)
    // and the only distractor is the other topic (orthogonal → margin 1).
    for (const r of modeA) {
      expect(r.targetRank).toBe(1);
      expect(r.targetScore).toBeCloseTo(1, 10);
      expect(r.bestDistractorScore).toBeCloseTo(0, 10);
    }
  });

  it("Mode A dedupes to FIRST occurrence per topic (single-topic → pool of 1 throws)", () => {
    // 1 topic × 2 langs. Mode A dedupes to a pool of exactly 1 canonical doc,
    // so there is no distractor and scoreMode("A") must throw. Mode B keeps
    // both native docs (pool of 2) and succeeds. This pins the collapse-to-
    // topic-count semantics: Mode-A pool size == distinct topic count.
    const docA = [1, 0];
    const embedded: EmbeddedPair[] = [
      // Each native query aligns with its own native doc (distinct per pair),
      // so the 2-doc Mode-B pool ranks each target #1.
      makePair("only-en", "en", "solo", [1, 0], docA, [1, 0]),
      makePair("only-pl", "pl", "solo", [0, 1], docA, [0, 1]),
    ];

    expect(() => scoreMode(embedded, "A")).toThrow(
      /pool of size 1 — no distractors \(mode=A\)/,
    );

    const modeB = scoreMode(embedded, "B");
    expect(modeB).toHaveLength(2);
    for (const r of modeB) {
      expect(r.targetRank).toBe(1);
    }
  });
});

describe("aggregate — row ordering", () => {
  it("emits rows in BENCHMARK_LANGS order with mode A before mode B per language", () => {
    // Build pairs for two languages so aggregate produces multiple rows.
    const embedded: EmbeddedPair[] = [
      makePair("en-1", "en", "t1", [1, 0], [1, 0], [1, 0]),
      makePair("en-2", "en", "t2", [0, 1], [0, 1], [0, 1]),
      makePair("pl-1", "pl", "t1", [1, 0], [1, 0], [1, 0]),
      makePair("pl-2", "pl", "t2", [0, 1], [0, 1], [0, 1]),
    ];

    const perPair = [...scoreMode(embedded, "A"), ...scoreMode(embedded, "B")];
    const rows = aggregate(perPair);

    // Expected: en/A, en/B, pl/A, pl/B — BENCHMARK_LANGS order, A before B.
    expect(rows.map(r => `${r.lang}/${r.mode}`)).toEqual([
      "en/A",
      "en/B",
      "pl/A",
      "pl/B",
    ]);

    // The relative order of the two languages must match BENCHMARK_LANGS.
    const langOrder = rows.map(r => r.lang);
    const enIdx = langOrder.indexOf("en");
    const plIdx = langOrder.indexOf("pl");
    expect(BENCHMARK_LANGS.indexOf("en")).toBeLessThan(BENCHMARK_LANGS.indexOf("pl"));
    expect(enIdx).toBeLessThan(plIdx);
  });
});
