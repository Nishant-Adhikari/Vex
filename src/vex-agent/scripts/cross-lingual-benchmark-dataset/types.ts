/**
 * Cross-lingual benchmark dataset — shared types and language tuple.
 *
 * Extracted verbatim from the dataset façade. The pair shape and the
 * language tuple are the stable contract consumed across the benchmark.
 */

export interface BenchmarkPair {
  id: string;
  lang: "en" | "pl" | "fr" | "zh" | "vi";
  topic: string;
  queryNative: string;
  titleEn: string;
  titleNative: string;
  summaryEn: string;
  summaryNative: string;
}

/** Unique languages present in the dataset, in the order they appear. */
export const BENCHMARK_LANGS = ["en", "pl", "fr", "zh", "vi"] as const;
export type BenchmarkLang = (typeof BENCHMARK_LANGS)[number];
