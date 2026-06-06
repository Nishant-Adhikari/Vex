/**
 * cross-lingual-benchmark/score — pure cosine/scoring/aggregation math.
 *
 * Split out of the original cross-lingual-benchmark.ts façade (B-000 grounding
 * split). All functions are pure (no IO); exported beyond the public surface so
 * the surface test can pin the cosine + Mode-A/B pool semantics directly.
 */

import {
  BENCHMARK_LANGS,
  type BenchmarkLang,
  type BenchmarkPair,
} from "../cross-lingual-benchmark-dataset.js";

import type { EmbeddedPair, Mode, PerLangAggregate, PerPairResult } from "./types.js";

// ── Cosine similarity ────────────────────────────────────────────────

/**
 * Cosine similarity between two equal-length vectors.
 *
 * EmbeddingGemma outputs L2-normalized vectors per the model card, so
 * cosine collapses to dot product. We still compute full cosine here to
 * be robust against any provider that returns un-normalized embeddings.
 */
export function cosine(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length) {
    throw new Error(`cosine: dim mismatch ${a.length} vs ${b.length}`);
  }
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const av = a[i]!;
    const bv = b[i]!;
    dot += av * bv;
    na += av * av;
    nb += bv * bv;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  if (denom === 0) return 0;
  return dot / denom;
}

// ── Scoring phase ────────────────────────────────────────────────────

export function scoreMode(
  embedded: readonly EmbeddedPair[],
  mode: Mode,
): PerPairResult[] {
  // Mode A uses the legacy EN corpus: summaryEn/titleEn are identical across
  // all language variants of the same topic, so 5 of every 6 documents collide
  // at the embedding level. Dedupe down to 6 canonical EN docs (one per topic)
  // and match the target by topic. That gives queries a meaningful pool of
  // distractors (the other 5 topics) instead of 4 indistinguishable duplicates.
  //
  // Mode B uses native-language documents which are unique per pair, so the
  // pool is all 30 docs and target matching is by pair id.
  type PoolDoc = { key: string; topic: string; embed: number[] };

  let pool: PoolDoc[];
  let targetKey: (p: BenchmarkPair) => string;

  if (mode === "A") {
    const seen = new Set<string>();
    pool = [];
    for (const e of embedded) {
      if (seen.has(e.pair.topic)) continue;
      seen.add(e.pair.topic);
      pool.push({
        key: `<topic:${e.pair.topic}>`,
        topic: e.pair.topic,
        embed: e.docEmbedA,
      });
    }
    targetKey = p => `<topic:${p.topic}>`;
  } else {
    pool = embedded.map(e => ({
      key: e.pair.id,
      topic: e.pair.topic,
      embed: e.docEmbedB,
    }));
    targetKey = p => p.id;
  }

  const results: PerPairResult[] = [];

  for (const { pair, queryEmbed } of embedded) {
    const scored = pool.map(d => ({
      key: d.key,
      score: cosine(queryEmbed, d.embed),
    }));

    // Sort descending so rank=1 is best match.
    scored.sort((a, b) => b.score - a.score);

    const wantKey = targetKey(pair);
    const targetRank = scored.findIndex(s => s.key === wantKey) + 1;
    if (targetRank === 0) {
      throw new Error(`scoreMode: target ${wantKey} not found in pool (mode=${mode})`);
    }
    const targetScore = scored[targetRank - 1]!.score;

    const bestDistractor = scored.find(s => s.key !== wantKey);
    if (!bestDistractor) {
      throw new Error(`scoreMode: pool of size 1 — no distractors (mode=${mode})`);
    }

    results.push({
      pairId: pair.id,
      lang: pair.lang,
      topic: pair.topic,
      mode,
      targetRank,
      targetScore,
      bestDistractorScore: bestDistractor.score,
      margin: targetScore - bestDistractor.score,
    });
  }

  return results;
}

// ── Aggregation ──────────────────────────────────────────────────────

export function aggregate(perPair: readonly PerPairResult[]): PerLangAggregate[] {
  const out: PerLangAggregate[] = [];

  for (const lang of BENCHMARK_LANGS) {
    for (const mode of ["A", "B"] as const) {
      const subset = perPair.filter(r => r.lang === lang && r.mode === mode);
      if (subset.length === 0) continue;
      const hit1 = subset.filter(r => r.targetRank === 1).length;
      const hit3 = subset.filter(r => r.targetRank <= 3).length;
      const avgMargin = subset.reduce((s, r) => s + r.margin, 0) / subset.length;
      const minMargin = Math.min(...subset.map(r => r.margin));
      out.push({ lang, mode, pairs: subset.length, hit1, hit3, avgMargin, minMargin });
    }
  }

  return out;
}

/**
 * Pick worst failures per language: up to 3 pairs across both modes,
 * preferring misses (targetRank > 1) over low-margin hits.
 */
export function pickWorstFailures(
  perPair: readonly PerPairResult[],
): Record<BenchmarkLang, PerPairResult[]> {
  const out = Object.fromEntries(
    BENCHMARK_LANGS.map(l => [l, [] as PerPairResult[]]),
  ) as Record<BenchmarkLang, PerPairResult[]>;

  for (const lang of BENCHMARK_LANGS) {
    const subset = perPair.filter(r => r.lang === lang);
    const ranked = [...subset].sort((a, b) => {
      // Prioritize misses (rank > 1 = higher bucket), then smallest margin.
      if (a.targetRank !== b.targetRank) return b.targetRank - a.targetRank;
      return a.margin - b.margin;
    });
    out[lang] = ranked.slice(0, 3);
  }

  return out;
}
