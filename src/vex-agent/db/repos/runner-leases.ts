/**
 * Runner leases repo — exclusive per-session runner ownership (puzzle 03).
 *
 * One runner per session at a time, across the seven continuation entry
 * points (chat / mission start / setup / recover / retry / approval
 * resume / wake-triggered resume). The lease handle (in
 * `engine/runtime/lease-handle.ts`) owns the heartbeat timer + release
 * lifecycle; this repo just exposes the DB primitives.
 *
 * Race-safe claim: `INSERT ... ON CONFLICT (session_id) DO UPDATE
 * WHERE expired OR same owner` — the PK uniqueness closes the race
 * between two concurrent first claimants (one INSERT wins, the other
 * folds into the conflict path and re-checks).
 *
 * `session_id` is TEXT (matches `sessions.id`).
 */

import { queryOne, queryOneWith, executeWith, type Executor } from "../client.js";

export type LeaseProcessKind = "electron_main" | "agent_worker" | "test";

export interface RunnerLease {
  readonly sessionId: string;
  readonly missionRunId: string | null;
  readonly ownerId: string;
  readonly processKind: LeaseProcessKind;
  readonly acquiredAt: Date;
  readonly heartbeatAt: Date;
  readonly expiresAt: Date;
}

interface RunnerLeaseRow {
  readonly session_id: string;
  readonly mission_run_id: string | null;
  readonly owner_id: string;
  readonly process_kind: LeaseProcessKind;
  readonly acquired_at: Date;
  readonly heartbeat_at: Date;
  readonly expires_at: Date;
}

function mapRow(r: RunnerLeaseRow): RunnerLease {
  return {
    sessionId: r.session_id,
    missionRunId: r.mission_run_id,
    ownerId: r.owner_id,
    processKind: r.process_kind,
    acquiredAt: r.acquired_at,
    heartbeatAt: r.heartbeat_at,
    expiresAt: r.expires_at,
  };
}

export interface AcquireInput {
  readonly sessionId: string;
  readonly missionRunId?: string | null;
  readonly ownerId: string;
  readonly processKind: LeaseProcessKind;
  readonly ttlMs: number;
}

/**
 * Atomically acquire (or refresh) the lease for `sessionId`.
 *
 * - Brand-new lease (no row): INSERT wins.
 * - Same owner re-claim (idempotent): conflict path UPDATEs heartbeat
 *   + expires_at + mission_run_id.
 * - Stale lease (current `expires_at < NOW()`): conflict path takes
 *   over and rewrites owner_id.
 * - Otherwise: RETURNING is empty — caller observes `lease_busy` and
 *   queries `getLease` to surface the current owner's expiry for
 *   `retryAfterMs`.
 */
export async function acquireLease(
  input: AcquireInput,
  exec?: Executor,
): Promise<RunnerLease | null> {
  const inserted = await queryOneWith<RunnerLeaseRow>(
    exec ?? (await import("../client.js")).getPool(),
    `INSERT INTO runner_leases
       (session_id, mission_run_id, owner_id, process_kind, acquired_at, heartbeat_at, expires_at)
     VALUES ($1, $2, $3, $4, NOW(), NOW(), NOW() + ($5::int * interval '1 millisecond'))
     ON CONFLICT (session_id) DO UPDATE
       SET mission_run_id = EXCLUDED.mission_run_id,
           owner_id       = EXCLUDED.owner_id,
           process_kind   = EXCLUDED.process_kind,
           acquired_at    = NOW(),
           heartbeat_at   = NOW(),
           expires_at     = EXCLUDED.expires_at
       WHERE runner_leases.expires_at < NOW()
          OR runner_leases.owner_id = EXCLUDED.owner_id
     RETURNING session_id, mission_run_id, owner_id, process_kind,
               acquired_at, heartbeat_at, expires_at`,
    [
      input.sessionId,
      input.missionRunId ?? null,
      input.ownerId,
      input.processKind,
      input.ttlMs,
    ],
  );
  return inserted === null ? null : mapRow(inserted);
}

/** Refresh the heartbeat + expires_at for an owned lease. */
export async function renewLease(
  sessionId: string,
  ownerId: string,
  ttlMs: number,
  exec?: Executor,
): Promise<RunnerLease | null> {
  const row = await queryOneWith<RunnerLeaseRow>(
    exec ?? (await import("../client.js")).getPool(),
    `UPDATE runner_leases
       SET heartbeat_at = NOW(),
           expires_at   = NOW() + ($3::int * interval '1 millisecond')
     WHERE session_id = $1
       AND owner_id   = $2
     RETURNING session_id, mission_run_id, owner_id, process_kind,
               acquired_at, heartbeat_at, expires_at`,
    [sessionId, ownerId, ttlMs],
  );
  return row === null ? null : mapRow(row);
}

/**
 * Release a lease owned by `ownerId`. Idempotent — returns rowsAffected.
 * If the lease has already been stolen (re-acquired by someone else
 * after expiry), the WHERE clause skips the DELETE.
 */
export async function releaseLease(
  sessionId: string,
  ownerId: string,
  exec?: Executor,
): Promise<number> {
  return executeWith(
    exec ?? (await import("../client.js")).getPool(),
    `DELETE FROM runner_leases WHERE session_id = $1 AND owner_id = $2`,
    [sessionId, ownerId],
  );
}

/** Read-only — current lease for a session (or null). */
export async function getLease(sessionId: string): Promise<RunnerLease | null> {
  const row = await queryOne<RunnerLeaseRow>(
    `SELECT session_id, mission_run_id, owner_id, process_kind,
            acquired_at, heartbeat_at, expires_at
       FROM runner_leases
      WHERE session_id = $1`,
    [sessionId],
  );
  return row === null ? null : mapRow(row);
}
