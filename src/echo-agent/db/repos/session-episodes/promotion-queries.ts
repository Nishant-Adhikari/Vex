/**
 * Session-episodes promotion queries — the subset the promotion pipeline
 * needs: list candidates + count near-duplicates in scope.
 *
 * Both queries are READ-ONLY. The actual write path (INSERT into
 * `knowledge_entries`) lives in `src/echo-agent/knowledge/promotion/persist.ts`
 * under `withLeaseSharedLock` — this file must NEVER take the maintenance
 * lease itself.
 */

import { getPool, query, queryOneWith } from "../../client.js";
import { vectorLiteral } from "../knowledge/types.js";
import {
  EPISODE_COLUMNS,
  mapRow,
  type EpisodeKind,
  type SessionEpisode,
  type SessionEpisodeRow,
} from "./types.js";

/** Kinds eligible for promotion — decision/preference/lesson always, fact conservatively. */
export const PROMOTABLE_KINDS: readonly EpisodeKind[] = [
  "decision",
  "preference",
  "lesson",
  "fact",
] as const;

/**
 * Episode variant used by the promotion pipeline — carries the raw
 * embedding so `countSimilar` can do cosine math without a separate
 * per-candidate fetch.
 */
export interface PromotionCandidate extends SessionEpisode {
  embedding: number[];
}

/**
 * List episodes that are CANDIDATES for promotion:
 *   - scope-local (same `memory_scope_key`)
 *   - kind in `PROMOTABLE_KINDS`
 *   - have a `source_end_message_id` (not ad-hoc)
 *   - not already promoted (no row in knowledge_entries with this
 *     `source_episode_id` — LEFT JOIN + NULL check)
 *
 * Returns `PromotionCandidate[]` (with the raw embedding) so the pipeline
 * can cluster-check near-duplicates via `countSimilar` without a second
 * DB round-trip per candidate.
 *
 * Ordered by `created_at DESC, id DESC` — fresher candidates first.
 */
export async function listPromotable(
  memoryScopeKey: string,
  limit = 50,
): Promise<PromotionCandidate[]> {
  const prefixedCols = EPISODE_COLUMNS
    .split(",")
    .map(c => "e." + c.trim())
    .join(", ");
  // Embedding comes back as a pgvector literal string like "[0.1,0.2,...]".
  // Parse into number[] below.
  const rows = await query<SessionEpisodeRow & { embedding_text: string }>(
    `SELECT ${prefixedCols},
            e.embedding::text AS embedding_text
     FROM session_episodes e
     LEFT JOIN knowledge_entries k ON k.source_episode_id = e.id
     WHERE e.memory_scope_key = $1
       AND e.source_end_message_id IS NOT NULL
       AND e.episode_kind = ANY($2::text[])
       AND k.id IS NULL
     ORDER BY e.created_at DESC, e.id DESC
     LIMIT $3`,
    // pg accepts `readonly string[]` for `text[]` params; the spread keeps
    // the literal types in the `PROMOTABLE_KINDS` const visible to TS.
    [memoryScopeKey, [...PROMOTABLE_KINDS], limit],
  );
  return rows.map(r => ({
    ...mapRow(r),
    embedding: parseVectorLiteral(r.embedding_text),
  }));
}

/**
 * Count near-duplicates of a candidate episode in the same scope + kind,
 * above a cosine similarity threshold. Excludes the candidate itself.
 * Used by promotion to apply the "N=2 similar episodes" signal — a single
 * one-off assertion shouldn't promote; a repeated observation should.
 *
 * Filters on (`memory_scope_key`, `episode_kind`, `embedding_model`,
 * `embedding_dim`) — mixed-model cosines would be semantic nonsense and
 * mixed-dim would crash pgvector.
 */
export async function countSimilar(
  episodeId: number,
  memoryScopeKey: string,
  episodeKind: EpisodeKind,
  queryEmbedding: readonly number[],
  embeddingModel: string,
  threshold: number,
): Promise<number> {
  if (queryEmbedding.length === 0) return 0;
  const row = await queryOneWith<{ n: string }>(
    getPool(),
    `SELECT count(*)::text AS n
     FROM session_episodes
     WHERE id <> $1
       AND memory_scope_key = $2
       AND episode_kind = $3
       AND embedding_model = $4
       AND embedding_dim = $5
       AND (1 - (embedding <=> $6::vector)) >= $7`,
    [
      episodeId,
      memoryScopeKey,
      episodeKind,
      embeddingModel,
      queryEmbedding.length,
      vectorLiteral(queryEmbedding),
      threshold,
    ],
  );
  return row ? parseInt(row.n, 10) : 0;
}

/**
 * Parse a pgvector string literal (`"[0.1,0.2,...]"`) back into a
 * `number[]` so the promotion pipeline can feed it to `countSimilar`.
 */
function parseVectorLiteral(literal: string): number[] {
  if (!literal) return [];
  const inner = literal.startsWith("[") && literal.endsWith("]")
    ? literal.slice(1, -1)
    : literal;
  if (inner.length === 0) return [];
  return inner.split(",").map(s => Number(s));
}
