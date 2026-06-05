/**
 * Approval runtime — post-tx recovery helpers (paused-error flip /
 * continuation-claim error kind).
 *
 * The snapshot tx in `../snapshot.ts` commits the queue+intent decision; the
 * post-tx side effects run AFTER that tx so an audit-write or dispatch failure
 * cannot roll back the decision itself. To prevent stranding the mission run
 * in `paused_approval` (decision resolved but no post-tx work completed),
 * every post-decision side effect is wrapped so a failure explicitly flips the
 * run to `paused_error` with audit evidence — the operator can `/retry` to
 * recover. These helpers are shared by the approve, dispatch-throw, reject, and
 * policy-drift side-effect paths.
 */

import * as missionRunsRepo from "../../../../db/repos/mission-runs.js";
import logger from "@utils/logger.js";

export const RESUME_CLAIM_ERROR_KIND = "ResumeClaimFailed";

/**
 * Transition the mission run to `paused_error` after a committed-decision
 * side effect fails. Best-effort: if the status update itself throws, log
 * structurally and continue — the original failure is already being
 * surfaced via the caller's thrown error.
 */
export async function flipRunToPausedError(
  approvalId: string,
  missionRunId: string,
  errorKind: string,
  evidence: Record<string, unknown>,
): Promise<void> {
  try {
    await missionRunsRepo.updateStatus(
      missionRunId,
      "paused_error",
      "approval_post_decision",
      { evidence: { approvalId, errorKind, ...evidence } },
    );
  } catch (statusErr) {
    logger.warn("engine.approval_runtime.paused_error_update_failed", {
      approvalId,
      missionRunId,
      errorKind:
        statusErr instanceof Error
          ? statusErr.constructor.name
          : typeof statusErr,
    });
  }
}
