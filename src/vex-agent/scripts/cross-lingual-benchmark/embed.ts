/**
 * cross-lingual-benchmark/embed — network embedding phase.
 *
 * Split out of the original cross-lingual-benchmark.ts façade (B-000 grounding
 * split). Owns the IO-bound pass over the benchmark dataset against the local
 * embedding endpoint.
 */

import { embedDocument, embedQuery } from "@vex-agent/embeddings/client.js";
import { type EmbeddingConfig } from "@vex-agent/embeddings/config.js";
import logger from "@utils/logger.js";

import { BENCHMARK_PAIRS } from "../cross-lingual-benchmark-dataset.js";

import type { EmbeddedPair } from "./types.js";

export async function embedAllPairs(
  config: EmbeddingConfig,
): Promise<{ embedded: EmbeddedPair[]; providerModel: string }> {
  const embedded: EmbeddedPair[] = [];
  let providerModel: string = config.model;
  let providerModelCaptured = false;

  for (let i = 0; i < BENCHMARK_PAIRS.length; i++) {
    const pair = BENCHMARK_PAIRS[i]!;
    logger.info("benchmark.embed.pair", {
      index: i + 1,
      total: BENCHMARK_PAIRS.length,
      id: pair.id,
    });

    const q = await embedQuery(pair.queryNative, config);
    const a = await embedDocument(pair.titleEn, pair.summaryEn, config);
    const b = await embedDocument(pair.titleNative, pair.summaryNative, config);

    // Stash the first provider-reported model name — it goes into the
    // report as the audit value (see embeddings/client.ts contract).
    if (!providerModelCaptured) {
      providerModel = q.providerModel;
      providerModelCaptured = true;
    }

    embedded.push({
      pair,
      queryEmbed: q.embedding,
      docEmbedA: a.embedding,
      docEmbedB: b.embedding,
    });
  }

  logger.info("benchmark.embed.done", {
    pairs: embedded.length,
    providerModel,
  });
  return { embedded, providerModel };
}
