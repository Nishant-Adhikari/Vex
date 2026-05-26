/**
 * Compact-jobs CRUD — outbox state machine for Track 2 chunking.
 *
 * State transitions:
 *   pending → running         (claim via SELECT FOR UPDATE SKIP LOCKED)
 *   running → completed       (success: chunker emitted chunks)
 *   running → failed          (transient error; retry scheduled)
 *   failed  → pending         (next_attempt_at <= now() AND attempt_count < max_attempts)
 *   running | failed → permanently_failed (attempt_count >= max_attempts)
 *
 * Stale recovery (worker bootstrap on app start):
 *   Find `running` rows whose `heartbeat_at < now() - stale_threshold` and
 *   reset them to `pending` with backoff. Prevents the outbox stalling after
 *   an app crash mid-chunking.
 */

import type { PoolClient } from "pg";

import { execute, getPool, queryOne, queryOneWith, query } from "../../client.js";
import {
  JOB_COLUMNS,
  mapRow,
  type CompactJob,
  type CompactJobRow,
  type NewCompactJob,
} from "./types.js";

/**
 * Enqueue a Track 2 chunking job. Idempotent on (session_id, generation) —
 * a second call for the same compact returns the existing row.
 */
export async function enqueueJob(
  input: NewCompactJob,
  client?: PoolClient,
): Promise<{ job: CompactJob; inserted: boolean }> {
  const exec = client ?? getPool();
  const row = await queryOneWith<CompactJobRow & { inserted: boolean }>(
    exec,
    `WITH ins AS (
       INSERT INTO compact_jobs (
         session_id, checkpoint_generation,
         agent_summary, preserve_md, thread_themes_hints,
         source_start_message_id, source_end_message_id
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (session_id, checkpoint_generation) DO NOTHING
       RETURNING *
     )
     SELECT *, true AS inserted FROM ins
     UNION ALL
     SELECT j.*, false AS inserted FROM compact_jobs j
       WHERE j.session_id = $1 AND j.checkpoint_generation = $2
         AND NOT EXISTS (SELECT 1 FROM ins)`,
    [
      input.sessionId,
      input.checkpointGeneration,
      input.agentSummary,
      input.preserveMd,
      input.threadThemesHints,
      input.sourceStartMessageId,
      input.sourceEndMessageId,
    ],
  );
  if (!row) {
    throw new Error(`enqueueJob: upsert returned no row for session=${input.sessionId}`);
  }
  const { inserted, ...rest } = row;
  return { job: mapRow(rest as CompactJobRow), inserted };
}

/**
 * Claim the next due job atomically. Uses `SELECT FOR UPDATE SKIP LOCKED` so
 * multiple workers (process-local or future cross-process) never claim the
 * same row. Stamps `status='running'`, `locked_at`, `locked_by`,
 * `heartbeat_at`, `started_at`.
 *
 * Returns `null` if no due job is available.
 */
export async function claimNextDueJob(workerId: string): Promise<CompactJob | null> {
  const pool = getPool();
  const tx = await pool.connect();
  try {
    await tx.query("BEGIN");
    const pick = await tx.query<{ id: number }>(
      `SELECT id FROM compact_jobs
       WHERE status IN ('pending', 'failed')
         AND attempt_count < max_attempts
         AND next_attempt_at <= NOW()
       ORDER BY created_at ASC
       LIMIT 1
       FOR UPDATE SKIP LOCKED`,
    );
    const id = pick.rows[0]?.id;
    if (!id) {
      await tx.query("COMMIT");
      return null;
    }
    const updated = await tx.query<CompactJobRow>(
      `UPDATE compact_jobs
       SET status        = 'running',
           locked_at     = NOW(),
           locked_by     = $2,
           heartbeat_at  = NOW(),
           started_at    = COALESCE(started_at, NOW()),
           attempt_count = attempt_count + 1
       WHERE id = $1
       RETURNING ${JOB_COLUMNS}`,
      [id, workerId],
    );
    await tx.query("COMMIT");
    const r = updated.rows[0];
    return r ? mapRow(r) : null;
  } catch (err) {
    await tx.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    tx.release();
  }
}

