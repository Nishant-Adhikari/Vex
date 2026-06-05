/**
 * Approval runtime — locked-tx snapshot phase: ordering owners.
 *
 * The tx locks the `approval_intents`, `approval_queue`, AND `sessions` rows
 * (`FOR UPDATE OF i, q, s`) and decides which path the post-tx side-effects
 * will run. Locking `sessions s` serializes the LIVE permission read
 * (`s.permission`) against a concurrent permission-downgrade tx, so the
 * approve-time re-enforcement (B-001) compares the enqueue snapshot against a
 * permission value that cannot change underneath this approve until it commits.
 * The TTL gate uses DB-side `NOW()` so an approve that races the TTL boundary
 * observes a single committed truth.
 *
 * Codex puzzle-5 phase-3 review point 4 — atomic TTL gate inside the same
 * locked tx as the queue CAS.
 *
 * Returns a private discriminated-union snapshot; the public entry points
 * in `../../approval-runtime.ts` map this to the IPC contract. This module is
 * the ORDERING OWNER — every queue/intent CAS write happens here, in order.
 */

import type { PoolClient } from "pg";

import * as approvalsRepo from "../../../../db/repos/approvals.js";
import * as approvalIntentsRepo from "../../../../db/repos/approval-intents.js";
import * as missionRunsRepo from "../../../../db/repos/mission-runs.js";
import { TERMINAL_RUN_STATUSES } from "../../../types.js";
import { ApprovalDecisionInconsistencyError } from "../types.js";
import {
  isPermissionMoreRestrictive,
  TOOL_RESULT_EXPIRED_REASON,
  TOOL_RESULT_POLICY_DRIFT_REASON,
  toIso,
  toIsoNow,
} from "../helpers.js";
import { getDbNow, lockAndLoadSnapshot } from "./compare.js";
import type {
  ApproveSnapshot,
  IntentSnapshotRow,
  RejectSnapshot,
} from "./types.js";

export async function buildApproveSnapshot(
  client: PoolClient,
  approvalId: string,
): Promise<ApproveSnapshot> {
  const row = await lockAndLoadSnapshot(client, approvalId);
  if (row === null) return { type: "not_found" };

  // Cached decision — return early. Drift sanity-check: queue.status='pending'
  // alongside a non-null intent.decision is an inconsistency by construction.
  if (row.decision !== null) {
    if (row.queue_status === "pending") {
      throw new ApprovalDecisionInconsistencyError(
        approvalId,
        `decision=${row.decision} but queue.status=pending`,
      );
    }
    if (row.decision === "approved") return { type: "cached_approved", row };
    return { type: "already_rejected", row };
  }

  if (row.queue_status !== "pending") {
    throw new ApprovalDecisionInconsistencyError(
      approvalId,
      `queue.status=${row.queue_status} but decision=null`,
    );
  }

  // Atomic TTL check using DB-side NOW(). The intent row is locked, so a
  // concurrent expire/sweep is blocked until our tx commits — no race.
  if (row.expires_at !== null) {
    const expiresAt = row.expires_at instanceof Date
      ? row.expires_at
      : new Date(row.expires_at);
    const dbNow = await getDbNow(client);
    if (expiresAt <= dbNow) {
      return autoRejectInTx(client, row, approvalId, expiresAt);
    }
  }

  // Defensive: mission run terminal AFTER this approval was created
  // (operator-driven `abortMissionRun` raced between enqueue and approve).
  if (row.mission_run_id !== null) {
    const recentRun = await missionRunsRepo.getRunBySession(
      row.session_id,
      client,
    );
    const queueCreatedAt =
      row.queue_created_at instanceof Date
        ? row.queue_created_at.toISOString()
        : row.queue_created_at;
    if (
      recentRun !== null
      && TERMINAL_RUN_STATUSES.has(recentRun.status)
      && recentRun.endedAt !== null
      && recentRun.endedAt > queueCreatedAt
    ) {
      return { type: "run_terminated", row, runStatus: recentRun.status };
    }
  }

  // B-001 — re-enforce the live permission policy at approve time. The
  // permission captured at enqueue (`queue_permission_at_enqueue`) is a
  // snapshot; if the LIVE `sessions.permission` (read above under the same
  // lock) drifted strictly MORE restrictive, an action authorized under the
  // looser policy must NOT dispatch. Fail closed BEFORE the approve CAS:
  // flip queue+intent to `rejected` in-tx so the post-tx side effects take
  // the reject path (no approved decision, no dispatch, no approved
  // tool-result). Unchanged or looser live permission falls through to the
  // byte-identical happy path below.
  if (
    isPermissionMoreRestrictive(
      row.session_permission_live,
      row.queue_permission_at_enqueue,
    )
  ) {
    return policyDriftRejectInTx(client, row, approvalId);
  }

  // Happy path — CAS queue.approve + CAS intent.decision='approved' in tx.
  const queueRow = await approvalsRepo.approveWith(client, approvalId);
  if (queueRow === null) {
    throw new ApprovalDecisionInconsistencyError(
      approvalId,
      "approve queue CAS missed despite FOR UPDATE",
    );
  }
  const ok = await approvalIntentsRepo.markDecisionWith(client, {
    approvalId,
    kind: "approved",
    idempotencyKey: approvalId,
  });
  if (!ok) {
    throw new ApprovalDecisionInconsistencyError(
      approvalId,
      "approve intent CAS missed despite decision=null",
    );
  }
  return {
    type: "approved_in_tx",
    row,
    queueResolvedAt: toIso(queueRow.resolvedAt ?? toIsoNow()),
  };
}

