/**
 * Session-episodes CRUD — insert (batch, tx-aware), getById, listRecentBySession.
 *
 * Insert path honours the maintenance-lease contract indirectly: the
 * checkpoint flow that calls `insertEpisodes(rows, tx)` is itself the
 * atomic Phase II write under `withLeaseSharedLock`-free path (session
 * memory is NOT gated by the knowledge-entries lease — it is per-session
 * state). Callers that want to bundle episode inserts with other writes
 * (e.g. rolling summary, archive move) pass in their `PoolClient`.
 */

import type { PoolClient } from "pg";

import { getPool, query, queryOneWith } from "../../client.js";
import { jsonb } from "../../params.js";
import { vectorLiteral } from "../knowledge/types.js";
import {
  EPISODE_COLUMNS,
  mapRow,
  type NewEpisode,
  type SessionEpisode,
  type SessionEpisodeRow,
} from "./types.js";

/**
 * Batch-insert episodes, optionally as part of the caller's transaction.
 *
 * Returns only the rows that were newly inserted (ON CONFLICT collisions are
 * dropped). The partial unique index predicate is mirrored in ON CONFLICT so
 * Postgres can match it — omitting the WHERE clause silently disables dedupe.
 *
 * Each row's `embedding.length` is validated against `embeddingDim` before any
 * SQL runs so the DB CHECK constraint never has to reject.
 *
 * When `client` is provided (PR2 atomic checkpoint write), the inserts run
 * inside the caller's transaction — no BEGIN/COMMIT here. Otherwise opens
 * its own transaction (legacy call sites).
 */
export async function insertEpisodes(
  rows: readonly NewEpisode[],
  client?: PoolClient,
): Promise<SessionEpisode[]> {
  if (rows.length === 0) return [];

  for (const r of rows) {
    if (r.embedding.length !== r.embeddingDim) {
      throw new Error(
        `insertEpisodes: embedding length ${r.embedding.length} does not match embeddingDim ${r.embeddingDim} ` +
          `(session=${r.sessionId}, hash=${r.episodeHash}). DB CHECK constraint would reject this.`,
      );
    }
  }

  if (client) {
    return runInserts(client, rows);
  }

  const pool = getPool();
  const own = await pool.connect();
  try {
    await own.query("BEGIN");
    const inserted = await runInserts(own, rows);
    await own.query("COMMIT");
    return inserted;
  } catch (err) {
    await own.query("ROLLBACK").catch(() => {
      // ROLLBACK failures are non-actionable; the original error is what matters.
    });
    throw err;
  } finally {
    own.release();
  }
}

async function runInserts(
  tx: PoolClient,
  rows: readonly NewEpisode[],
): Promise<SessionEpisode[]> {
  const inserted: SessionEpisode[] = [];
  for (const r of rows) {
    const result = await tx.query<SessionEpisodeRow>(
      `INSERT INTO session_episodes (
         session_id, memory_scope_key, episode_kind, title, summary_text,
         facts_jsonb, decisions_jsonb, open_loops_jsonb, entities, tool_outcomes_jsonb,
         source_surface, source_session,
         source_start_message_id, source_end_message_id,
         episode_hash, embedding_model, embedding_dim, embedding,
         checkpoint_generation
       )
       VALUES (
         $1, $2, $3, $4, $5,
         $6::jsonb, $7::jsonb, $8::jsonb, $9, $10::jsonb,
         COALESCE($11::text, 'vex_agent'), $12,
         $13, $14,
         $15, $16, $17, $18::vector,
         $19
       )
       ON CONFLICT (session_id, source_end_message_id, episode_hash)
         WHERE source_end_message_id IS NOT NULL
         DO NOTHING
       RETURNING ${EPISODE_COLUMNS}`,
      [
        r.sessionId,
        r.memoryScopeKey,
        r.episodeKind,
        r.title,
        r.summaryText,
        jsonb(r.facts ?? {}),
        jsonb(r.decisions ?? {}),
        jsonb(r.openLoops ?? {}),
        r.entities ?? [],
        jsonb(r.toolOutcomes ?? {}),
        r.sourceSurface ?? null,
        r.sourceSession ?? null,
        r.sourceStartMessageId,
        r.sourceEndMessageId,
        r.episodeHash,
        r.embeddingModel,
        r.embeddingDim,
        vectorLiteral(r.embedding),
        r.checkpointGeneration ?? null,
      ],
    );
    if (result.rows[0]) inserted.push(mapRow(result.rows[0]));
  }
  return inserted;
}

export async function getById(id: number): Promise<SessionEpisode | null> {
  if (!Number.isFinite(id) || id <= 0) return null;
  const row = await queryOneWith<SessionEpisodeRow>(
    getPool(),
    `SELECT ${EPISODE_COLUMNS} FROM session_episodes WHERE id = $1`,
    [id],
  );
  return row ? mapRow(row) : null;
}

export async function listRecentBySession(
  sessionId: string,
  limit = 50,
): Promise<SessionEpisode[]> {
  const rows = await query<SessionEpisodeRow>(
    `SELECT ${EPISODE_COLUMNS}
     FROM session_episodes
     WHERE session_id = $1
     ORDER BY created_at DESC, id DESC
     LIMIT $2`,
    [sessionId, limit],
  );
  return rows.map(mapRow);
}
