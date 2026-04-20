/**
 * Shared types + row mapper for the session-episodes repo split.
 *
 * Single source of truth for:
 *   - Domain types (EpisodeKind, SessionEpisode, NewEpisode, RecallFilters, RecallHit).
 *   - Row shapes used by the pg driver (`SessionEpisodeRow`, recall variant).
 *   - `mapRow` — the only place the `snake_case → camelCase` translation lives.
 *   - `EPISODE_COLUMNS` — shared column list that keeps INSERT and SELECT
 *     aligned so a column rename doesn't silently diverge between paths.
 *
 * Portability contract (mirrors `knowledge_entries`):
 *   - vector column has NO typmod; per-row `embedding_model` + `embedding_dim`
 *     are authoritative.
 *   - `embedding.length === embeddingDim` guard runs before SQL so the CHECK
 *     constraint never has to reject the row.
 *   - Dedupe index is partial (`WHERE source_end_message_id IS NOT NULL`), so
 *     callers MUST include the predicate in ON CONFLICT or Postgres won't match
 *     the index.
 *
 * Multilingual contract (PR2, migration 008):
 *   - `summary_text` (renamed from `summary_en`) carries text in the session's
 *     language. Knowledge entries remain English-only — translation happens
 *     at promotion.
 *   - `title` is LLM-generated (≤ 100 chars, same language as summary_text),
 *     NOT part of `episode_hash` so a retry with a different title on the
 *     same summary still dedupes cleanly.
 */

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
  /** LLM-generated episode title (≤100 chars), same language as summaryText. May be empty string for legacy rows. */
  title: string;
  /** Episode summary in the session's language (was `summaryEn` pre-PR2). */
  summaryText: string;
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
  /**
   * Generation stamp copied from `sessions.checkpoint_generation + 1` at insert
   * time (see `runCheckpointWriteTx`). Surfaces recency in recall as `gen:N`.
   * Null on legacy rows written before PR-8 rolled out — recall treats null as
   * "unknown generation" and omits the suffix.
   */
  checkpointGeneration: number | null;
  createdAt: string;
}

export interface NewEpisode {
  sessionId: string;
  memoryScopeKey: string;
  episodeKind: EpisodeKind;
  /** LLM-generated title. Defaults to empty string when caller cannot provide one. */
  title: string;
  /** Summary text in the session's language. */
  summaryText: string;
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
  /**
   * Generation stamp. Callers (today: only `runCheckpointWriteTx`) supply this
   * after reading `sessions.checkpoint_generation FOR UPDATE` inside the same
   * tx and computing `current + 1`. Leaving it undefined lands the row with
   * NULL — acceptable for ad-hoc test fixtures, not for production checkpoint.
   */
  checkpointGeneration?: number | null;
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

export interface SessionEpisodeRow {
  id: number;
  session_id: string;
  memory_scope_key: string;
  episode_kind: string;
  title: string;
  summary_text: string;
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
  checkpoint_generation: number | null;
  created_at: string;
}

export interface SessionEpisodeRecallRow extends SessionEpisodeRow {
  cosine_distance: number;
}

export function mapRow(r: SessionEpisodeRow): SessionEpisode {
  return {
    id: r.id,
    sessionId: r.session_id,
    memoryScopeKey: r.memory_scope_key,
    episodeKind: r.episode_kind as EpisodeKind,
    title: r.title,
    summaryText: r.summary_text,
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
    checkpointGeneration: r.checkpoint_generation,
    createdAt: r.created_at,
  };
}

/**
 * Single source of truth for the column list — keeps INSERT RETURNING and
 * SELECT aligned so a column rename doesn't silently diverge.
 */
export const EPISODE_COLUMNS = `
  id, session_id, memory_scope_key, episode_kind, title, summary_text,
  facts_jsonb, decisions_jsonb, open_loops_jsonb, entities, tool_outcomes_jsonb,
  source_surface, source_session,
  source_start_message_id, source_end_message_id,
  episode_hash, embedding_model, embedding_dim,
  checkpoint_generation, created_at
`;