async function autoRejectInTx(
  client: PoolClient,
  row: IntentSnapshotRow,
  approvalId: string,
  expiresAt: Date,
): Promise<ApproveSnapshot> {
  const queueRow = await approvalsRepo.rejectWith(client, approvalId);
  if (queueRow === null) {
    throw new ApprovalDecisionInconsistencyError(
      approvalId,
      "expired-in-tx queue CAS missed despite FOR UPDATE",
    );
  }
  const ok = await approvalIntentsRepo.markDecisionWith(client, {
    approvalId,
    kind: "rejected",
    reason: TOOL_RESULT_EXPIRED_REASON,
    idempotencyKey: approvalId,
  });
  if (!ok) {
    throw new ApprovalDecisionInconsistencyError(
      approvalId,
      "expired-in-tx intent CAS missed despite decision=null",
    );
  }
  return {
    type: "expired_in_tx",
    row,
    expiredAt: expiresAt.toISOString(),
    queueResolvedAt: toIso(queueRow.resolvedAt ?? toIsoNow()),
  };
}

/**
 * B-001 — flip queue+intent to `rejected` in the SAME locked tx that read the
 * drifted permission, then return the `policy_drift_blocked` snapshot. Mirrors
 * `autoRejectInTx` (expired path) — the row is locked `FOR UPDATE`, so the
 * `decision IS NULL` / `status='pending'` CAS predicates hold and a missed CAS
 * is a real inconsistency. No approved decision is ever written; the post-tx
 * side effects render a rejection tool-result, never an approved dispatch.
 */
async function policyDriftRejectInTx(
  client: PoolClient,
  row: IntentSnapshotRow,
  approvalId: string,
): Promise<ApproveSnapshot> {
  const queueRow = await approvalsRepo.rejectWith(client, approvalId);
  if (queueRow === null) {
    throw new ApprovalDecisionInconsistencyError(
      approvalId,
      "policy-drift queue CAS missed despite FOR UPDATE",
    );
  }
  const ok = await approvalIntentsRepo.markDecisionWith(client, {
    approvalId,
    kind: "rejected",
    reason: TOOL_RESULT_POLICY_DRIFT_REASON,
    idempotencyKey: approvalId,
  });
  if (!ok) {
    throw new ApprovalDecisionInconsistencyError(
      approvalId,
      "policy-drift intent CAS missed despite decision=null",
    );
  }
  return {
    type: "policy_drift_blocked",
    row,
    queueResolvedAt: toIso(queueRow.resolvedAt ?? toIsoNow()),
    reason: TOOL_RESULT_POLICY_DRIFT_REASON,
    permissionAtEnqueue: row.queue_permission_at_enqueue,
    livePermission: row.session_permission_live,
  };
}

export async function buildRejectSnapshot(
  client: PoolClient,
  approvalId: string,
  reason: string,
): Promise<RejectSnapshot> {
  const row = await lockAndLoadSnapshot(client, approvalId);
  if (row === null) return { type: "not_found" };

  if (row.decision !== null) {
    if (row.queue_status === "pending") {
      throw new ApprovalDecisionInconsistencyError(
        approvalId,
        `decision=${row.decision} but queue.status=pending`,
      );
    }
    if (row.decision === "approved") {
      return { type: "already_approved", row };
    }
    return { type: "cached_rejected", row };
  }

  if (row.queue_status !== "pending") {
    throw new ApprovalDecisionInconsistencyError(
      approvalId,
      `queue.status=${row.queue_status} but decision=null`,
    );
  }

  const queueRow = await approvalsRepo.rejectWith(client, approvalId);
  if (queueRow === null) {
    throw new ApprovalDecisionInconsistencyError(
      approvalId,
      "reject queue CAS missed despite FOR UPDATE",
    );
  }
  const ok = await approvalIntentsRepo.markDecisionWith(client, {
    approvalId,
    kind: "rejected",
    reason,
    idempotencyKey: approvalId,
  });
  if (!ok) {
    throw new ApprovalDecisionInconsistencyError(
      approvalId,
      "reject intent CAS missed despite decision=null",
    );
  }
  return {
    type: "rejected_in_tx",
    row,
    queueResolvedAt: toIso(queueRow.resolvedAt ?? toIsoNow()),
    reason,
  };
}
