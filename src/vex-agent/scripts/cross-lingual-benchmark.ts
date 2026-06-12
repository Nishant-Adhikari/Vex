/**
 * cross-lingual-benchmark — Phase 0 hard gate for the language pivot.
 *
 * Stand-alone maintenance command. Embeds the curated benchmark dataset against the local
 * EmbeddingGemma endpoint (or whatever EMBEDDING_BASE_URL points at) and
 * produces a markdown report covering two retrieval modes:
 *
 *   Mode A — raw native query → English session-memory summary:
 *     validates recall against the current English-by-contract memory corpus.
 *
 *   Mode B — native query → native session-memory summary:
 *     retains the historical native-document comparison data. It is useful for
 *     model evaluation, but production session memory now stores English text.
 *
 * Metrics: Recall@1, Recall@3, average and minimum margin vs the best
 * distractor in the candidate pool. No hard threshold is encoded — the
 * operator reads the report and fills in the `Verdict:` line in the
 * Recommendation section. Worst failure cases per language are surfaced
 * automatically so the operator has the data to judge.
 *
 * Usage:
 *   pnpm exec tsx src/vex-agent/scripts/cross-lingual-benchmark.ts
 *
 * Required env (same contract as production embeddings — see config.ts):
 *   EMBEDDING_BASE_URL   e.g. http://127.0.0.1:27134/v1
 *   EMBEDDING_MODEL      e.g. ai/embeddinggemma:300M-Q8_0
 *   EMBEDDING_DIM        e.g. 768
 *   EMBEDDING_PROVIDER   e.g. local
 *
 * Optional:
 *   BENCHMARK_OUTPUT_PATH   override markdown output path
 *                           (default: docs/benchmarks/cross-lingual-recall.md)
 */

import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import logger from "@utils/logger.js";

import { runBenchmark } from "./cross-lingual-benchmark/runner.js";

export { runBenchmark };

// ── Command entry ────────────────────────────────────────────────────

const isMain = (() => {
  try {
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1]!)).href;
  } catch {
    return false;
  }
})();

if (isMain) {
  const outputPath = process.env.BENCHMARK_OUTPUT_PATH
    ? resolve(process.env.BENCHMARK_OUTPUT_PATH)
    : resolve(process.cwd(), "docs/benchmarks/cross-lingual-recall.md");

  runBenchmark(outputPath)
    .then(report => {
      const totalScored = report.datasetSize * 2; // Mode A + Mode B
      const totalHit1 = report.perLang.reduce((s, r) => s + r.hit1, 0);
      logger.info("benchmark.summary", {
        outputPath,
        totalScored,
        totalHit1,
        recall1Pct: Number(((totalHit1 / totalScored) * 100).toFixed(1)),
        nextStep:
          "review the report, fill in the Recommendation section, decide go/no-go on the language pivot",
      });
      process.exit(0);
    })
    .catch(err => {
      logger.error("benchmark.failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      process.exit(1);
    });
}
