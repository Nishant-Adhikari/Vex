/**
 * Mission runs repo — per-run state persistence.
 *
 * NO parent_run_id — session_links is the canonical relationship graph.
 * Run status is the source of truth for per-run state (not runtime_state).
 */

import {
  type MissionRunStatus,
  ACTIVE_RUN_STATUSES,
  PAUSED_RUN_STATUSES,
  TERMINAL_RUN_STATUSES,
  ACTIVE_OR_PAUSED_RUN_STATUSES,
} from "../../engine/types.js";
import type { PoolClient } from "pg";

import { query, queryOne, queryOneWith, execute, getPool } from "../client.js";
import { nullableJsonb } from "../params.js";
import logger from "@utils/logger.js";

// ── Types ───────────────────────────────────────────────────────

/**
 * Mission run state. Approval gating reads `sessions.permission` (hydrated
 * into `EngineContext`) so
 * the per-run snapshot is no longer needed.
 */
export interface MissionRun {
  id: string;
  missionId: string;
  sessionId: string;
  status: MissionRunStatus;
  startedAt: string;
  endedAt: string | null;
  lastCheckpointAt: string | null;
  stopReason: string | null;
  stopSummary: string | null;
  stopEvidenceJson: Record<string, unknown> | null;
  iterationCount: number;
  contractSnapshotJson: Record<string, unknown> | null;
  recoveredFromRunId: string | null;
  /** Phase 4d: count of auto-retries scheduled for this run (budget + wake epoch). */
  errorRetryCount: number;
  /** Phase 4d: STICKY fail-closed stamp — true once the run touched a mutating tool. */
  autoRetryUnsafe: boolean;
}

/** SQL `IN (…)` literal compiled once from `ACTIVE_OR_PAUSED_RUN_STATUSES`. */
const ACTIVE_OR_PAUSED_SQL_IN = Array.from(ACTIVE_OR_PAUSED_RUN_STATUSES)
  .map((s) => `'${s}'`)
  .join(",");

const ALLOWED_RUN_STATUSES: ReadonlySet<MissionRunStatus> = new Set([
  ...ACTIVE_RUN_STATUSES,
  ...PAUSED_RUN_STATUSES,
  ...TERMINAL_RUN_STATUSES,
]);

function coerceStatus(raw: unknown, runId: string): MissionRunStatus {
  if (typeof raw === "string" && ALLOWED_RUN_STATUSES.has(raw as MissionRunStatus)) {
    return raw as MissionRunStatus;
  }
  logger.warn("engine.mission.status_drift", { runId, raw: String(raw) });
  throw new Error(`Unknown mission run status for ${runId}: ${String(raw)}`);
}

function mapRow(r: Record<string, unknown>): MissionRun {
  const id = r.id as string;
  return {
    id,
    missionId: r.mission_id as string,
    sessionId: r.session_id as string,
    status: coerceStatus(r.status, id),
    startedAt: (r.started_at instanceof Date ? r.started_at.toISOString() : r.started_at as string),
    endedAt: r.ended_at ? (r.ended_at instanceof Date ? r.ended_at.toISOString() : r.ended_at as string) : null,
    lastCheckpointAt: r.last_checkpoint_at ? (r.last_checkpoint_at instanceof Date ? r.last_checkpoint_at.toISOString() : r.last_checkpoint_at as string) : null,
    stopReason: r.stop_reason as string | null,
    stopSummary: r.stop_summary as string | null,
    stopEvidenceJson: r.stop_evidence_json as Record<string, unknown> | null,
    iterationCount: (r.iteration_count as number) ?? 0,
    contractSnapshotJson: r.contract_snapshot_json as Record<string, unknown> | null,
    recoveredFromRunId: r.recovered_from_run_id as string | null,
    errorRetryCount: (r.error_retry_count as number) ?? 0,
    autoRetryUnsafe: (r.auto_retry_unsafe as boolean) ?? false,
  };
}

// ── CRUD ────────────────────────────────────────────────────────

