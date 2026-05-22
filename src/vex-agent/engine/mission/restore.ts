/**
 * Restore the latest unrestored rewind checkpoint for a session.
 *
 * Puzzle 04 ships LIFO-only semantics: `/restore` always operates on
 * the newest unrestored checkpoint. Richer history browsing lands
 * later.
 *
 * Critical invariants (codex review):
 *
 *   - **Session row lock first.** All three message-set mutators
 *     (`archiveSuffix`, `archivePrefix`, restore) take
 *     `SELECT id FROM sessions WHERE id = $1 FOR UPDATE` as the FIRST
 *     statement of their tx. This serializes restore against any
 *     concurrent rewind/compaction so `message_count` never drifts.
 *
 *   - **Lease claim** via `acquireLease`. Active chat turn / mission
 *     run / other restore holds the lease → `lease_busy`. Released
 *     in the same tx before COMMIT.
 *
 *   - **Stamped unarchive, not range.** `DELETE FROM messages_archive
 *     WHERE rewind_checkpoint_id = $1` only touches rows archived by
 *     this specific rewind. Compaction (`archivePrefix`) and
 *     giant-tool overflow leave the stamp NULL and are immune.
 *
 *   - **sessions.message_count round-trip.** Rewind decremented;
 *     restore increments by the same N inside the tx.
 *
 *   - **Idempotency.** Same `idempotencyKey` re-applied after a
 *     successful restore returns a no-op success with the existing
 *     state. A different key against the latest unrestored checkpoint
 *     is the normal "fresh restore" path. The UNIQUE INDEX on
 *     `restore_idempotency_key` is the DB-level safety net.
 *
 *   - **Post-commit emit.** Transcript bus events fire AFTER COMMIT
 *     so a rolled-back restore never produces a visible UI
 *     invalidation.
 *
 * SQL helpers + row shapes + emit live in `restore-internals.ts` so
 * this file stays a readable single-purpose orchestrator.
 */

import { randomUUID } from "node:crypto";

import {
  queryOneWith,
  withTransaction,
} from "../../db/client.js";
import {
  acquireLease,
  getLease,
  releaseLease,
  type RunnerLease,
} from "../../db/repos/runner-leases.js";
import {
  getCheckpointForUpdate,
  getLatestUnrestoredCheckpoint,
  markCheckpointRestored,
  type RewindCheckpoint,
} from "../../db/repos/rewind-checkpoints.js";
import {
  transcriptEventBus,
  type TranscriptEventBus,
} from "../events/transcript-bus.js";

import {
  checkActiveRun,
  checkExistingIdempotencyMatch,
  checkPendingApproval,
  emitRestoredMessages,
  incrementSessionMessageCount,
  unarchiveStampedRows,
  type RestoreSuccessSnapshot,
} from "./restore-internals.js";

const RESTORE_LEASE_TTL_MS = 30_000;

export interface RestoreLatestCheckpointInput {
  readonly sessionId: string;
  readonly idempotencyKey: string;
  /** Optional injected bus for tests; defaults to the singleton. */
  readonly bus?: TranscriptEventBus;
}

export type RestoreLatestCheckpointOutcome =
  | {
    readonly outcome: "restored";
    readonly checkpointId: string;
    readonly restoredAt: string;
    readonly restoredCount: number;
    readonly idempotencyKey: string;
  }
  | {
    readonly outcome: "noop_already_restored";
    readonly checkpointId: string;
    readonly restoredAt: string;
    readonly restoredCount: number;
    readonly idempotencyKey: string;
  }
  | { readonly outcome: "no_checkpoint" }
  | { readonly outcome: "session_not_found" }
  | {
    readonly outcome: "blocked_active_run";
    readonly missionRunId: string;
    readonly runStatus: string;
  }
  | {
    readonly outcome: "blocked_pending_approval";
    readonly approvalId: string;
  }
  | {
    readonly outcome: "lease_busy";
    readonly currentLease: RunnerLease;
  };

function noopOutcomeFromCheckpoint(
  checkpoint: RewindCheckpoint,
): RestoreLatestCheckpointOutcome {
  if (checkpoint.restoredAt === null || checkpoint.restoreIdempotencyKey === null) {
    throw new Error(
      "restoreLatestCheckpoint: noop branch hit on a checkpoint without restored_at/idempotency_key",
    );
  }
  return {
    outcome: "noop_already_restored",
    checkpointId: checkpoint.id,
    restoredAt: checkpoint.restoredAt,
    restoredCount: checkpoint.archivedCount,
    idempotencyKey: checkpoint.restoreIdempotencyKey,
  };
}

function syntheticLeaseBusy(sessionId: string): RestoreLatestCheckpointOutcome {
  // Defensive — acquireLease returned null but the row disappeared
  // before our follow-up read. Treat as transient busy; the renderer
  // will retry. We construct a placeholder lease rather than crashing
  // the tx so the IPC layer can surface a useful error.
  return {
    outcome: "lease_busy",
    currentLease: {
      sessionId,
      missionRunId: null,
      ownerId: "<unknown>",
      processKind: "electron_main",
      acquiredAt: new Date(0),
      heartbeatAt: new Date(0),
      expiresAt: new Date(0),
    },
  };
}

