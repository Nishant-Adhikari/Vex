/**
 * Deadline watchdog — the agent-INDEPENDENT hard-deadline enforcement path.
 *
 * The loop-boundary enforcer (turn-loop.ts) only fires while the turn loop is
 * actively iterating. A PARKED run (`paused_error` / `paused_wake` /
 * `paused_user` / `paused_approval` / `paused_plan_acceptance`) never reaches
 * that boundary until something resumes it, so before this watchdog a mission
 * could sit past its hard deadline indefinitely — observed live, a 5-minute box
 * ran 1h20m before the deadline finally fired on resume.
 *
 * This sweep runs on a wall-clock timer (hosted by the wake executor's
 * scheduler) and, independently of any inference, stops every active-or-parked
 * run whose FROZEN deadline has passed:
 *
 *   - Parked runs (any `paused_*` state) → stopped when past due, full stop.
 *   - Running runs → stopped only when the lease is DEAD (a ghost run whose
 *     process died); a running run with a LIVE lease is left for the loop's own
 *     boundary check, so we never yank a row out from under a live loop.
 *
 * Concurrency + idempotency: the stop is a single atomic CAS
 * (`casStopPastDeadline`, SELECT … FOR UPDATE → terminal in one tx). Only one
 * winner flips the row; a second sweep, a resume, or the loop-boundary enforcer
 * that already terminated the run all see `null` and become no-ops.
 *
 * Position CLOSING is intentionally OUT OF SCOPE here. The maintainer deferred
 * deadline-aware liquidation to a designed prepared-close flow with its own
 * approval story (see `runner/mission-liquidate-hook.ts`, which the in-loop
 * path uses). This watchdog NEVER auto-sells: it stops the run and SURFACES any
 * open bag via the stop summary + the `timed_out` ledger capture
 * (`open_positions_json`), so an operator can act on it.
 *
 * Pure `sweepMissionDeadlines(now, deps)` with injected deps so tests exercise
 * the filtering + stop orchestration with no DB (mirrors wake/executor.ts).
 */

import logger from "@utils/logger.js";
import {
  PAUSED_RUN_STATUSES,
  type MissionRunStatus,
} from "../types.js";
import type { MissionRun } from "@vex-agent/db/repos/mission-runs.js";

// ── Deps (injected) ─────────────────────────────────────────────────

export interface DeadlineWatchdogDeps {
  /** Active-or-parked run rows — the candidate set for the sweep. */
  listCandidateRuns(): Promise<MissionRun[]>;
  /**
   * The run's hard-deadline epoch (ms) from its immutable started_at + frozen
   * box duration, or null (fail-open — no deadline, never stop).
   */
  resolveDeadlineMs(run: MissionRun): number | null;
  /** The session's runner lease (liveness = expiresAt in the future), or null. */
  getLease(sessionId: string): Promise<{ expiresAt: Date } | null>;
  /** Atomic, idempotent claim → terminal `failed`/`deadline_reached`. */
  casStopPastDeadline(
    runId: string,
    fromStatuses: readonly MissionRunStatus[],
    payload: {
      stopReason: "deadline_reached";
      summary?: string;
      evidence?: Record<string, unknown>;
    },
  ): Promise<MissionRunStatus | null>;
  /**
   * Reject every still-pending approval for the run's session. A swept
   * `paused_approval` run otherwise leaves its `approval_queue` row pending —
   * the UI keeps listing it, and a later approve/reject would try to resume and
   * flip the (now terminal) run back to `paused_error`. Same helper abort/rewind
   * use. Returns the count rejected.
   */
  rejectPendingApprovals(sessionId: string): Promise<number>;
  /** Move the parent mission row to `failed` (mirrors finalize). */
  setMissionFailed(missionId: string): Promise<void>;
  /** Close the ledger row as `timed_out` (captures the open-position bag). */
  captureTimedOut(args: {
    missionId: string;
    runId: string;
    sessionId: string;
  }): Promise<void>;
  /** Broadcast the post-finalize control-state event to the renderer. */
  emitControlState(sessionId: string, runId: string): Promise<void>;
}

// ── Outcomes (observable for tests / health / logs) ─────────────────

export type DeadlineSweepOutcome =
  | { kind: "stopped"; runId: string; previousStatus: MissionRunStatus }
  | { kind: "skipped_already_terminal"; runId: string }
  | { kind: "skipped_not_due"; runId: string }
  | { kind: "skipped_no_deadline"; runId: string }
  | { kind: "skipped_live_lease"; runId: string }
  | { kind: "error"; runId: string; message: string };

// ── Sweep ───────────────────────────────────────────────────────────

