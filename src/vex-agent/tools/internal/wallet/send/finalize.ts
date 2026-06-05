/**
 * Wallet send — outcome finalisation (audit writes + ToolResult shape).
 *
 * Translates an `ExecuteOutcome` into the operator-facing `ToolResult` while
 * persisting the audit-state transition. The tx (when broadcast) is already
 * real on-chain; audit-row drift is logged structurally but never changes the
 * `ToolResult` (Codex puzzle-5 phase-4 final review point 1). Raw RPC / wallet
 * cause text is always reduced to an `ErrorKind:hash` fingerprint — never
 * surfaced or logged verbatim.
 */

import * as walletIntentsRepo from "@vex-agent/db/repos/wallet-intents.js";
import logger from "@utils/logger.js";

import type { ToolResult } from "../../../types.js";

import { summarizeWalletError, type ExecuteOutcome } from "../send-types.js";
import { fail } from "./results.js";

export async function finalizeOutcome(
  intentId: string,
  sessionId: string,
  outcome: ExecuteOutcome,
): Promise<ToolResult> {
  switch (outcome.kind) {
    case "confirmed":
      return finalizeConfirmed(intentId, sessionId, outcome);
    case "chain_failed":
      await markFailedChecked(intentId, sessionId, outcome, outcome.txHash);
      return fail(
        `Wallet transfer reverted on-chain. Error hash: ${outcome.errorHash}. Tx hash: ${outcome.txHash}.`,
      );
    case "confirmation_unknown":
      await markFailedChecked(
        intentId,
        sessionId,
        { errorKind: "ConfirmationUnknown", errorHash: outcome.errorHash },
        outcome.txHash,
      );
      return fail(
        `Wallet transfer broadcast but confirmation unknown. Error hash: ${outcome.errorHash}. Tx hash: ${outcome.txHash}.`,
      );
    case "pre_broadcast_failed":
      await markFailedChecked(intentId, sessionId, outcome, null);
      return fail(
        `Wallet transfer failed before broadcast. Error hash: ${outcome.errorHash}.`,
      );
  }
}

/**
 * `markFailed` returns `null` on CAS miss (status was already
 * non-`consuming` when this write ran). That is an audit/status drift —
 * caller-side log it structurally so the operator notices. The original
 * outcome (failed transfer) still surfaces to the agent via the
 * `ToolResult` returned by `finalizeOutcome` — the audit log entry is
 * the only place the inconsistency is visible.
 *
 * Codex puzzle-5 phase-4 final review point 1.
 */
async function markFailedChecked(
  intentId: string,
  sessionId: string,
  cause: { errorKind: string; errorHash: string },
  txHash: string | null,
): Promise<void> {
  const row = await walletIntentsRepo.markFailed(
    intentId,
    sessionId,
    `${cause.errorKind}:${cause.errorHash}`,
    txHash,
  );
  if (row === null) {
    logger.warn("wallet.send.mark_failed_status_mismatch", {
      intentId,
      sessionId,
      txHash,
      errorKind: cause.errorKind,
      errorHash: cause.errorHash,
    });
  }
}

async function finalizeConfirmed(
  intentId: string,
  sessionId: string,
  outcome: Extract<ExecuteOutcome, { kind: "confirmed" }>,
): Promise<ToolResult> {
  let markedExecuted = false;
  let auditReason: string | null = null;
  try {
    const row = await walletIntentsRepo.markExecuted(
      intentId,
      sessionId,
      outcome.txHash,
    );
    if (row === null) {
      // CAS miss — status was not 'consuming' at write time. Possible
      // operator-side mutation or process-restart inconsistency. Tx is
      // still real on-chain; surface via structural audit log + flip the
      // row to `audit_failed` so phase 7 reconcile tooling sees it.
      logger.warn("wallet.send.mark_executed_status_mismatch", {
        intentId,
        sessionId,
        txHash: outcome.txHash,
      });
      auditReason = "StatusMismatch:no_consuming_row";
    } else {
      markedExecuted = true;
    }
  } catch (auditErr) {
    const sum = summarizeWalletError(auditErr);
    logger.warn("wallet.send.audit_write_failed", {
      intentId,
      sessionId,
      txHash: outcome.txHash,
      errorKind: sum.errorKind,
      errorHash: sum.errorHash,
    });
    // Preserve the underlying cause as the audit reason — the structural
    // ErrorKind:hash label matches the failure_reason format used on
    // pre/post-broadcast failure paths.
    auditReason = `${sum.errorKind}:${sum.errorHash}`;
  }

  if (!markedExecuted && auditReason !== null) {
    await tryMarkAuditFailed(
      intentId,
      sessionId,
      outcome.txHash,
      auditReason,
    );
  }

  return {
    success: true,
    output: JSON.stringify(outcome.data, null, 2),
    data: outcome.data,
  };
}

/**
 * Best-effort `markAuditFailed` for the `consuming` row when markExecuted
 * could not flip to `executed`. Returns silently — the tx is already
 * on-chain; the audit row drift is logged but does not change the
 * `ToolResult` (Codex puzzle-5 phase-4 final review point 1). The reason
 * threads through from the original markExecuted outcome (throw cause OR
 * `StatusMismatch:no_consuming_row` for the null CAS path).
 */
async function tryMarkAuditFailed(
  intentId: string,
  sessionId: string,
  txHash: string,
  reason: string,
): Promise<void> {
  try {
    const row = await walletIntentsRepo.markAuditFailed(
      intentId,
      sessionId,
      txHash,
      reason,
    );
    if (row === null) {
      // markAuditFailed also requires status='consuming'. If we missed
      // here too, the intent is in a status the audit lifecycle does not
      // cover (likely 'cancelled' or 'failed' from a concurrent path).
      logger.warn("wallet.send.mark_audit_failed_status_mismatch", {
        intentId,
        sessionId,
        txHash,
      });
    }
  } catch (cascadingErr) {
    const csum = summarizeWalletError(cascadingErr);
    logger.warn("wallet.send.audit_cascade_failed", {
      intentId,
      sessionId,
      txHash,
      errorKind: csum.errorKind,
      errorHash: csum.errorHash,
    });
  }
}
