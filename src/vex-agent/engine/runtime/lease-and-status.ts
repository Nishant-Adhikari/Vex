/**
 * Atomic composable helpers for the puzzle-03 runtime control plane.
 *
 * Every helper here runs as a SINGLE database transaction so the
 * combination of {lease acquire, status flip, pending-wake cancel,
 * control-request observe/clear} commits together — there is no window
 * where the lease exists but the status hasn't flipped, or where a
 * `paused_wake` row stays around after the run flipped to `running`.
 *
 * Codex acceptance criteria enforced here:
 *
 *   1. Pending wake cancellation is conditional on the OBSERVED
 *      `previousStatus === "paused_wake"`, not on the static
 *      `fromStatuses.includes("paused_wake")`. A caller with
 *      `["paused_error", "paused_wake"]` may be flipping from
 *      `paused_error`, in which case the wake row must be left alone
 *      (it could belong to a different scheduling cycle).
 *
 *   2. Lease acquisition uses `INSERT ... ON CONFLICT (session_id) DO
 *      UPDATE WHERE expired OR same owner RETURNING` (see
 *      `db/repos/runner-leases.ts acquireLease`) so the PK unique
 *      constraint closes the race between two concurrent first
 *      claimants. The atomic helpers here run that primitive inside the
 *      surrounding `withTransaction` for symmetry with the status flip.
 *
 * Helpers return discriminated outcomes — never throw on the normal
 * `lease_busy` / `status_mismatch` / `no_active_run` paths. Throws are
 * reserved for genuine infrastructure failures (DB unavailable, schema
 * mismatch).
 */

import {
  withTransaction,
  queryOneWith,
  executeWith,
} from "../../db/client.js";
import {
  type MissionRunStatus,
  TERMINAL_RUN_STATUSES,
} from "../types.js";
import {
  type LeaseProcessKind,
  type RunnerLease,
  acquireLease,
} from "../../db/repos/runner-leases.js";
import {
  type ControlRequest,
  type ControlRequestKind,
} from "../../db/repos/runtime-control-requests.js";

// ── Types ───────────────────────────────────────────────────────────

export interface ClaimRunInput {
  readonly sessionId: string;
  readonly missionRunId: string;
  readonly fromStatuses: readonly MissionRunStatus[];
  readonly ownerId: string;
  readonly processKind: LeaseProcessKind;
  readonly ttlMs: number;
}

export type ClaimRunOutcome =
  | {
    readonly outcome: "claimed";
    readonly previousStatus: MissionRunStatus;
    readonly lease: RunnerLease;
    readonly wakeCancelledCount: number;
  }
  | {
    readonly outcome: "lease_busy";
    readonly currentLease: RunnerLease;
  }
  | {
    readonly outcome: "status_mismatch";
    readonly currentStatus: MissionRunStatus | null;
  };

export interface ClaimSessionLeaseInput {
  readonly sessionId: string;
  readonly ownerId: string;
  readonly processKind: LeaseProcessKind;
  readonly ttlMs: number;
}

export type ClaimSessionLeaseOutcome =
  | { readonly outcome: "claimed"; readonly lease: RunnerLease }
  | { readonly outcome: "lease_busy"; readonly currentLease: RunnerLease };

export interface ObserveControlInput {
  readonly sessionId: string;
  readonly kinds: readonly ControlRequestKind[];
}

export type ObserveControlOutcome =
  | { readonly outcome: "no_request" }
  | {
    readonly outcome: "paused_user_applied";
    readonly request: ControlRequest;
    readonly previousStatus: MissionRunStatus;
    readonly wakeCancelledCount: number;
  }
  | {
    readonly outcome: "stop_applied";
    readonly request: ControlRequest;
    readonly previousStatus: MissionRunStatus;
    readonly terminalStatus: "stopped" | "cancelled";
    readonly wakeCancelledCount: number;
  };

// ── Row shapes (internal) ───────────────────────────────────────────

