/**
 * Cross-lingual benchmark dataset — curated retrieval pairs.
 *
 * Each pair represents one realistic Vex session memory lookup: a user query
 * in their native language that should retrieve one specific session-memory
 * summary from a pool of ~N memory records across various topics.
 *
 * Languages covered: en, pl, fr, zh, vi (5 × 6 pairs = 30 pairs total).
 * Topic distribution per language is identical — for every topic there is
 * exactly one pair per language. That makes Mode A (cross-lingual) comparable
 * across languages: the English document pool is the same regardless of
 * which query language is being probed.
 *
 * Title fields (titleEn / titleNative) simulate LLM-generated memory titles.
 * They are <=100 characters, content-aware, and in the document's language.
 * The native-title variant is retained as historical benchmark data; current
 * production session memory is English-by-contract.
 * Rationale: if we benchmark the old slice-based title, we measure a baseline
 * we're about to abandon, and then have to redo the benchmark post-PR2.
 *
 * Shape — per pair:
 *   id:            unique identifier (lang-topic)
 *   lang:          ISO code (2-3 letter, e.g. "en", "pl", "zh")
 *   topic:         semantic theme — also serves as distractor control
 *   queryNative:   what the user types in their native language (recall side)
 *   titleEn:       simulated LLM-generated chunk title, English
 *   titleNative:   simulated LLM-generated chunk title, native language
 *   summaryEn:     chunk summary in English (post-PR5 contract: chunker writes English)
 *   summaryNative: native-language baseline for cross-lingual benchmark comparison
 *
 * Mode A (cross-lingual, legacy EN corpus): query=queryNative, doc=(titleEn, summaryEn).
 *   Measures whether we can cut the hot-path translation today without losing
 *   recall on sessions that still have English summaries.
 *
 * Mode B (same-language, historical native-document comparison):
 *   query=queryNative, doc=(titleNative, summaryNative). Useful for embedding
 *   model evaluation; production session memory now stores English text.
 *
 * NOT machine-translated. Every non-English variant is a natural-sounding
 * equivalent, not a word-for-word render — that's the whole point of testing
 * a multilingual embedder. If the model can retrieve a natural PL query
 * against a natural PL document (Mode B) and a natural PL query against the
 * EN document (Mode A), the pivot is safe.
 */

import { enPairs } from "./cross-lingual-benchmark-dataset/pairs-en.js";
import { plPairs } from "./cross-lingual-benchmark-dataset/pairs-pl.js";
import { frPairs } from "./cross-lingual-benchmark-dataset/pairs-fr.js";
import { zhPairs } from "./cross-lingual-benchmark-dataset/pairs-zh.js";
import { viPairs } from "./cross-lingual-benchmark-dataset/pairs-vi.js";
import type { BenchmarkPair } from "./cross-lingual-benchmark-dataset/types.js";

export type { BenchmarkPair, BenchmarkLang } from "./cross-lingual-benchmark-dataset/types.js";
export { BENCHMARK_LANGS } from "./cross-lingual-benchmark-dataset/types.js";

export const BENCHMARK_PAIRS: readonly BenchmarkPair[] = [
  ...enPairs,
  ...plPairs,
  ...frPairs,
  ...zhPairs,
  ...viPairs,
];