export async function createRun(
  id: string,
  missionId: string,
  sessionId: string,
  options: {
    contractSnapshotJson?: Record<string, unknown> | null;
    recoveredFromRunId?: string | null;
  } = {},
  client?: PoolClient,
): Promise<void> {
  const sql = `INSERT INTO mission_runs (
       id, mission_id, session_id, contract_snapshot_json, recovered_from_run_id
     ) VALUES ($1, $2, $3, $4::jsonb, $5)`;
  const params = [
    id,
    missionId,
    sessionId,
    nullableJsonb(options.contractSnapshotJson ?? null),
    options.recoveredFromRunId ?? null,
  ];
  if (client) {
    await client.query(sql, params);
  } else {
    await execute(sql, params);
  }
}

export async function updateStatus(
  id: string,
  status: MissionRunStatus,
  stopReason?: string,
  stopPayload?: { summary?: string; evidence?: Record<string, unknown> },
  client?: PoolClient,
): Promise<void> {
  // Two SQL paths (not one with conditional string-injection) so the
  // placeholder count always matches the params array. A single template
  // with `isRunning ? "NULL" : "COALESCE($N, …)"` left $2..$4 orphan when
  // status === "running" and Postgres aborts type-inference for unused
  // placeholders ("could not determine data type of parameter $2").
  if (status === "running") {
    // Live state: clear stale stop evidence from paused_wake / paused_error.
    const runningSql = `UPDATE mission_runs SET status = 'running',
       stop_reason = NULL, stop_summary = NULL,
       stop_evidence_json = NULL, ended_at = NULL
       WHERE id = $1`;
    if (client) {
      await client.query(runningSql, [id]);
    } else {
      await execute(runningSql, [id]);
    }
    return;
  }

  // Paused statuses keep prior evidence (COALESCE merge); terminal statuses
  // additionally stamp ended_at to NOW().
  const ended = TERMINAL_RUN_STATUSES.has(status) ? "NOW()" : "ended_at";
  const pausedSql = `UPDATE mission_runs SET status = $1,
     stop_reason = COALESCE($2, stop_reason),
     stop_summary = COALESCE($3, stop_summary),
     stop_evidence_json = COALESCE($4::jsonb, stop_evidence_json),
     ended_at = ${ended}
     WHERE id = $5`;
  const pausedParams = [
    status,
    stopReason ?? null,
    stopPayload?.summary ?? null,
    nullableJsonb(stopPayload?.evidence ?? null),
    id,
  ];
  if (client) {
    await client.query(pausedSql, pausedParams);
  } else {
    await execute(pausedSql, pausedParams);
  }
}

/**
 * Write a fallback `stop_summary`, but ONLY if the run has none.
 *
 * The `WHERE ... AND (stop_summary IS NULL OR btrim(stop_summary) = '')`
 * guard is the whole point: agent-authored prose always wins, and it wins
 * in SQL rather than in a caller's read-then-write, so a `mission_stop`
 * landing concurrently with finalisation can never be overwritten.
 *
 * Returns whether a row was actually written, so callers can log honestly.
 */
export async function setStopSummaryIfAbsent(
  id: string,
  summary: string,
): Promise<boolean> {
  const written = await execute(
    `UPDATE mission_runs SET stop_summary = $2
      WHERE id = $1
        AND (stop_summary IS NULL OR btrim(stop_summary) = '')`,
    [id, summary],
  );
  return written > 0;
}

export async function setLastCheckpoint(id: string): Promise<void> {
  await execute(
    "UPDATE mission_runs SET last_checkpoint_at = NOW() WHERE id = $1",
    [id],
  );
}

export async function incrementIterations(id: string): Promise<number> {
  const row = await queryOne<{ iteration_count: number }>(
    "UPDATE mission_runs SET iteration_count = iteration_count + 1 WHERE id = $1 RETURNING iteration_count",
    [id],
  );
  return row?.iteration_count ?? 0;
}

/**
 * Phase 4d: STICKY fail-closed stamp. Set the instant the run is about to
 * dispatch a mutating tool. Once true it is never cleared within the run's
 * life, so an error after a side effect can never auto-retry (double-spend
 * gate). Idempotent — re-stamping an already-unsafe run is a harmless no-op.
 */