/**
 * Heartbeat update — call every WORKER_HEARTBEAT_INTERVAL_MS while the job
 * is running. Owner-checked: a stale worker whose row was reclaimed cannot
 * extend the heartbeat of the new owner. Returns `false` when the claim is
 * lost so the worker can self-terminate.
 */
export async function heartbeat(jobId: number, workerId: string): Promise<boolean> {
  const rowCount = await execute(
    `UPDATE compact_jobs
     SET heartbeat_at = NOW()
     WHERE id = $1 AND status = 'running' AND locked_by = $2`,
    [jobId, workerId],
  );
  return rowCount === 1;
}

export interface CompletionAudit {
  chunksInserted: number;
  chunksRejectedByExclusion: number;
  chunksRejectedByRedaction: number;
  inferenceProvider: string;
  inferenceModel: string;
  costUsd: number | null;
}

/**
 * Mark a job completed. Owner-checked: only the worker that currently holds
 * the row (`status='running' AND locked_by=$workerId`) may complete it. This
 * prevents a stale worker — one whose row was reclaimed by `recoverStaleRunning`
 * — from overwriting the reclaimed/already-processed state.
 *
 * Returns `true` iff the row was actually updated. A `false` return means
 * either the job was not in `running` status anymore, or `locked_by` did not
 * match the supplied `workerId`. Callers should log this as a recovery
 * event (the worker should treat its claim as lost).
 */
export async function markCompleted(
  jobId: number,
  workerId: string,
  audit: CompletionAudit,
): Promise<boolean> {
  const rowCount = await execute(
    `UPDATE compact_jobs
     SET status                       = 'completed',
         locked_at                    = NULL,
         locked_by                    = NULL,
         heartbeat_at                 = NULL,
         chunks_inserted              = $3,
         chunks_rejected_by_exclusion = $4,
         chunks_rejected_by_redaction = $5,
         inference_provider           = $6,
         inference_model              = $7,
         inference_completed_at       = NOW(),
         cost_usd                     = $8,
         completed_at                 = NOW()
     WHERE id = $1
       AND status = 'running'
       AND locked_by = $2`,
    [
      jobId,
      workerId,
      audit.chunksInserted,
      audit.chunksRejectedByExclusion,
      audit.chunksRejectedByRedaction,
      audit.inferenceProvider,
      audit.inferenceModel,
      audit.costUsd,
    ],
  );
  return rowCount === 1;
}

/**
 * Mark failed and schedule next attempt. Owner-checked: only the worker that
 * currently holds the row may transition it. Returns `{ ok: false }` if the
 * claim was lost (row no longer `running` or `locked_by` mismatch) so the
 * worker can stop heartbeating and discard local state.
 *
 * If `attempt_count >= max_attempts`, transitions to `permanently_failed`
 * instead of scheduling a retry. `nextAttemptInMs` is computed by the caller
 * so tests can inject deterministic values.
 */
export async function markFailed(
  jobId: number,
  workerId: string,
  error: string,
  nextAttemptInMs: number,
): Promise<{ ok: boolean; terminal: boolean }> {
  const job = await queryOne<{ attempt_count: number; max_attempts: number; locked_by: string | null; status: string }>(
    "SELECT attempt_count, max_attempts, locked_by, status FROM compact_jobs WHERE id = $1",
    [jobId],
  );
  if (!job) return { ok: false, terminal: false };
  if (job.status !== "running" || job.locked_by !== workerId) {
    // Claim lost — silently no-op; recoverStaleRunning may have reclaimed us.
    return { ok: false, terminal: false };
  }

  const terminal = job.attempt_count >= job.max_attempts;
  if (terminal) {
    const rowCount = await execute(
      `UPDATE compact_jobs
       SET status       = 'permanently_failed',
           last_error   = $3,
           locked_at    = NULL,
           locked_by    = NULL,
           heartbeat_at = NULL,
           completed_at = NOW()
       WHERE id = $1
         AND status = 'running'
         AND locked_by = $2`,
      [jobId, workerId, error],
    );
    return { ok: rowCount === 1, terminal: true };
  }
  const rowCount = await execute(
    `UPDATE compact_jobs
     SET status          = 'failed',
         last_error      = $3,
         next_attempt_at = NOW() + ($4::bigint || ' milliseconds')::interval,
         locked_at       = NULL,
         locked_by       = NULL,
         heartbeat_at    = NULL
     WHERE id = $1
       AND status = 'running'
       AND locked_by = $2`,
    [jobId, workerId, error, nextAttemptInMs],
  );
  return { ok: rowCount === 1, terminal: false };
}

