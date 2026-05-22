/**
 * Internals for `restore.ts`: row shapes, SQL helpers, post-commit
 * emit. Kept separate so the main file is a readable single-purpose
 * orchestrator under the 350 LOC budget.
 */

import type { PoolClient } from "pg";

import {
  executeWith,
  queryOneWith,
  queryWith,
} from "../../db/client.js";
import {
  type RewindCheckpoint,
} from "../../db/repos/rewind-checkpoints.js";
import {
  TRANSCRIPT_APPEND_EVENT_TYPE,
  type TranscriptAppendRole,
  type TranscriptEventBus,
} from "../events/transcript-bus.js";
import { ACTIVE_OR_PAUSED_RUN_STATUSES } from "../types.js";

export interface RestoreSuccessSnapshot {
  readonly sessionId: string;
  readonly checkpointId: string;
  readonly restoredAt: string;
  readonly restoredMessages: ReadonlyArray<RestoredMessageRow>;
  readonly idempotencyKey: string;
}

export interface RestoredMessageRow {
  readonly id: number;
  readonly role: string;
  readonly created_at: string | Date;
  readonly message_type: string | null;
}

/**
 * Explicit projection — phase 5 will apply the same discipline to
 * `archivePrefix` / `archiveSuffix` / `forkToolMessageToArchive` so
 * messages_archive column additions never silently break archive
 * writes. Restore is the read-back side of the same contract.
 */
const RESTORED_MESSAGE_COLUMNS = [
  "id",
  "session_id",
  "role",
  "content",
  "tool_call_id",
  "tool_calls",
  "created_at",
  "source",
  "message_type",
  "visibility",
  "origin_session_id",
  "subagent_id",
  "metadata",
] as const;

export function toIso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function normalizeRole(value: string): TranscriptAppendRole {
  return value === "user" || value === "assistant" || value === "tool" || value === "system"
    ? value
    : "system";
}

export async function checkActiveRun(
  client: PoolClient,
  sessionId: string,
): Promise<{ id: string; status: string } | null> {
  const statuses = [...ACTIVE_OR_PAUSED_RUN_STATUSES];
  const row = await queryOneWith<{ id: string; status: string }>(
    client,
    `SELECT id, status FROM mission_runs
       WHERE session_id = $1 AND status = ANY($2::text[])
       LIMIT 1`,
    [sessionId, statuses],
  );
  return row ?? null;
}

export async function checkPendingApproval(
  client: PoolClient,
  sessionId: string,
): Promise<string | null> {
  const row = await queryOneWith<{ id: string }>(
    client,
    `SELECT id FROM approval_queue
       WHERE session_id = $1 AND status = 'pending'
       LIMIT 1`,
    [sessionId],
  );
  return row?.id ?? null;
}

export async function checkExistingIdempotencyMatch(
  client: PoolClient,
  sessionId: string,
  idempotencyKey: string,
): Promise<RewindCheckpoint | null> {
  const row = await queryOneWith<{
    id: string;
    session_id: string;
    mission_run_id: string | null;
    cutoff_message_id: number;
    cutoff_created_at: string | Date;
    archived_count: number;
    created_by: string;
    reason: string | null;
    created_at: string | Date;
    restored_at: string | Date;
    restore_idempotency_key: string;
  }>(
    client,
    `SELECT * FROM rewind_checkpoints
       WHERE session_id = $1 AND restore_idempotency_key = $2`,
    [sessionId, idempotencyKey],
  );
  if (!row) return null;
  return {
    id: row.id,
    sessionId: row.session_id,
    missionRunId: row.mission_run_id,
    cutoffMessageId: row.cutoff_message_id,
    cutoffCreatedAt: toIso(row.cutoff_created_at),
    archivedCount: row.archived_count,
    createdBy: row.created_by === "system" ? "system" : "user",
    reason: row.reason,
    createdAt: toIso(row.created_at),
    restoredAt: toIso(row.restored_at),
    restoreIdempotencyKey: row.restore_idempotency_key,
  };
}

export async function unarchiveStampedRows(
  client: PoolClient,
  checkpointId: string,
): Promise<RestoredMessageRow[]> {
  const cols = RESTORED_MESSAGE_COLUMNS.join(", ");
  const rows = await queryWith<RestoredMessageRow>(
    client,
    `WITH del AS (
       DELETE FROM messages_archive
         WHERE rewind_checkpoint_id = $1
         RETURNING ${cols}
     )
     INSERT INTO messages (${cols})
       SELECT ${cols} FROM del
       RETURNING id, role, created_at, message_type`,
    [checkpointId],
  );
  return rows;
}

export async function incrementSessionMessageCount(
  client: PoolClient,
  sessionId: string,
  delta: number,
): Promise<void> {
  if (delta === 0) return;
  await executeWith(
    client,
    `UPDATE sessions
        SET message_count = message_count + $2
      WHERE id = $1`,
    [sessionId, delta],
  );
}

export function emitRestoredMessages(
  snapshot: RestoreSuccessSnapshot,
  bus: TranscriptEventBus,
): void {
  // One TranscriptAppendEvent per restored message. TanStack
  // dedupes the resulting refetch via staleTime; per-message
  // granularity gives future subscribers (e.g. scroll-to-id) useful
  // information. `correlationId` groups the emits from one restore
  // op for observers that care.
  const correlationId = `restore:${snapshot.checkpointId}`;
  for (const row of snapshot.restoredMessages) {
    bus.emit({
      type: TRANSCRIPT_APPEND_EVENT_TYPE,
      sessionId: snapshot.sessionId,
      messageId: row.id,
      role: normalizeRole(row.role),
      createdAt: toIso(row.created_at),
      messageType: row.message_type,
      correlationId,
    });
  }
}