export async function markAutoRetryUnsafe(
  id: string,
  client?: PoolClient,
): Promise<void> {
  const sql = "UPDATE mission_runs SET auto_retry_unsafe = true WHERE id = $1";
  // Verify the stamp actually landed. A drifted/missing run id affects 0 rows;
  // returning silently would let a mutating handler proceed with NO durable
  // unsafe stamp (fail-OPEN). Throwing keeps the dispatcher fail-closed.
  const affected = client
    ? (await client.query(sql, [id])).rowCount ?? 0
    : await execute(sql, [id]);
  if (affected !== 1) {
    throw new Error(
      `markAutoRetryUnsafe: expected to stamp exactly 1 run, affected ${affected} (run ${id})`,
    );
  }
}

/**
 * Phase 4d: bump the auto-retry budget/epoch. Returns the new count. The
 * scheduler calls this inside the same locked tx that persists `paused_error`
 * so the count and the scheduled wake's `attempt` payload stay consistent.
 */
export async function incrementErrorRetryCount(
  id: string,
  client?: PoolClient,
): Promise<number> {
  const sql =
    "UPDATE mission_runs SET error_retry_count = error_retry_count + 1 WHERE id = $1 RETURNING error_retry_count";
  const row = client
    ? (await client.query<{ error_retry_count: number }>(sql, [id])).rows[0]
    : await queryOne<{ error_retry_count: number }>(sql, [id]);
  return row?.error_retry_count ?? 0;
}

export async function getActiveRun(
  missionId: string,
  client?: PoolClient,
): Promise<MissionRun | null> {
  const sql = `SELECT * FROM mission_runs WHERE mission_id = $1 AND status IN (${ACTIVE_OR_PAUSED_SQL_IN}) ORDER BY started_at DESC LIMIT 1`;
  const row = client
    ? await queryOneWith<Record<string, unknown>>(client, sql, [missionId])
    : await queryOne<Record<string, unknown>>(sql, [missionId]);
  return row ? mapRow(row) : null;
}

/**
 * Fetch the active run for a session (keyed by `session_id`, filtered to
 * non-terminal statuses). Used by the PR-7 ingress router — user messages
 * arrive with a session id, not a mission id, and the router needs to
 * distinguish `running` / `paused_approval` / `paused_wake` from no active
 * work at all. `getRunBySession` is intentionally statusless and unsuitable
 * for routing decisions; `getActiveRun(missionId)` is keyed by mission id.
 */
export async function getActiveRunBySession(
  sessionId: string,
  client?: PoolClient,
): Promise<MissionRun | null> {
  const sql = `SELECT * FROM mission_runs WHERE session_id = $1 AND status IN (${ACTIVE_OR_PAUSED_SQL_IN}) ORDER BY started_at DESC LIMIT 1`;
  const row = client
    ? await queryOneWith<Record<string, unknown>>(client, sql, [sessionId])
    : await queryOne<Record<string, unknown>>(sql, [sessionId]);
  return row ? mapRow(row) : null;
}

/**
 * Atomic compare-and-set transition from any of `fromStatuses` to `running`.
 *
 * Used by `/retry` and the wake executor to claim a paused run without
 * racing each other: the SELECT … FOR UPDATE locks the row, the UPDATE only
 * fires when the locked status is in the allowed set, and the function
 * returns the previous status on success or `null` if another resumer
 * already moved the row out of the allowed set.
 */
export async function casFlipToRunning(
  runId: string,
  fromStatuses: readonly MissionRunStatus[],
): Promise<MissionRunStatus | null> {
  if (fromStatuses.length === 0) return null;
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const lockRow = await client.query<{ status: string }>(
      "SELECT status FROM mission_runs WHERE id = $1 FOR UPDATE",
      [runId],
    );
    if (lockRow.rowCount === 0) {
      await client.query("ROLLBACK");
      return null;
    }
    const prev = coerceStatus(lockRow.rows[0].status, runId);
    if (!fromStatuses.includes(prev)) {
      await client.query("ROLLBACK");
      return null;
    }
    await client.query(
      `UPDATE mission_runs
       SET status = 'running',
           stop_reason = NULL,
           stop_summary = NULL,
           stop_evidence_json = NULL,
           ended_at = NULL
       WHERE id = $1`,
      [runId],
    );
    await client.query("COMMIT");
    return prev;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {
      // ROLLBACK failures are non-actionable; the original error is what matters.
    });
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Every run that is still `running` or parked in a `paused_*` state — the
 * candidate set for the agent-independent deadline sweep
 * (`engine/wake/deadline-watchdog.ts`). Unbounded on purpose: the active set is
 * a handful of rows (one active run per mission), and a LIMIT could starve an
 * overdue run behind newer ones. Ordered oldest-first so the most overdue rows
 * are enforced first.
 */
