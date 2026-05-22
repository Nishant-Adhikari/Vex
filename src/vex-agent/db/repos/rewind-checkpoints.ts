/**
 * Rewind checkpoints repo — pure CRUD for the `rewind_checkpoints`
 * table introduced by migration 023.
 *
 * Each rewind produces one row that stamps the archived range so
 * `/restore` can precisely unarchive only the rewind-archived
 * messages (compaction / giant-tool overflow rows stamp NULL on
 * `messages_archive.rewind_checkpoint_id` and are immune).
 *
 * Locking + transaction discipline lives in the engine helpers
 * (`engine/mission/restore.ts`); this module is dumb storage.
 *
 * Idempotency UNIQUE INDEX
 * (`idx_rewind_checkpoints_idempotency`) plus a deliberate
 * application-level check inside `markCheckpointRestored` together
 * guarantee that two concurrent restores using the same
 * `restore_idempotency_key` cannot both succeed even under racy
 * conditions.
 */

import type { PoolClient } from "pg";
import { randomUUID } from "node:crypto";

import { queryOneWith, executeWith, queryWith } from "../client.js";

export interface RewindCheckpoint {
  readonly id: string;
  readonly sessionId: string;
  readonly missionRunId: string | null;
  readonly cutoffMessageId: number;
  readonly cutoffCreatedAt: string;
  readonly archivedCount: number;
  readonly createdBy: "user" | "system";
  readonly reason: string | null;
  readonly createdAt: string;
  readonly restoredAt: string | null;
  readonly restoreIdempotencyKey: string | null;
}

interface RewindCheckpointRow {
  id: string;
  session_id: string;
  mission_run_id: string | null;
  cutoff_message_id: number;
  cutoff_created_at: string | Date;
  archived_count: number;
  created_by: string;
  reason: string | null;
  created_at: string | Date;
  restored_at: string | Date | null;
  restore_idempotency_key: string | null;
}

function toIso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function toIsoOrNull(value: string | Date | null): string | null {
  if (value === null) return null;
  return toIso(value);
}

function mapRow(r: RewindCheckpointRow): RewindCheckpoint {
  const createdBy = r.created_by === "system" ? "system" : "user";
  return {
    id: r.id,
    sessionId: r.session_id,
    missionRunId: r.mission_run_id,
    cutoffMessageId: r.cutoff_message_id,
    cutoffCreatedAt: toIso(r.cutoff_created_at),
    archivedCount: r.archived_count,
    createdBy,
    reason: r.reason,
    createdAt: toIso(r.created_at),
    restoredAt: toIsoOrNull(r.restored_at),
    restoreIdempotencyKey: r.restore_idempotency_key,
  };
}

export interface CreateCheckpointInput {
  readonly sessionId: string;
  readonly missionRunId: string | null;
  readonly cutoffMessageId: number;
  readonly cutoffCreatedAt: string;
  readonly archivedCount: number;
  readonly createdBy?: "user" | "system";
  readonly reason?: string | null;
}

/**
 * Insert a new checkpoint row. Caller owns the transaction so the
 * checkpoint write can ride together with the `archiveSuffix` SQL in
 * one COMMIT — see `engine/core/rewind.ts` (phase 5).
 */
export async function createCheckpoint(
  client: PoolClient,
  input: CreateCheckpointInput,
): Promise<RewindCheckpoint> {
  const id = `chk-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const row = await queryOneWith<RewindCheckpointRow>(
    client,
    `INSERT INTO rewind_checkpoints (
       id, session_id, mission_run_id, cutoff_message_id, cutoff_created_at,
       archived_count, created_by, reason
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      id,
      input.sessionId,
      input.missionRunId ?? null,
      input.cutoffMessageId,
      input.cutoffCreatedAt,
      input.archivedCount,
      input.createdBy ?? "user",
      input.reason ?? null,
    ],
  );
  if (!row) {
    throw new Error("createCheckpoint: INSERT...RETURNING returned no row");
  }
  return mapRow(row);
}

/**
 * Update `archived_count` after the archive write completes. Used by
 * the rewind tx flow where checkpoint creation precedes archive
 * (since `messages_archive.rewind_checkpoint_id` FK requires the
 * checkpoint row to exist first) but the final count is only known
 * after the archive INSERT returns row count.
 */
export async function setCheckpointArchivedCount(
  client: PoolClient,
  checkpointId: string,
  archivedCount: number,
): Promise<void> {
  await executeWith(
    client,
    `UPDATE rewind_checkpoints SET archived_count = $2 WHERE id = $1`,
    [checkpointId, archivedCount],
  );
}

/**
 * Fetch the latest unrestored checkpoint for a session. LIFO order
 * (newest first). Used by `/restore` which always operates on the
 * latest unrestored checkpoint in puzzle 04 (richer history browsing
 * lands later).
 */
export async function getLatestUnrestoredCheckpoint(
  client: PoolClient,
  sessionId: string,
): Promise<RewindCheckpoint | null> {
  const row = await queryOneWith<RewindCheckpointRow>(
    client,
    `SELECT * FROM rewind_checkpoints
       WHERE session_id = $1 AND restored_at IS NULL
       ORDER BY created_at DESC
       LIMIT 1`,
    [sessionId],
  );
  return row ? mapRow(row) : null;
}

/**
 * Fetch one checkpoint by id with a row lock — used by restore to
 * serialize against any concurrent restore on the same checkpoint.
 */
export async function getCheckpointForUpdate(
  client: PoolClient,
  checkpointId: string,
): Promise<RewindCheckpoint | null> {
  const row = await queryOneWith<RewindCheckpointRow>(
    client,
    `SELECT * FROM rewind_checkpoints WHERE id = $1 FOR UPDATE`,
    [checkpointId],
  );
  return row ? mapRow(row) : null;
}

/**
 * Mark a checkpoint as restored. The UNIQUE INDEX on
 * `restore_idempotency_key` provides DB-level protection — a
 * concurrent attempt with the same key would fail the constraint.
 * Caller (restore.ts) handles the idempotency-replay branch BEFORE
 * calling this helper.
 */
export async function markCheckpointRestored(
  client: PoolClient,
  checkpointId: string,
  idempotencyKey: string,
): Promise<void> {
  await executeWith(
    client,
    `UPDATE rewind_checkpoints
        SET restored_at = NOW(), restore_idempotency_key = $2
      WHERE id = $1`,
    [checkpointId, idempotencyKey],
  );
}

/**
 * Listing helper for audit / history UIs. Renderer never calls this
 * directly — it goes through an app IPC mapper (phase 6).
 */
export async function listCheckpoints(
  client: PoolClient,
  sessionId: string,
  opts: { readonly limit?: number; readonly unrestoredOnly?: boolean } = {},
): Promise<RewindCheckpoint[]> {
  const limit = opts.limit ?? 50;
  const whereClause = opts.unrestoredOnly
    ? "WHERE session_id = $1 AND restored_at IS NULL"
    : "WHERE session_id = $1";
  const rows = await queryWith<RewindCheckpointRow>(
    client,
    `SELECT * FROM rewind_checkpoints
       ${whereClause}
       ORDER BY created_at DESC
       LIMIT $2`,
    [sessionId, limit],
  );
  return rows.map(mapRow);
}
