/**
 * `/rewind [N]` engine entry point.
 *
 * Soft rollback of the last N user → assistant exchanges. Messages are
 * MOVED to `messages_archive` (not hard-deleted) so a future `/unrewind`
 * can restore them; the operator picked archive-not-delete in the plan.
 *
 * Refuses while a mission run is `running`. For paused mission runs,
 * delegates to `stopActiveMissionForEdit` first so the run lands in a
 * terminal `stopped` state and the parent mission flips back to `draft` —
 * the operator can then save a fresh draft once they've rewound the
 * conversation.
 *
 * Cleanup order matters:
 *   1. Stop / abort the run (if any) so no in-flight resumer can pick the
 *      messages back up.
 *   2. Reject pending approvals scoped to the session — `approvalsRepo`
 *      has no FK to `messages`, so rejecting up front is the strongest
 *      guarantee that an `/approve` against a stale tool_call_id can't
 *      win the race against the archive write.
 *   3. Cancel pending wakes for the session — same defence-in-depth.
 *   4. Archive the suffix (atomic transaction inside the repo).
 */

import * as messagesRepo from "@vex-agent/db/repos/messages.js";
import * as missionRunsRepo from "@vex-agent/db/repos/mission-runs.js";
import * as sessionsRepo from "@vex-agent/db/repos/sessions.js";
import * as loopWakeRepo from "@vex-agent/db/repos/loop-wake.js";
import {
  ACTIVE_RUN_STATUSES,
  PAUSED_RUN_STATUSES,
} from "../types.js";
import { stopActiveMissionForEdit } from "./runner/abort.js";
import { rejectPendingApprovalsForSession } from "./runner/approvals-cleanup.js";
import logger from "@utils/logger.js";

export interface RewindOutcome {
  readonly archivedMessages: number;
  readonly rejectedApprovals: number;
  readonly cancelledWakes: number;
  readonly cutoffMessageId: number | null;
  readonly missionRunImpact: "none" | "stopped" | "blocked";
  /** True when the session has zero user messages — informational, not an error. */
  readonly noop: boolean;
}

const NOOP: RewindOutcome = {
  archivedMessages: 0,
  rejectedApprovals: 0,
  cancelledWakes: 0,
  cutoffMessageId: null,
  missionRunImpact: "none",
  noop: true,
};

const BLOCKED: RewindOutcome = {
  archivedMessages: 0,
  rejectedApprovals: 0,
  cancelledWakes: 0,
  cutoffMessageId: null,
  missionRunImpact: "blocked",
  noop: false,
};

export async function rewindSession(
  sessionId: string,
  turns: number,
): Promise<RewindOutcome> {
  if (!Number.isInteger(turns) || turns < 1 || turns > 50) {
    throw new Error(`rewindSession: turns must be an integer in [1,50], got ${turns}`);
  }

  // ── 1. Mission-run impact ────────────────────────────────────
  const activeRun = await missionRunsRepo.getActiveRunBySession(sessionId);
  let missionRunImpact: RewindOutcome["missionRunImpact"] = "none";
  let approvalsFromStop = 0;

  if (activeRun) {
    if (ACTIVE_RUN_STATUSES.has(activeRun.status)) {
      // Live loop — refuse. Operator must /mission stop first.
      logger.warn("engine.rewind.blocked_active_run", {
        sessionId,
        runId: activeRun.id,
        status: activeRun.status,
      });
      throw Object.assign(
        new Error(
          "Cannot rewind while a mission run is running. Use /mission stop first, then /rewind.",
        ),
        { rewindOutcome: BLOCKED },
      );
    }
    if (PAUSED_RUN_STATUSES.has(activeRun.status)) {
      const stopped = await stopActiveMissionForEdit(sessionId);
      missionRunImpact = "stopped";
      approvalsFromStop = stopped?.rejectedApprovals ?? 0;
      logger.info("engine.rewind.stopped_paused_run", {
        sessionId,
        runId: activeRun.id,
        previousStatus: activeRun.status,
        rejectedApprovals: approvalsFromStop,
      });
    }
  }

  // ── 2. Compute cutoff ────────────────────────────────────────
  const cutoff = await selectCutoffMessageId(sessionId, turns);
  if (cutoff === null) {
    return { ...NOOP, missionRunImpact };
  }

  // ── 3. Reject pending approvals (any not already drained by stop) ──
  const approvalsFromRewind = await rejectPendingApprovalsForSession(sessionId);

  // ── 4. Cancel pending wakes ──────────────────────────────────
  const cancelledWakes = await loopWakeRepo.cancelForSession(sessionId, "user_rewind");

  // ── 5. Archive the suffix (atomic) ───────────────────────────
  const archive = await sessionsRepo.archiveSuffix(sessionId, cutoff);

  logger.info("engine.session.rewind", {
    sessionId,
    turns,
    cutoffMessageId: cutoff,
    archivedMessages: archive.archivedCount,
    rejectedApprovalsTotal: approvalsFromStop + approvalsFromRewind,
    cancelledWakes,
    missionRunImpact,
    remainingCount: archive.remainingCount,
  });

  return {
    archivedMessages: archive.archivedCount,
    rejectedApprovals: approvalsFromStop + approvalsFromRewind,
    cancelledWakes,
    cutoffMessageId: cutoff,
    missionRunImpact,
    noop: false,
  };
}

/**
 * Walk the live tape from the end backwards, count `role:"user"` rows.
 * Cutoff is the id of the Nth-most-recent user message — the rewind
 * archives that user message and everything after it.
 *
 * Returns `null` when the session has zero user messages (no-op). When
 * fewer than `turns` user messages exist, returns the id of the very
 * first user message so the rewind degrades gracefully instead of
 * erroring.
 */
async function selectCutoffMessageId(
  sessionId: string,
  turns: number,
): Promise<number | null> {
  const messages = await messagesRepo.getLiveMessages(sessionId);
  const userIds: number[] = [];
  for (const m of messages) {
    if (m.role !== "user") continue;
    if (typeof m.id !== "number") continue;
    userIds.push(m.id);
  }
  if (userIds.length === 0) return null;

  const fromEnd = Math.min(turns, userIds.length);
  // userIds is in chronological order; the Nth-from-end is at length - fromEnd.
  return userIds[userIds.length - fromEnd];
}