/**
 * Restore the latest unrestored checkpoint for `sessionId`. LIFO-only
 * for puzzle 04.
 */
export async function restoreLatestCheckpoint(
  input: RestoreLatestCheckpointInput,
): Promise<RestoreLatestCheckpointOutcome> {
  const ownerId = `restore-${randomUUID()}`;

  const result = await withTransaction(async (client): Promise<{
    outcome: RestoreLatestCheckpointOutcome;
    successSnapshot?: RestoreSuccessSnapshot;
  }> => {
    // 1. Session row lock first — serialize against rewind / compaction.
    //    A missing sessionId returns no row; reject explicitly so we
    //    never hit `acquireLease` with a session that doesn't exist
    //    (FK on `runner_leases.session_id` would throw otherwise).
    const sessionLockRow = await queryOneWith<{ id: string }>(
      client,
      `SELECT id FROM sessions WHERE id = $1 FOR UPDATE`,
      [input.sessionId],
    );
    if (sessionLockRow === null) {
      return { outcome: { outcome: "session_not_found" } };
    }

    // 2. Lease claim.
    const lease = await acquireLease(
      {
        sessionId: input.sessionId,
        ownerId,
        processKind: "electron_main",
        ttlMs: RESTORE_LEASE_TTL_MS,
      },
      client,
    );
    if (lease === null) {
      const currentLease = await getLease(input.sessionId, client);
      return {
        outcome: currentLease
          ? { outcome: "lease_busy", currentLease }
          : syntheticLeaseBusy(input.sessionId),
      };
    }

    // 3. Idempotency replay — same key against an already-restored
    //    checkpoint for this session = no-op success.
    const replay = await checkExistingIdempotencyMatch(
      client,
      input.sessionId,
      input.idempotencyKey,
    );
    if (replay) {
      await releaseLease(input.sessionId, ownerId, client);
      return { outcome: noopOutcomeFromCheckpoint(replay) };
    }

    // 4. Find + lock the latest unrestored checkpoint.
    const candidate = await getLatestUnrestoredCheckpoint(client, input.sessionId);
    if (!candidate) {
      await releaseLease(input.sessionId, ownerId, client);
      return { outcome: { outcome: "no_checkpoint" } };
    }
    const checkpoint = await getCheckpointForUpdate(client, candidate.id);
    if (!checkpoint || checkpoint.restoredAt !== null) {
      // Race: another tx restored it between LIMIT 1 and FOR UPDATE.
      await releaseLease(input.sessionId, ownerId, client);
      return { outcome: { outcome: "no_checkpoint" } };
    }

    // 5. Blocking checks. paused_user / paused_error / paused_approval
    //    / paused_wake are all in ACTIVE_OR_PAUSED_RUN_STATUSES per
    //    engine/types.ts. Pending approvals checked independently.
    const activeRun = await checkActiveRun(client, input.sessionId);
    if (activeRun) {
      await releaseLease(input.sessionId, ownerId, client);
      return {
        outcome: {
          outcome: "blocked_active_run",
          missionRunId: activeRun.id,
          runStatus: activeRun.status,
        },
      };
    }

    const pendingApprovalId = await checkPendingApproval(client, input.sessionId);
    if (pendingApprovalId) {
      await releaseLease(input.sessionId, ownerId, client);
      return {
        outcome: {
          outcome: "blocked_pending_approval",
          approvalId: pendingApprovalId,
        },
      };
    }

    // 6. Atomic unarchive — DELETE...RETURNING → INSERT.
    const restoredRows = await unarchiveStampedRows(client, checkpoint.id);

    // 7. message_count += restoredRows.length.
    await incrementSessionMessageCount(
      client,
      input.sessionId,
      restoredRows.length,
    );

    // 8. Stamp the checkpoint with the idempotency key + timestamp.
    await markCheckpointRestored(client, checkpoint.id, input.idempotencyKey);

    // 9. Re-read the checkpoint so the returned restoredAt matches
    //    the committed row (NOW() resolved by Postgres).
    const stamped = await getCheckpointForUpdate(client, checkpoint.id);
    const restoredAt = stamped?.restoredAt ?? new Date().toISOString();

    // 10. Release lease BEFORE COMMIT (still inside the tx).
    await releaseLease(input.sessionId, ownerId, client);

    return {
      outcome: {
        outcome: "restored",
        checkpointId: checkpoint.id,
        restoredAt,
        restoredCount: restoredRows.length,
        idempotencyKey: input.idempotencyKey,
      },
      successSnapshot: {
        sessionId: input.sessionId,
        checkpointId: checkpoint.id,
        restoredAt,
        restoredMessages: restoredRows,
        idempotencyKey: input.idempotencyKey,
      },
    };
  });

  // 11. Post-commit emit. Only fires for the "restored" success path;
  //     idempotency replay / blocking / no_checkpoint produce no
  //     visible UI invalidation.
  if (result.successSnapshot) {
    emitRestoredMessages(result.successSnapshot, input.bus ?? transcriptEventBus);
  }

  return result.outcome;
}
