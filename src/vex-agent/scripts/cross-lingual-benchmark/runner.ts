/**
 * cross-lingual-benchmark/runner — runBenchmark orchestration.
 *
 * Split out of the original cross-lingual-benchmark.ts façade (B-000 grounding
 * split). Wires the embedding phase, scoring, aggregation, and report write.
 * The CLI entrypoint (isMain guard) stays in the original façade file so that
 * `import.meta.url === pathToFileURL(realpathSync(process.argv[1]))` resolves
 * against the invoked file.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { loadEmbeddingConfig } from "@vex-agent/embeddings/config.js";
import logger from "@utils/logger.js";

import { BENCHMARK_LANGS, BENCHMARK_PAIRS } from "../cross-lingual-benchmark-dataset.js";

import { embedAllPairs } from "./embed.js";
import { renderReport } from "./report.js";
import { aggregate, pickWorstFailures, scoreMode } from "./score.js";
import type { BenchmarkReport } from "./types.js";

export async function runBenchmark(
  outputPath: string = resolve(process.cwd(), "docs/benchmarks/cross-lingual-recall.md"),
): Promise<BenchmarkReport> {
  const config = loadEmbeddingConfig();

  const runStartedAt = new Date().toISOString();
  logger.info("benchmark.start", {
    pairs: BENCHMARK_PAIRS.length,
    langs: BENCHMARK_LANGS,
    baseUrl: config.baseUrl,
    model: config.model,
    dim: config.dim,
  });

  const { embedded, providerModel } = await embedAllPairs(config);

  const modeA = scoreMode(embedded, "A");
  const modeB = scoreMode(embedded, "B");
  const perPair = [...modeA, ...modeB];
  const perLang = aggregate(perPair);
  const worstPerLang = pickWorstFailures(perPair);

  const runFinishedAt = new Date().toISOString();
  const report: BenchmarkReport = {
    runStartedAt,
    runFinishedAt,
    config: {
      baseUrl: config.baseUrl,
      requestedModel: config.model,
      providerModel,
      dim: config.dim,
      provider: config.provider,
    },
    datasetSize: BENCHMARK_PAIRS.length,
    perPair,
    perLang,
    worstPerLang,
  };

  const md = renderReport(report);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, md, "utf-8");

  logger.info("benchmark.done", {
    outputPath,
    modeA: {
      hit1: modeA.filter(r => r.targetRank === 1).length,
      pairs: modeA.length,
    },
    modeB: {
      hit1: modeB.filter(r => r.targetRank === 1).length,
      pairs: modeB.length,
    },
  });

  return report;
}
