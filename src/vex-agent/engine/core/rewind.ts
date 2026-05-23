/**
 * `/rewind [N]` engine entry point.
 *
 * Soft rollback of the last N user → assistant exchanges. Messages are
 * MOVED to `messages_archive` (not hard-deleted) so a future `/restore`
 * (puzzle 04 phase 3) can unarchive them.
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
 *   4. Open one tx that:
 *        a. locks the session row (symmetric with `archivePrefix` /
 *           `restoreLatestCheckpoint` per codex);
 *        b. creates the rewind_checkpoint row so the archive can stamp
 *           `rewind_checkpoint_id` (mig 023 FK requires the target to
 *           exist);
 *        c. archives the suffix with `rewindCheckpointId = checkpoint.id`
 *           so `/restore` can later unarchive exactly these rows;
 *        d. updates the checkpoint's `archived_count` with the real
 *           number of rows moved.
 *      The whole pipeline commits or rolls back together.
 */

import * as messagesRepo from "@vex-agent/db/repos/messages.js";
import * as missionRunsRepo from "@vex-agent/db/repos/mission-runs.js";
import * as sessionsRepo from "@vex-agent/db/repos/sessions.js";
import * as loopWakeRepo from "@vex-agent/db/repos/loop-wake.js";
import * as rewindCheckpointsRepo from "@vex-agent/db/repos/rewind-checkpoints.js";
import { withTransaction, queryOneWith } from "@vex-agent/db/client.js";
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
  /** Stamp on every archived row; null when the rewind was a no-op. */
  readonly checkpointId: string | null;
  readonly missionRunImpact: "none" | "stopped" | "blocked";
  /** True when the session has zero user messages — informational, not an error. */
  readonly noop: boolean;
}

const NOOP: RewindOutcome = {
  archivedMessages: 0,
  rejectedApprovals: 0,
  cancelledWakes: 0,
  cutoffMessageId: null,
  checkpointId: null,
  missionRunImpact: "none",
  noop: true,
};

const BLOCKED: RewindOutcome = {
  archivedMessages: 0,
  rejectedApprovals: 0,
  cancelledWakes: 0,
  cutoffMessageId: null,
  checkpointId: null,
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
  let stoppedRunId: string | null = null;

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
      stoppedRunId = activeRun.id;
      logger.info("engine.rewind.stopped_paused_run", {
        sessionId,
        runId: activeRun.id,
        previousStatus: activeRun.status,
        rejectedApprovals: approvalsFromStop,
      });
    }
  }

  // ── 2. Compute cutoff (id + created_at for the checkpoint row) ──
  const cutoff = await selectCutoffMessage(sessionId, turns);
  if (cutoff === null) {
    return { ...NOOP, missionRunImpact };
  }

  // ── 3. Reject pending approvals (any not already drained by stop) ──
  const approvalsFromRewind = await rejectPendingApprovalsForSession(sessionId);

  // ── 4. Cancel pending wakes ──────────────────────────────────
  const cancelledWakes = await loopWakeRepo.cancelForSession(sessionId, "user_rewind");

  // ── 5. Atomic: lock session, create checkpoint, archive suffix
  //       stamped with the checkpoint id, update archived_count ──
  const { checkpointId, archivedCount } = await withTransaction(async (client) => {
    // 5a. Session row lock first — symmetric with `archivePrefix` and
    //     `restoreLatestCheckpoint` so all three message-set mutators
    //     serialize on the same row.
    await queryOneWith<{ id: string }>(
      client,
      `SELECT id FROM sessions WHERE id = $1 FOR UPDATE`,
      [sessionId],
    );

    // 5b. Create the checkpoint row up-front so the archive INSERT
    //     can stamp `rewind_checkpoint_id = $checkpoint.id` (mig 023
    //     FK on `messages_archive.rewind_checkpoint_id` requires the
    //     target row to exist). `archived_count` starts at 0; step
    //     5d updates it once the archive returns the real count.
    const checkpoint = await rewindCheckpointsRepo.createCheckpoint(client, {
      sessionId,
      missionRunId: stoppedRunId,
      cutoffMessageId: cutoff.messageId,
      cutoffCreatedAt: cutoff.createdAt,
      archivedCount: 0,
      createdBy: "user",
      reason: `rewind ${turns} turn${turns === 1 ? "" : "s"}`,
    });

    // 5c. Archive the suffix, stamping every moved row with the
    //     checkpoint id so `/restore` can later unarchive exactly
    //     these rows.
    const archive = await sessionsRepo.archiveSuffix(
      sessionId,
      cutoff.messageId,
      checkpoint.id,
      client,
    );

    // 5d. Update the checkpoint with the real archived_count.
    await rewindCheckpointsRepo.setCheckpointArchivedCount(
      client,
      checkpoint.id,
      archive.archivedCount,
    );

    return {
      checkpointId: checkpoint.id,
      archivedCount: archive.archivedCount,
      remainingCount: archive.remainingCount,
    };
  });

  logger.info("engine.session.rewind", {
    sessionId,
    turns,
    cutoffMessageId: cutoff.messageId,
    archivedMessages: archivedCount,
    checkpointId,
    rejectedApprovalsTotal: approvalsFromStop + approvalsFromRewind,
    cancelledWakes,
    missionRunImpact,
  });

  return {
    archivedMessages: archivedCount,
    rejectedApprovals: approvalsFromStop + approvalsFromRewind,
    cancelledWakes,
    cutoffMessageId: cutoff.messageId,
    checkpointId,
    missionRunImpact,
    noop: false,
  };
}

interface RewindCutoff {
  readonly messageId: number;
  readonly createdAt: string;
}

/**
 * Walk the live tape from the end backwards, count `role:"user"` rows.
 * Cutoff is the Nth-most-recent user message — the rewind archives
 * that user message and everything after it.
 *
 * Returns `null` when the session has zero user messages (no-op). When
 * fewer than `turns` user messages exist, returns the very first user
 * message so the rewind degrades gracefully instead of erroring.
 *
 * The `created_at` is captured here so the checkpoint row can record
 * it without an extra round-trip inside the rewind tx.
 */
async function selectCutoffMessage(
  sessionId: string,
  turns: number,
): Promise<RewindCutoff | null> {
  const messages = await messagesRepo.getLiveMessages(sessionId);
  const users: RewindCutoff[] = [];
  for (const m of messages) {
    if (m.role !== "user") continue;
    if (typeof m.id !== "number") continue;
    users.push({ messageId: m.id, createdAt: m.timestamp });
  }
  if (users.length === 0) return null;

  const fromEnd = Math.min(turns, users.length);
  // users is in chronological order; the Nth-from-end is at length - fromEnd.
  return users[users.length - fromEnd] ?? null;
}
