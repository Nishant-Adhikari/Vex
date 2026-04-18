/**
 * Session-episodes recall — top-K cosine retrieval.
 *
 * The model+dim filter is MANDATORY: mixed-dim `<=>` crashes pgvector
 * and cross-model similarity is semantically meaningless. See
 * `src/echo-agent/engine/core/turn.ts` for the raw-input recall path
 * that feeds this (PR1 of `vex_simplified_gate` removed the English
 * translation shim — queries go straight from user text into
 * `embedQuery()` and then here).
 */

import { query } from "../../client.js";
import { vectorLiteral } from "../knowledge/types.js";
import {
  EPISODE_COLUMNS,
  mapRow,
  type RecallFilters,
  type RecallHit,
  type SessionEpisodeRecallRow,
} from "./types.js";

/**
 * Top-K cosine recall scoped to (`memory_scope_key`, `embedding_model`,
 * `embedding_dim`).
 *
 * Returns results sorted by similarity DESC, filtered by `minSimilarity`
 * (if provided) after the cosine conversion.
 */
export async function recallTopK(
  queryEmbedding: readonly number[],
  filters: RecallFilters,
): Promise<RecallHit[]> {
  if (filters.topK <= 0) return [];
  if (queryEmbedding.length !== filters.embeddingDim) {
    throw new Error(
      `recallTopK: query embedding length ${queryEmbedding.length} does not match filter dim ${filters.embeddingDim}`,
    );
  }

  const rows = await query<SessionEpisodeRecallRow>(
    `SELECT
       ${EPISODE_COLUMNS},
       (embedding <=> $1::vector) AS cosine_distance
     FROM session_episodes
     WHERE memory_scope_key = $2
       AND embedding_model  = $3
       AND embedding_dim    = $4
     ORDER BY embedding <=> $1::vector
     LIMIT $5`,
    [
      vectorLiteral(queryEmbedding),
      filters.memoryScopeKey,
      filters.embeddingModel,
      filters.embeddingDim,
      filters.topK,
    ],
  );

  const minSim = filters.minSimilarity ?? 0;
  const hits: RecallHit[] = [];
  for (const r of rows) {
    const similarity = clampUnit(1 - r.cosine_distance);
    if (similarity < minSim) continue;
    hits.push({ episode: mapRow(r), similarity });
  }
  return hits;
}

function clampUnit(x: number): number {
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}
