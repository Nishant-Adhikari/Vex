/**
 * Approval runtime — engine-side scheduled TTL sweep.
 *
 * Per-row exception isolation: a single broken row does not abort the
 * cycle. Logger output is structural only (Codex puzzle-5 phase-3 review
 * point 6). The caller (vex-app main process scheduled interval) is
 * responsible for dispatching the returned continuations in the background.
 *
 * Engine MUST NOT import vex-app IPC dispatch helpers (Codex puzzle-5
 * phase-3 review point 5). The sweep returns prepared continuations to
 * main and lets main dispatch via its own background helper.
 */

import * as approvalIntentsRepo from "../../../db/repos/approval-intents.js";
import logger from "@utils/logger.js";

import { SWEEP_BATCH_LIMIT, summarizeErrorForLog } from "./helpers.js";
import type { PreparedContinuation, SweepResult } from "./types.js";

// Late import via `expireApproval`: the entry function in
// `../approval-runtime.ts` ultimately re-exports it after composing
// snapshot+post-tx, and the sweep needs that fully-composed path.
async function getExpireApproval(): Promise<
  (approvalId: string) => Promise<import("./types.js").RejectPrepareOutcome>
> {
  const mod = await import("../approval-runtime.js");
  return mod.expireApproval;
}

export async function sweepExpiredApprovals(
  now: Date,
): Promise<SweepResult> {
  const expired = await approvalIntentsRepo.getExpired(
    now,
    SWEEP_BATCH_LIMIT,
  );
  let swept = 0;
  let errored = 0;
  const continuations: PreparedContinuation[] = [];

  const expireApproval = await getExpireApproval();

  for (const intent of expired) {
    try {
      const outcome = await expireApproval(intent.approvalId);
      if (outcome.kind === "rejected" && outcome.continuation !== null) {
        continuations.push(outcome.continuation);
      }
      swept++;
    } catch (cause) {
      errored++;
      const errSummary = summarizeErrorForLog(cause);
      logger.warn("engine.approval_runtime.sweep_expire_threw", {
        approvalId: intent.approvalId,
        sessionId: intent.sessionId,
        missionRunId: intent.missionRunId,
        errorKind: errSummary.errorKind,
        errorHash: errSummary.errorHash,
      });
    }
  }

  return { swept, errored, continuations };
}
