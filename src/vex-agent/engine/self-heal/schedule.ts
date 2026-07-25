/**
 * Overnight self-heal — ATOMIC OV2 retry scheduling.
 *
 * The self-heal epoch (`error_retry_count`) is SHARED with the fast Phase-4d
 * auto-retry, and both paths honour the "one pending wake per session" unique
 * index. Doing the eligibility read, the epoch increment, and the wake insert as
 * three separate statements races the fast scheduler's own commit→enqueue gap:
 * a losing enqueue could either strand a bumped epoch against a fast wake
 * carrying the old epoch (→ `attempt_mismatch`, a dead-end) or silently replace
 * an already-scheduled retry.
 *
 * This performs all three in ONE transaction under the run-row lock, and — the
 * key ordering — INSERTS the wake FIRST (conditionally, `ON CONFLICT DO
 * NOTHING`) and only increments the epoch when the insert actually won. So if a
 * wake is already pending (the fast retry got there first), we insert nothing
 * and DO NOT bump the epoch — the existing wake keeps its matching epoch and
 * stays valid.
 */

import { withTransaction, queryOneWith } from "../../db/client.js";
import { nullableJsonb } from "../../db/params.js";
import { SELF_HEAL_WAKE_TRIGGER } from "./policy.js";

export interface ScheduleSelfHealRetryInput {
  readonly runId: string;
  readonly sessionId: string;
  readonly dueAt: Date;
  readonly reason: string;
  readonly failover: boolean;
}

export interface ScheduledSelfHealRetry {
  /** The new epoch the wake was scheduled for (matches `error_retry_count`). */
  readonly attempt: number;
}

/**
 * Atomically schedule the next OV2 self-heal retry. Returns the scheduled
 * attempt, or `null` when the run is no longer `paused_error` or a wake is
 * already pending for the session (a retry is already covered — no epoch bump).
 */
export async function scheduleSelfHealRetry(
  input: ScheduleSelfHealRetryInput,
): Promise<ScheduledSelfHealRetry | null> {
  return withTransaction(async (client) => {
    // 1. Lock the run row; only a still-paused_error run is schedulable. The
    //    lock serializes our epoch bump against the fast scheduler's (which also
    //    locks `FOR UPDATE OF mr` when it increments in its pause tx).
    const row = await queryOneWith<{ status: string; error_retry_count: number }>(
      client,
      `SELECT status, error_retry_count
         FROM mission_runs
        WHERE id = $1
        FOR UPDATE`,
      [input.runId],
    );
    if (row === null || row.status !== "paused_error") return null;

    const attempt = row.error_retry_count + 1;

    // 2. Insert the wake FIRST, conditional on no pending wake existing for the
    //    session (the partial unique index). If one already exists, no row is
    //    returned — and we skip the increment entirely.
    const inserted = await queryOneWith<{ id: string }>(
      client,
      `INSERT INTO loop_wake_requests
         (session_id, mission_run_id, due_at, status, reason, payload)
       VALUES ($1, $2, $3::timestamptz, 'pending', $4, $5::jsonb)
       ON CONFLICT (session_id) WHERE status = 'pending' DO NOTHING
       RETURNING id`,
      [
        input.sessionId,
        input.runId,
        input.dueAt.toISOString(),
        input.reason,
        nullableJsonb({
          trigger: SELF_HEAL_WAKE_TRIGGER,
          attempt,
          failover: input.failover,
        }),
      ],
    );
    if (inserted === null) return null; // a wake is already pending — defer

    // 3. Only now that OUR wake won the slot, bump the epoch to match its
    //    payload attempt. Committed together with the insert.
    await client.query(
      `UPDATE mission_runs SET error_retry_count = error_retry_count + 1 WHERE id = $1`,
      [input.runId],
    );
    return { attempt };
  });
}
