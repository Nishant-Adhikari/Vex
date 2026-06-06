/**
 * cross-lingual-benchmark/report — markdown report rendering.
 *
 * Split out of the original cross-lingual-benchmark.ts façade (B-000 grounding
 * split). Pure formatting; the markdown template is preserved byte-identical.
 */

import {
  BENCHMARK_LANGS,
  BENCHMARK_PAIRS,
  type BenchmarkLang,
  type BenchmarkPair,
} from "../cross-lingual-benchmark-dataset.js";

import type { BenchmarkReport, Mode, PerLangAggregate, PerPairResult } from "./types.js";

export function fmtPct(num: number, den: number): string {
  if (den === 0) return "n/a";
  return `${((num / den) * 100).toFixed(1)}%`;
}

export function fmtMargin(m: number): string {
  return (m >= 0 ? "+" : "") + m.toFixed(3);
}

export function renderModeTable(perLang: readonly PerLangAggregate[], mode: Mode): string {
  const rows = perLang.filter(p => p.mode === mode);
  const header = "| Lang | Pairs | Recall@1 | Recall@3 | Avg margin | Min margin |\n|---|---|---|---|---|---|";
  const body = rows
    .map(r => `| ${r.lang} | ${r.pairs} | ${r.hit1}/${r.pairs} (${fmtPct(r.hit1, r.pairs)}) | ${r.hit3}/${r.pairs} (${fmtPct(r.hit3, r.pairs)}) | ${fmtMargin(r.avgMargin)} | ${fmtMargin(r.minMargin)} |`)
    .join("\n");

  const totalPairs = rows.reduce((s, r) => s + r.pairs, 0);
  const totalHit1 = rows.reduce((s, r) => s + r.hit1, 0);
  const totalHit3 = rows.reduce((s, r) => s + r.hit3, 0);
  const footer = `\n\n**Overall (all ${totalPairs} pairs):** Recall@1 = ${totalHit1}/${totalPairs} (${fmtPct(totalHit1, totalPairs)}), Recall@3 = ${totalHit3}/${totalPairs} (${fmtPct(totalHit3, totalPairs)})`;

  return `${header}\n${body}${footer}`;
}

export function renderWorstSection(
  worst: Record<BenchmarkLang, PerPairResult[]>,
  pairsById: Map<string, BenchmarkPair>,
): string {
  const blocks: string[] = [];
  for (const lang of BENCHMARK_LANGS) {
    const items = worst[lang];
    if (items.length === 0) {
      blocks.push(`- **${lang}**: no pairs (empty dataset for this language)`);
      continue;
    }
    const lines = items.map(r => {
      const pair = pairsById.get(r.pairId);
      const queryPreview = pair ? `"${pair.queryNative}"` : "";
      return `  - \`${r.pairId}\` mode ${r.mode}: rank ${r.targetRank}, target ${r.targetScore.toFixed(3)} vs best distractor ${r.bestDistractorScore.toFixed(3)} (margin ${fmtMargin(r.margin)}) — query: ${queryPreview}`;
    });
    blocks.push(`- **${lang}**:\n${lines.join("\n")}`);
  }
  return blocks.join("\n");
}

export function renderReport(report: BenchmarkReport): string {
  const pairsById = new Map(BENCHMARK_PAIRS.map(p => [p.id, p]));

  return `# Cross-lingual Recall Benchmark

**Run started:** ${report.runStartedAt}
**Run finished:** ${report.runFinishedAt}
**Provider:** ${report.config.provider} @ ${report.config.baseUrl}
**Model:** \`${report.config.requestedModel}\` (provider reported: \`${report.config.providerModel}\`, dim=${report.config.dim})
**Dataset:** ${report.datasetSize} pairs across ${BENCHMARK_LANGS.join("/")} (6 per language)
**Title strategy:** simulated LLM-generated titles (the PR2 target shape, not legacy \`summary.slice(0, 120)\`)

---

## Mode A — raw native query → English session-memory summary

Validates recall against the current English-by-contract session-memory corpus.

${renderModeTable(report.perLang, "A")}

---

## Mode B — native query → native session-memory summary

Retains the historical native-document comparison data for embedding model
evaluation. Production session memory now stores English text.

${renderModeTable(report.perLang, "B")}

---

## Recommendation

**Verdict:** \`<TO BE FILLED BY OPERATOR: proceed | do not proceed>\`

**Rationale:** \`<one paragraph — why this result supports or blocks the language pivot>\`

---

## Worst failure cases

Per language, up to 3 pairs ranked by: misses (targetRank > 1) first, then
smallest margin among hits. These are the cases most likely to degrade
recall in production.

${renderWorstSection(report.worstPerLang, pairsById)}

---

## Methodology notes

- **Mode A pool**: 6 canonical English documents — one per topic. We dedupe
  because summaryEn/titleEn are identical across language variants of the
  same topic (they represent the same memory scenario seen from different
  user-side queries). Mode A scores every query (all ${report.datasetSize}
  across 5 languages) against the same 6-doc EN pool; target match is by
  topic. Random baseline: 1/6 = 16.7% Recall@1.
- **Mode B pool**: all ${report.datasetSize} native documents. Each pair has
  a unique native summary, so target matching is by pair id. Distractors
  include same-topic docs in other languages — deliberately harder than
  production, where recall is scoped by \`session_id\` (per-session strict
  isolation). Random baseline: 1/${report.datasetSize} ≈ ${((1 / report.datasetSize) * 100).toFixed(1)}% Recall@1.
- Cosine similarity is computed with full normalization (robust to providers
  that may not L2-normalize).
- Title input to \`embedDocument\` simulates the LLM-generated title PR2
  introduces. If the benchmark passes and the pivot ships, the runtime will
  use actual LLM output — this dataset is the operator's best-faith model of
  what that output will look like.
`;
}