export async function listActiveOrPausedRuns(): Promise<MissionRun[]> {
  const rows = await query<Record<string, unknown>>(
    `SELECT * FROM mission_runs
     WHERE status IN (${ACTIVE_OR_PAUSED_SQL_IN})
     ORDER BY started_at ASC`,
  );
  return rows.map(mapRow);
}

/**
 * Atomic compare-and-set from any of `fromStatuses` to the terminal
 * `failed` / `deadline_reached` pair — the deadline watchdog's claim.
 *
 * The mirror image of `casFlipToRunning`: SELECT … FOR UPDATE locks the row,
 * the UPDATE only fires when the LOCKED status is still in the allowed set, and
 * the previous status is returned on success or `null` when someone else
 * already moved the row. That `null` is what makes the sweep idempotent and
 * safe against a concurrent resume or the loop-boundary enforcer — only one
 * caller can ever win the flip, so the terminal side-effects (mission row,
 * ledger close, approvals cleanup) run exactly once.
 *
 * Unlike `updateStatus`, stop fields are written unconditionally (no COALESCE):
 * a parked run carries stale `paused_error` evidence that must NOT survive into
 * the deadline record.
 */
export async function casStopPastDeadline(
  runId: string,
  fromStatuses: readonly MissionRunStatus[],
  payload: {
    stopReason: "deadline_reached";
    summary?: string;
    evidence?: Record<string, unknown>;
  },
): Promise<MissionRunStatus | null> {
  if (fromStatuses.length === 0) return null;
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const lockRow = await client.query<{ status: string }>(
      "SELECT status FROM mission_runs WHERE id = $1 FOR UPDATE",
      [runId],
    );
    // Destructure rather than index — `rows[0]` is `T | undefined` under the
    // app's stricter `noUncheckedIndexedAccess` tsconfig.
    const locked = lockRow.rows[0];
    if (locked === undefined) {
      await client.query("ROLLBACK");
      return null;
    }
    const prev = coerceStatus(locked.status, runId);
    if (!fromStatuses.includes(prev)) {
      await client.query("ROLLBACK");
      return null;
    }
    await client.query(
      `UPDATE mission_runs
       SET status = 'failed',
           stop_reason = $2,
           stop_summary = $3,
           stop_evidence_json = $4::jsonb,
           ended_at = NOW()
       WHERE id = $1`,
      [
        runId,
        payload.stopReason,
        payload.summary ?? null,
        nullableJsonb(payload.evidence ?? null),
      ],
    );
    await client.query("COMMIT");
    return prev;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {
      // ROLLBACK failures are non-actionable; the original error is what matters.
    });
    throw err;
  } finally {
    client.release();
  }
}

export async function getRun(
  id: string,
  client?: PoolClient,
): Promise<MissionRun | null> {
  const sql = "SELECT * FROM mission_runs WHERE id = $1";
  const row = client
    ? await queryOneWith<Record<string, unknown>>(client, sql, [id])
    : await queryOne<Record<string, unknown>>(sql, [id]);
  return row ? mapRow(row) : null;
}

export async function getRunBySession(
  sessionId: string,
  client?: PoolClient,
): Promise<MissionRun | null> {
  const sql =
    "SELECT * FROM mission_runs WHERE session_id = $1 ORDER BY started_at DESC LIMIT 1";
  const row = client
    ? await queryOneWith<Record<string, unknown>>(client, sql, [sessionId])
    : await queryOne<Record<string, unknown>>(sql, [sessionId]);
  return row ? mapRow(row) : null;
}

export async function getLatestFailedRunBySession(sessionId: string): Promise<MissionRun | null> {
  const row = await queryOne<Record<string, unknown>>(
    "SELECT * FROM mission_runs WHERE session_id = $1 AND status = 'failed' ORDER BY ended_at DESC NULLS LAST, started_at DESC LIMIT 1",
    [sessionId],
  );
  return row ? mapRow(row) : null;
}
