/**
 * `/retry` engine entry point.
 *
 * Re-enters the active mission run after a recoverable pause:
 *   - `paused_error` → provider error or other throw inside the runner;
 *     the operator wants to re-attempt once the issue is resolved.
 *   - `paused_wake`  → wake hasn't fired yet; the operator wants to skip
 *     the delay and resume immediately.
 *
 * Refuses (with explicit hint) for:
 *   - `paused_approval` → operator must `/approve` or `/reject` first.
 *   - `running`         → loop already in progress; nothing to retry.
 *   - no active run     → nothing to retry.
 *
 * Race safety: pending wakes for the session are cancelled FIRST so the
 * wake executor can't claim the run between our status read and the CAS.
 * The CAS itself (`casFlipToRunning`) takes a row-level lock and only
 * fires when the locked status is in the allowed set — if a wake snuck
 * through anyway, we get `null` back and refuse cleanly instead of
 * double-resuming.
 */

import type { TurnResult, MissionRunStatus } from "../../types.js";
import * as loopWakeRepo from "@vex-agent/db/repos/loop-wake.js";
import * as missionRunsRepo from "@vex-agent/db/repos/mission-runs.js";
import {
  ACTIVE_RUN_STATUSES,
  PAUSED_RUN_STATUSES,
  TERMINAL_RUN_STATUSES,
} from "../../types.js";
import logger from "@utils/logger.js";

const RETRYABLE_FROM_STATUSES: readonly MissionRunStatus[] = [
  "paused_error",
  "paused_wake",
];

export async function retryActiveMissionRun(sessionId: string): Promise<TurnResult> {
  const run = await missionRunsRepo.getActiveRunBySession(sessionId);
  if (!run) {
    throw new Error(
      "No active mission run to retry. Start one with /mission start first.",
    );
  }

  if (run.status === "paused_approval") {
    throw new Error(
      "Mission run is awaiting approval. Use /approve <id> or /reject <id> first.",
    );
  }

  if (TERMINAL_RUN_STATUSES.has(run.status)) {
    throw new Error(
      `Mission run is ${run.status} and cannot be retried. Start a fresh run.`,
    );
  }

  if (ACTIVE_RUN_STATUSES.has(run.status)) {
    throw new Error("Mission run is already in progress; nothing to retry.");
  }

  if (!PAUSED_RUN_STATUSES.has(run.status)) {
    // Coerced fallback (e.g. the safe-default `failed` from coerceStatus).
    // Surface explicitly rather than silently resume.
    throw new Error(`Mission run is in an unrecognised state (${run.status}).`);
  }

  // Cancel pending wakes BEFORE the CAS so the wake executor can't claim
  // this run while we're transitioning. cancelForSession is a single
  // statement; even when it loses a race with claimDue, the CAS below
  // still fails closed with a clear error.
  const cancelled = await loopWakeRepo.cancelForSession(sessionId, "user_retry");
  if (cancelled > 0) {
    logger.info("engine.retry.cancelled_wakes", {
      sessionId,
      runId: run.id,
      count: cancelled,
    });
  }

  const previous = await missionRunsRepo.casFlipToRunning(run.id, RETRYABLE_FROM_STATUSES);
  if (previous === null) {
    throw new Error(
      "Mission run was claimed by another resumer. Re-check status with /status.",
    );
  }

  logger.info("engine.retry.flipped_to_running", {
    sessionId,
    runId: run.id,
    previousStatus: previous,
  });

  // Lazy import to break the runner ↔ retry circular dependency.
  const { resumeMissionRun } = await import("./mission.js");
  return resumeMissionRun(run.id);
}