/**
 * Worker bootstrap: reset stale `running` rows back to `pending` with a
 * small backoff. Call once on app start before beginning the poll loop.
 *
 * Returns the number of rows reset (for logging / telemetry).
 */
export async function recoverStaleRunning(staleThresholdMs: number): Promise<number> {
  const rowCount = await execute(
    `UPDATE compact_jobs
     SET status          = 'pending',
         locked_at       = NULL,
         locked_by       = NULL,
         heartbeat_at    = NULL,
         next_attempt_at = NOW() + ($2::bigint || ' milliseconds')::interval
     WHERE status = 'running'
       AND (heartbeat_at IS NULL OR heartbeat_at < NOW() - ($1::bigint || ' milliseconds')::interval)`,
    [staleThresholdMs, Math.min(staleThresholdMs, 30_000)],
  );
  return rowCount;
}

/**
 * Re-enqueue a `permanently_failed` job for another attempt (user-triggered
 * retry from the desktop app). Clears the terminal status AND every
 * progress/audit field stamped by claim / markFailed / markCompleted, so the
 * row is indistinguishable from a fresh enqueue and `claimNextDueJob` can pick
 * it up (`attempt_count = 0 < max_attempts`, `next_attempt_at = NOW()`).
 *
 * Guarded on the current status to avoid racing a worker: `not_found` if the
 * row is gone, `not_permanently_failed` if it is not (or no longer) terminal.
 */
export async function resetPermanentlyFailed(
  jobId: number,
): Promise<
  { ok: true } | { ok: false; reason: "not_found" | "not_permanently_failed" }
> {
  const row = await queryOne<{ status: string }>(
    "SELECT status FROM compact_jobs WHERE id = $1",
    [jobId],
  );
  if (!row) return { ok: false, reason: "not_found" };
  if (row.status !== "permanently_failed") {
    return { ok: false, reason: "not_permanently_failed" };
  }
  const rowCount = await execute(
    `UPDATE compact_jobs
     SET status                       = 'pending',
         attempt_count                = 0,
         last_error                   = NULL,
         next_attempt_at              = NOW(),
         locked_at                    = NULL,
         locked_by                    = NULL,
         heartbeat_at                 = NULL,
         started_at                   = NULL,
         completed_at                 = NULL,
         inference_completed_at       = NULL,
         inference_provider           = NULL,
         inference_model              = NULL,
         cost_usd                     = NULL,
         chunks_inserted              = 0,
         chunks_rejected_by_exclusion = 0,
         chunks_rejected_by_redaction = 0
     WHERE id = $1
       AND status = 'permanently_failed'`,
    [jobId],
  );
  // rowCount 0 ⇒ a worker/other path changed status between SELECT and UPDATE.
  return rowCount === 1
    ? { ok: true }
    : { ok: false, reason: "not_permanently_failed" };
}

export async function getById(id: number): Promise<CompactJob | null> {
  const row = await queryOne<CompactJobRow>(
    `SELECT ${JOB_COLUMNS} FROM compact_jobs WHERE id = $1`,
    [id],
  );
  return row ? mapRow(row) : null;
}

export async function getBySessionAndGeneration(
  sessionId: string,
  generation: number,
): Promise<CompactJob | null> {
  const row = await queryOne<CompactJobRow>(
    `SELECT ${JOB_COLUMNS}
     FROM compact_jobs
     WHERE session_id = $1 AND checkpoint_generation = $2`,
    [sessionId, generation],
  );
  return row ? mapRow(row) : null;
}

export async function listPendingForSession(sessionId: string): Promise<CompactJob[]> {
  const rows = await query<CompactJobRow>(
    `SELECT ${JOB_COLUMNS}
     FROM compact_jobs
     WHERE session_id = $1 AND status IN ('pending', 'running', 'failed')
     ORDER BY checkpoint_generation ASC`,
    [sessionId],
  );
  return rows.map(mapRow);
}
