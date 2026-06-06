/**
 * cross-lingual-benchmark/types — shared type surface for the benchmark.
 *
 * Split out of the original cross-lingual-benchmark.ts façade (B-000 grounding
 * split). Pure type declarations; no runtime behavior.
 */

import type { BenchmarkLang, BenchmarkPair } from "../cross-lingual-benchmark-dataset.js";

export type Mode = "A" | "B";

export interface PerPairResult {
  pairId: string;
  lang: BenchmarkLang;
  topic: string;
  mode: Mode;
  targetRank: number;          // 1-based rank of the correct doc in the pool
  targetScore: number;         // cosine(query, target doc)
  bestDistractorScore: number; // cosine(query, best-non-target doc)
  margin: number;              // targetScore - bestDistractorScore (positive = target wins)
}

export interface PerLangAggregate {
  lang: BenchmarkLang;
  mode: Mode;
  pairs: number;
  hit1: number;
  hit3: number;
  avgMargin: number;
  minMargin: number;
}

export interface BenchmarkReport {
  runStartedAt: string;
  runFinishedAt: string;
  config: {
    baseUrl: string;
    requestedModel: string;
    providerModel: string;
    dim: number;
    provider: string;
  };
  datasetSize: number;
  perPair: PerPairResult[];
  perLang: PerLangAggregate[];
  worstPerLang: Record<BenchmarkLang, PerPairResult[]>;
}

export interface EmbeddedPair {
  pair: BenchmarkPair;
  queryEmbed: number[];
  docEmbedA: number[]; // Mode A: (titleEn, summaryEn)
  docEmbedB: number[]; // Mode B: (titleNative, summaryNative)
}