/**
 * One watchdog pass. Returns a per-run outcome so the scheduler, tests, and
 * health surfaces can observe exactly what the sweep did. Per-run failures are
 * isolated — one bad row never poisons the rest of the batch.
 */
export async function sweepMissionDeadlines(
  now: Date,
  deps: DeadlineWatchdogDeps,
): Promise<DeadlineSweepOutcome[]> {
  const runs = await deps.listCandidateRuns();
  const outcomes: DeadlineSweepOutcome[] = [];
  for (const run of runs) {
    try {
      outcomes.push(await evaluateRun(run, now, deps));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("engine.mission.deadline_watchdog.run_failed", {
        runId: run.id,
        sessionId: run.sessionId,
        error: message,
      });
      outcomes.push({ kind: "error", runId: run.id, message });
    }
  }
  return outcomes;
}

async function evaluateRun(
  run: MissionRun,
  now: Date,
  deps: DeadlineWatchdogDeps,
): Promise<DeadlineSweepOutcome> {
  const deadlineMs = deps.resolveDeadlineMs(run);
  if (deadlineMs == null) return { kind: "skipped_no_deadline", runId: run.id };
  if (now.getTime() < deadlineMs) return { kind: "skipped_not_due", runId: run.id };

  // A live loop enforces its own deadline at the turn boundary — only reap a
  // RUNNING row when its lease is dead (a ghost: status says running, process
  // is gone). Parked rows have no live loop, so they are always eligible.
  if (run.status === "running") {
    const lease = await deps.getLease(run.sessionId);
    if (lease && lease.expiresAt.getTime() >= now.getTime()) {
      return { kind: "skipped_live_lease", runId: run.id };
    }
  }

  return stopPastDeadline(run, now, deadlineMs, deps);
}

async function stopPastDeadline(
  run: MissionRun,
  now: Date,
  deadlineMs: number,
  deps: DeadlineWatchdogDeps,
): Promise<DeadlineSweepOutcome> {
  const parked = run.status !== "running";
  const fromStatuses: readonly MissionRunStatus[] = parked
    ? Array.from(PAUSED_RUN_STATUSES)
    : (["running"] as const);

  const summary = parked
    ? `Hard deadline reached while parked (${run.status}) — stopped by the deadline watchdog. ` +
      `Any position this mission opened remains OPEN and needs attention; automatic ` +
      `close is deferred to the prepared-close flow (not auto-sold).`
    : `Hard deadline reached on a ghost run (running, lease dead) — stopped by the ` +
      `deadline watchdog. Any open position remains OPEN and needs attention; ` +
      `automatic close is deferred to the prepared-close flow (not auto-sold).`;

  // Claim atomically. `null` = another path already terminated/resumed the run
  // → this pass is a no-op (idempotent); do NOT re-run the terminal side-effects.
  const previousStatus = await deps.casStopPastDeadline(run.id, fromStatuses, {
    stopReason: "deadline_reached",
    summary,
    evidence: {
      enforcedWhileParked: parked,
      // Position auto-close is deferred — the bag is surfaced, never sold here.
      positionCloseDeferred: true,
      parkedStatus: run.status,
      deadlineMs,
      sweptAt: now.toISOString(),
    },
  });
  if (previousStatus == null) {
    return { kind: "skipped_already_terminal", runId: run.id };
  }

  // Resolve any pending approvals FIRST — a swept `paused_approval` run has a
  // pending `approval_queue` row that would otherwise linger in the UI and let a
  // later approve/reject resume + `flipRunToPausedError` this now-terminal run
  // back to `paused_error`. Scoped to the run's session (approval_queue has no
  // mission_run_id); the same helper abort/rewind use.
  const rejectedApprovals = await deps.rejectPendingApprovals(run.sessionId);

  // Terminal side-effects — mirror `finalizeMissionRunStatus`'s deadline branch
  // (mission row → failed, ledger → timed_out which snapshots the open-position
  // bag, control-state broadcast). Sequential like finalize; the CAS above is
  // the concurrency gate that guarantees only one sweeper reaches here.
  await deps.setMissionFailed(run.missionId);
  await deps.captureTimedOut({
    missionId: run.missionId,
    runId: run.id,
    sessionId: run.sessionId,
  });
  await deps.emitControlState(run.sessionId, run.id);

  logger.info("engine.mission.deadline_enforced", {
    missionRunId: run.id,
    sessionId: run.sessionId,
    deadlineMs,
    previousStatus,
    enforcedWhileParked: parked,
    rejectedApprovals,
    path: "watchdog",
  });

  return { kind: "stopped", runId: run.id, previousStatus };
}
