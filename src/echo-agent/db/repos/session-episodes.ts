/**
 * Session episodes repo — mid-term conversational memory store.
 *
 * Sits between `sessions.summary` (rolling per-session) and `knowledge_entries`
 * (canonical curated). Episodes are write-once; promotion to canonical knowledge
 * is a separate follow-up, not in this module.
 *
 * Portability contract (mirrors `knowledge_entries`):
 *   - vector column has NO typmod; per-row `embedding_model` + `embedding_dim`
 *     are authoritative. `recallTopK` MUST filter on both, otherwise pgvector
 *     crashes on mixed-dim `<=>`.
 *   - `embedding.length === embeddingDim` guard runs before SQL so the CHECK
 *     constraint never has to reject the row.
 *   - Dedupe index is partial (`WHERE source_end_message_id IS NOT NULL`), so
 *     callers MUST include the predicate in ON CONFLICT or Postgres won't match
 *     the index. See `src/echo-agent/db/repos/open-positions.ts:54` for prior art.
 */

import { getPool, query, queryOne } from "../client.js";
import { vectorLiteral } from "./knowledge/types.js";

// ── Domain types ────────────────────────────────────────────────

export type EpisodeKind =
  | "decision"
  | "fact"
  | "preference"
  | "open_loop"
  | "tool_result_summary"
  | "lesson";

export const EPISODE_KINDS: readonly EpisodeKind[] = [
  "decision",
  "fact",
  "preference",
  "open_loop",
  "tool_result_summary",
  "lesson",
] as const;

export interface SessionEpisode {
  id: number;
  sessionId: string;
  memoryScopeKey: string;
  episodeKind: EpisodeKind;
  summaryEn: string;
  facts: Record<string, unknown>;
  decisions: Record<string, unknown>;
  openLoops: Record<string, unknown>;
  entities: string[];
  toolOutcomes: Record<string, unknown>;
  sourceSurface: string;
  sourceSession: string | null;
  sourceStartMessageId: number | null;
  sourceEndMessageId: number | null;
  episodeHash: string;
  embeddingModel: string;
  embeddingDim: number;
  createdAt: string;
}

export interface NewEpisode {
  sessionId: string;
  memoryScopeKey: string;
  episodeKind: EpisodeKind;
  summaryEn: string;
  facts?: Record<string, unknown>;
  decisions?: Record<string, unknown>;
  openLoops?: Record<string, unknown>;
  entities?: string[];
  toolOutcomes?: Record<string, unknown>;
  sourceSurface?: string;
  sourceSession?: string | null;
  sourceStartMessageId: number | null;
  sourceEndMessageId: number | null;
  episodeHash: string;
  embeddingModel: string;
  embeddingDim: number;
  embedding: number[];
}

export interface RecallFilters {
  memoryScopeKey: string;
  embeddingModel: string;
  embeddingDim: number;
  topK: number;
  /** Minimum cosine similarity in [0, 1]. Rows below are filtered out. */
  minSimilarity?: number;
}

export interface RecallHit {
  episode: SessionEpisode;
  similarity: number;
}

// ── Row types + mappers ─────────────────────────────────────────

interface SessionEpisodeRow {
  id: number;
  session_id: string;
  memory_scope_key: string;
  episode_kind: string;
  summary_en: string;
  facts_jsonb: Record<string, unknown> | null;
  decisions_jsonb: Record<string, unknown> | null;
  open_loops_jsonb: Record<string, unknown> | null;
  entities: string[] | null;
  tool_outcomes_jsonb: Record<string, unknown> | null;
  source_surface: string;
  source_session: string | null;
  source_start_message_id: number | null;
  source_end_message_id: number | null;
  episode_hash: string;
  embedding_model: string;
  embedding_dim: number;
  created_at: string;
}

interface SessionEpisodeRecallRow extends SessionEpisodeRow {
  cosine_distance: number;
}

function mapRow(r: SessionEpisodeRow): SessionEpisode {
  return {
    id: r.id,
    sessionId: r.session_id,
    memoryScopeKey: r.memory_scope_key,
    episodeKind: r.episode_kind as EpisodeKind,
    summaryEn: r.summary_en,
    facts: r.facts_jsonb ?? {},
    decisions: r.decisions_jsonb ?? {},
    openLoops: r.open_loops_jsonb ?? {},
    entities: r.entities ?? [],
    toolOutcomes: r.tool_outcomes_jsonb ?? {},
    sourceSurface: r.source_surface,
    sourceSession: r.source_session,
    sourceStartMessageId: r.source_start_message_id,
    sourceEndMessageId: r.source_end_message_id,
    episodeHash: r.episode_hash,
    embeddingModel: r.embedding_model,
    embeddingDim: r.embedding_dim,
    createdAt: r.created_at,
  };
}