interface MissionRunRow {
  readonly id: string;
  readonly status: MissionRunStatus;
  readonly session_id: string;
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

interface ControlRequestRow {
  readonly id: string;
  readonly session_id: string;
  readonly mission_run_id: string | null;
  readonly kind: ControlRequestKind;
  readonly status: ControlRequest["status"];
  readonly requested_by: ControlRequest["requestedBy"];
  readonly reason: string | null;
  readonly correlation_id: string | null;
  readonly created_at: Date;
  readonly observed_at: Date | null;
  readonly cleared_at: Date | null;
  readonly expires_at: Date | null;
}

function mapLease(r: RunnerLeaseRow): RunnerLease {
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

function mapControlRequest(r: ControlRequestRow): ControlRequest {
  return {
    id: r.id,
    sessionId: r.session_id,
    missionRunId: r.mission_run_id,
    kind: r.kind,
    status: r.status,
    requestedBy: r.requested_by,
    reason: r.reason,
    correlationId: r.correlation_id,
    createdAt: r.created_at,
    observedAt: r.observed_at,
    clearedAt: r.cleared_at,
    expiresAt: r.expires_at,
  };
}

// ── claimRunLeaseAndFlipToRunning ───────────────────────────────────

/**
 * Atomic helper for resume-style continuation paths.
 *
 *   1. Lock `mission_runs[id]` `FOR UPDATE`.
 *   2. Validate `currentStatus IN fromStatuses` (else `status_mismatch`).
 *   3. Lock `runner_leases[session_id]` `FOR UPDATE` if present.
 *   4. Validate lease is absent OR expired OR owned by us
 *      (else `lease_busy`).
 *   5. UPDATE mission_runs SET status='running', last_checkpoint_at=NOW().
 *   6. **If `previousStatus === "paused_wake"`**: cancel pending wakes
 *      for this session (consumed_by_resume).
 *   7. INSERT/UPSERT runner_leases via the same primitive as
 *      `acquireLease` but inside this transaction.
 *
 * One commit; no inter-statement race window.
 */
export async function claimRunLeaseAndFlipToRunning(
  input: ClaimRunInput,
): Promise<ClaimRunOutcome> {
  return withTransaction(async (client) => {
    // 1. Lock mission_runs row.
    const run = await queryOneWith<MissionRunRow>(
      client,
      `SELECT id, status, session_id FROM mission_runs WHERE id = $1 FOR UPDATE`,
      [input.missionRunId],
    );
    if (run === null) {
      return { outcome: "status_mismatch", currentStatus: null };
    }
    if (!input.fromStatuses.includes(run.status)) {
      return { outcome: "status_mismatch", currentStatus: run.status };
    }
    const previousStatus = run.status;

    // 2. Lock + validate the lease row (if present).
    const existingLease = await queryOneWith<RunnerLeaseRow>(
      client,
      `SELECT session_id, mission_run_id, owner_id, process_kind,
              acquired_at, heartbeat_at, expires_at
         FROM runner_leases
        WHERE session_id = $1
        FOR UPDATE`,
      [input.sessionId],
    );
    if (
      existingLease !== null
      && existingLease.expires_at >= new Date()
      && existingLease.owner_id !== input.ownerId
    ) {
      return { outcome: "lease_busy", currentLease: mapLease(existingLease) };
    }

    // 3. Flip status to running. Bump last_checkpoint_at so the engine's
    //    bridge / observer wake up.
    await executeWith(
      client,
      `UPDATE mission_runs
          SET status = 'running', last_checkpoint_at = NOW()
        WHERE id = $1`,
      [input.missionRunId],
    );

    // 4. Wake cleanup — conditional on the OBSERVED `previousStatus`,
    //    not on the static `fromStatuses` (codex acceptance criterion).
    let wakeCancelledCount = 0;
    if (previousStatus === "paused_wake") {
      wakeCancelledCount = await executeWith(
        client,
        `UPDATE loop_wake_requests
            SET status            = 'cancelled',
                cancelled_at      = NOW(),
                cancelled_reason  = 'consumed_by_resume'
          WHERE session_id = $1
            AND status     = 'pending'`,
        [input.sessionId],
      );
    }

    // 5. Acquire (or refresh) the lease inside the same tx.
    const lease = await acquireLease(
      {
        sessionId: input.sessionId,
        missionRunId: input.missionRunId,
        ownerId: input.ownerId,
        processKind: input.processKind,
        ttlMs: input.ttlMs,
      },
      client,
    );
    // The WHERE clause inside `acquireLease` matches because we already
    // proved the lease is absent / expired / same-owner above (under
    // FOR UPDATE), so `lease` must be non-null here. Throw if it
    // is — that means a schema invariant broke and we shouldn't fake
    // a "claimed" outcome.
    if (lease === null) {
      throw new Error(
        "claimRunLeaseAndFlipToRunning: lease upsert returned null despite passing validation",
      );
    }

    return {
      outcome: "claimed",
      previousStatus,
      lease,
      wakeCancelledCount,
    };
  });
}

// ── claimSessionLease ───────────────────────────────────────────────

/**
 * Atomic per-session lease claim for chat-only flow (no mission_run_id).
 * Uses the same INSERT ... ON CONFLICT primitive but inside its own
 * single-statement transaction so two rapid `chat.submit` IPC calls
 * can't fork the turn loop.
 */
export async function claimSessionLease(
  input: ClaimSessionLeaseInput,
): Promise<ClaimSessionLeaseOutcome> {
  return withTransaction(async (client) => {
    // Lock existing lease (if any) first so we can return its
    // `expires_at` for `retryAfterMs` on busy.
    const existingLease = await queryOneWith<RunnerLeaseRow>(
      client,
      `SELECT session_id, mission_run_id, owner_id, process_kind,
              acquired_at, heartbeat_at, expires_at
         FROM runner_leases
        WHERE session_id = $1
        FOR UPDATE`,
      [input.sessionId],
    );
    if (
      existingLease !== null
      && existingLease.expires_at >= new Date()
      && existingLease.owner_id !== input.ownerId
    ) {
      return { outcome: "lease_busy", currentLease: mapLease(existingLease) };
    }

    const lease = await acquireLease(
      {
        sessionId: input.sessionId,
        ownerId: input.ownerId,
        processKind: input.processKind,
        ttlMs: input.ttlMs,
      },
      client,
    );
    if (lease === null) {
      throw new Error(
        "claimSessionLease: lease upsert returned null despite passing validation",
      );
    }
    return { outcome: "claimed", lease };
  });
}

// ── observeAndApplyControl ──────────────────────────────────────────

/**
 * Atomic observe + apply for `pause_after_step` / `stop_terminal`
 * control requests. Called from engine safe checkpoints.
 *
 *   1. Lock the next pending request matching `kinds`
 *      (`FOR UPDATE SKIP LOCKED`).
 *   2. Lock the active mission_run for that session (if any).
 *   3. For `pause_after_step`: UPDATE run status='paused_user',
 *      stop_reason='user_paused'. Wake cleanup conditional on
 *      `previousStatus === "paused_wake"`.
 *   4. For `stop_terminal`: UPDATE run status='stopped' (or 'cancelled'
 *      if run had no work yet — for now we choose 'stopped' uniformly,
 *      finer logic can come in puzzle 04). Cancel pending wakes.
 *      Release the lease so a future resume can re-claim.
 *   5. Mark the request `cleared`.
 *
 * Returns the outcome discriminator + previous status + wake count.
 * Event broadcast happens AFTER the surrounding caller acts on the
 * returned outcome (so the bus emits only after commit).
 */
export async function observeAndApplyControl(
  input: ObserveControlInput,
): Promise<ObserveControlOutcome> {
  return withTransaction(async (client) => {
    // 1. Lock next matching pending request.
    const claimed = await queryOneWith<{ id: string }>(
      client,
      `SELECT id FROM runtime_control_requests
        WHERE session_id = $1
          AND kind = ANY($2::text[])
          AND status = 'pending'
        ORDER BY created_at ASC, id ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1`,
      [input.sessionId, input.kinds],
    );
    if (claimed === null) {
      return { outcome: "no_request" };
    }

    const observedRow = await queryOneWith<ControlRequestRow>(
      client,
      `UPDATE runtime_control_requests
          SET status      = 'observed',
              observed_at = NOW()
        WHERE id = $1
        RETURNING id, session_id, mission_run_id, kind, status, requested_by,
                  reason, correlation_id, created_at, observed_at,
                  cleared_at, expires_at`,
      [claimed.id],
    );
    if (observedRow === null) {
      throw new Error(
        "observeAndApplyControl: request row vanished between SELECT and UPDATE",
      );
    }
    const request = mapControlRequest(observedRow);

    // 2. Lock the active run for this session (if any).
    const activeRun = await queryOneWith<MissionRunRow>(
      client,
      `SELECT id, status, session_id
         FROM mission_runs
        WHERE session_id = $1
          AND status NOT IN (${[...TERMINAL_RUN_STATUSES].map((_, i) => `$${i + 2}`).join(", ")})
        ORDER BY started_at DESC
        LIMIT 1
        FOR UPDATE`,
      [input.sessionId, ...TERMINAL_RUN_STATUSES],
    );

    // 3+4. Apply the state transition by kind.
    if (request.kind === "pause_after_step") {
      if (activeRun === null) {
        // No active run to pause — just clear and emit a no-op outcome.
        await executeWith(
          client,
          `UPDATE runtime_control_requests
              SET status     = 'cleared',
                  cleared_at = NOW(),
                  reason     = COALESCE(reason, 'no_active_run')
            WHERE id = $1`,
          [request.id],
        );
        return {
          outcome: "paused_user_applied",
          request,
          previousStatus: "running",
          wakeCancelledCount: 0,
        };
      }
      const previousStatus = activeRun.status;

      await executeWith(
        client,
        `UPDATE mission_runs
            SET status        = 'paused_user',
                stop_reason   = 'user_paused',
                last_checkpoint_at = NOW()
          WHERE id = $1`,
        [activeRun.id],
      );

      let wakeCancelledCount = 0;
      if (previousStatus === "paused_wake") {
        wakeCancelledCount = await executeWith(
          client,
          `UPDATE loop_wake_requests
              SET status            = 'cancelled',
                  cancelled_at      = NOW(),
                  cancelled_reason  = 'consumed_by_pause'
            WHERE session_id = $1 AND status = 'pending'`,
          [input.sessionId],
        );
      }

      await executeWith(
        client,
        `UPDATE runtime_control_requests
            SET status      = 'cleared',
                cleared_at  = NOW()
          WHERE id = $1`,
        [request.id],
      );

      return {
        outcome: "paused_user_applied",
        request,
        previousStatus,
        wakeCancelledCount,
      };
    }

    // stop_terminal
    if (activeRun === null) {
      await executeWith(
        client,
        `UPDATE runtime_control_requests
            SET status     = 'cleared',
                cleared_at = NOW(),
                reason     = COALESCE(reason, 'no_active_run')
          WHERE id = $1`,
        [request.id],
      );
      return {
        outcome: "stop_applied",
        request,
        previousStatus: "running",
        terminalStatus: "stopped",
        wakeCancelledCount: 0,
      };
    }
    const previousStatus = activeRun.status;

    await executeWith(
      client,
      `UPDATE mission_runs
          SET status      = 'stopped',
              stop_reason = 'user_stopped',
              ended_at    = NOW(),
              last_checkpoint_at = NOW()
        WHERE id = $1`,
      [activeRun.id],
    );

    const wakeCancelledCount = await executeWith(
      client,
      `UPDATE loop_wake_requests
          SET status            = 'cancelled',
              cancelled_at      = NOW(),
              cancelled_reason  = 'consumed_by_stop'
        WHERE session_id = $1 AND status = 'pending'`,
      [input.sessionId],
    );

    // Release any active lease so a future fresh run can claim.
    await executeWith(
      client,
      `DELETE FROM runner_leases WHERE session_id = $1`,
      [input.sessionId],
    );

    await executeWith(
      client,
      `UPDATE runtime_control_requests
          SET status     = 'cleared',
              cleared_at = NOW()
        WHERE id = $1`,
      [request.id],
    );

    return {
      outcome: "stop_applied",
      request,
      previousStatus,
      terminalStatus: "stopped",
      wakeCancelledCount,
    };
  });
}