// ── Insert ──────────────────────────────────────────────────────

/**
 * Batch-insert episodes in a single transaction.
 *
 * Returns only the rows that were newly inserted (ON CONFLICT collisions are
 * dropped). The partial unique index predicate is mirrored in ON CONFLICT so
 * Postgres can match it — omitting the WHERE clause silently disables dedupe.
 *
 * Each row's `embedding.length` is validated against `embeddingDim` before any
 * SQL runs so the DB CHECK constraint never has to reject.
 */
export async function insertEpisodes(rows: readonly NewEpisode[]): Promise<SessionEpisode[]> {
  if (rows.length === 0) return [];

  for (const r of rows) {
    if (r.embedding.length !== r.embeddingDim) {
      throw new Error(
        `insertEpisodes: embedding length ${r.embedding.length} does not match embeddingDim ${r.embeddingDim} ` +
          `(session=${r.sessionId}, hash=${r.episodeHash}). DB CHECK constraint would reject this.`,
      );
    }
  }

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const inserted: SessionEpisode[] = [];

    for (const r of rows) {
      const result = await client.query<SessionEpisodeRow>(
        `INSERT INTO session_episodes (
           session_id, memory_scope_key, episode_kind, summary_en,
           facts_jsonb, decisions_jsonb, open_loops_jsonb, entities, tool_outcomes_jsonb,
           source_surface, source_session,
           source_start_message_id, source_end_message_id,
           episode_hash, embedding_model, embedding_dim, embedding
         )
         VALUES (
           $1, $2, $3, $4,
           $5, $6, $7, $8, $9,
           COALESCE($10::text, 'echo_agent'), $11,
           $12, $13,
           $14, $15, $16, $17::vector
         )
         ON CONFLICT (session_id, source_end_message_id, episode_hash)
           WHERE source_end_message_id IS NOT NULL
           DO NOTHING
         RETURNING *`,
        [
          r.sessionId,
          r.memoryScopeKey,
          r.episodeKind,
          r.summaryEn,
          JSON.stringify(r.facts ?? {}),
          JSON.stringify(r.decisions ?? {}),
          JSON.stringify(r.openLoops ?? {}),
          r.entities ?? [],
          JSON.stringify(r.toolOutcomes ?? {}),
          r.sourceSurface ?? null,
          r.sourceSession ?? null,
          r.sourceStartMessageId,
          r.sourceEndMessageId,
          r.episodeHash,
          r.embeddingModel,
          r.embeddingDim,
          vectorLiteral(r.embedding),
        ],
      );
      if (result.rows[0]) inserted.push(mapRow(result.rows[0]));
    }

    await client.query("COMMIT");
    return inserted;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {
      // ROLLBACK failures are non-actionable; the original error is what matters.
    });
    throw err;
  } finally {
    client.release();
  }
}

// ── Recall ──────────────────────────────────────────────────────

/**
 * Top-K cosine recall scoped to (`memory_scope_key`, `embedding_model`,
 * `embedding_dim`). The model+dim filter is mandatory — mixed-dim `<=>` crashes
 * pgvector and cross-model similarity is semantically meaningless.
 *
 * Returns results sorted by similarity DESC, filtered by `minSimilarity` (if
 * provided) after the cosine conversion.
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
       id, session_id, memory_scope_key, episode_kind, summary_en,
       facts_jsonb, decisions_jsonb, open_loops_jsonb, entities, tool_outcomes_jsonb,
       source_surface, source_session,
       source_start_message_id, source_end_message_id,
       episode_hash, embedding_model, embedding_dim, created_at,
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

// ── List (debug / tests) ────────────────────────────────────────

export async function listRecentBySession(
  sessionId: string,
  limit = 50,
): Promise<SessionEpisode[]> {
  const rows = await query<SessionEpisodeRow>(
    `SELECT * FROM session_episodes
     WHERE session_id = $1
     ORDER BY created_at DESC, id DESC
     LIMIT $2`,
    [sessionId, limit],
  );
  return rows.map(mapRow);
}

export async function getById(id: number): Promise<SessionEpisode | null> {
  if (!Number.isFinite(id) || id <= 0) return null;
  const row = await queryOne<SessionEpisodeRow>(
    "SELECT * FROM session_episodes WHERE id = $1",
    [id],
  );
  return row ? mapRow(row) : null;
}

function clampUnit(x: number): number {
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}
