/**
 * `claimRunForSelfHeal` — the OVERNIGHT-SELF-HEAL resume claim (OV2).
 *
 * Sibling of `claimRunForAutoRetry`. Same job — re-verify the ENTIRE safety
 * state under one row lock before flipping `paused_error → running`, defeating
 * the race where a human Recover mutates + stamps unsafe between `claimDue` and
 * the resume — but with two deliberate differences:
 *
 *   1. GATED ON `AGENT_SELF_HEAL_ENABLED` (default-on kill switch), NOT on the
 *      per-mission `autoRetryEnabled` opt-in. Self-heal is the always-on
 *      unattended safety net; opt-in only governed the fast Phase-4d retries.
 *   2. DEADLINE-BOUNDED. The claim recomputes the hard deadline from the locked
 *      row's immutable `started_at` + frozen box duration and refuses to resume
 *      a run whose box is spent (defense-in-depth beneath the watchdog's own
 *      pre-check — the deadline could tick past between scheduling and claiming).
 *
 * ALL predicates must hold (else `ineligible`, no flip):
 *   - self-heal enabled (env kill switch)
 *   - run exists and belongs to `sessionId`
 *   - status === "paused_error"
 *   - auto_retry_unsafe === false          (no half-done irreversible action)
 *   - stop_reason === "provider_error"
 *   - stop_evidence_json.classified === "transient"   (never a permanent error)
 *   - error_retry_count === expectedAttempt           (epoch guard)
 *   - live sessions.permission === "full"
 *   - within the mission hard deadline
 *   - within the mission hard COST cap (run-scoped spend < frozen dollar cap)
 *
 * One commit; no inter-statement race window.
 */

import {
  withTransaction,
  queryOneWith,
  executeWith,
} from "../../../db/client.js";
import { acquireLease } from "../../../db/repos/runner-leases.js";
import type { LeaseProcessKind, RunnerLease } from "../../../db/repos/runner-leases.js";
import { selfHealEnabled, evidenceIsTransient } from "../../self-heal/policy.js";
import { withinDeadline, withinCostCap } from "../../self-heal/bounds.js";
import { type RunnerLeaseRow, mapLease } from "./_row-shapes.js";

export interface ClaimSelfHealInput {
  readonly sessionId: string;
  readonly missionRunId: string;
  /** The attempt the wake was scheduled for; must equal error_retry_count. */
  readonly expectedAttempt: number;
  readonly ownerId: string;
  readonly processKind: LeaseProcessKind;
  readonly ttlMs: number;
  /** Injectable clock for deterministic deadline tests. */
  readonly nowMs?: number;
}

export type SelfHealIneligibleReason =
  | "disabled"
  | "run_missing"
  | "session_mismatch"
  | "status_changed"
  | "unsafe"
  | "stop_reason"
  | "not_transient"
  | "attempt_mismatch"
  | "not_full"
  | "past_deadline"
  | "past_cost_cap";

export type ClaimSelfHealOutcome =
  | { readonly outcome: "claimed"; readonly lease: RunnerLease }
  | { readonly outcome: "lease_busy"; readonly currentLease: RunnerLease }
  | { readonly outcome: "ineligible"; readonly reason: SelfHealIneligibleReason };

interface SelfHealClaimRow {
  readonly status: string;
  readonly session_id: string;
  readonly stop_reason: string | null;
  readonly stop_evidence_json: Record<string, unknown> | null;
  readonly error_retry_count: number;
  readonly auto_retry_unsafe: boolean;
  readonly contract_snapshot_json: Record<string, unknown> | null;
  readonly started_at: string | Date;
  readonly permission: string;
}

export async function claimRunForSelfHeal(
  input: ClaimSelfHealInput,
): Promise<ClaimSelfHealOutcome> {
  // Kill switch — checked first + outside the tx (env read is cheap, and a
  // disabled system must never even open a transaction).
  if (!selfHealEnabled()) return { outcome: "ineligible", reason: "disabled" };

  const nowMs = input.nowMs ?? Date.now();

  return withTransaction(async (client) => {
    // 1. Lock the run row + read its full safety state + live session permission.
    const row = await queryOneWith<SelfHealClaimRow>(
      client,
      `SELECT mr.status, mr.session_id, mr.stop_reason, mr.stop_evidence_json,
              mr.error_retry_count, mr.auto_retry_unsafe, mr.contract_snapshot_json,
              mr.started_at, s.permission
         FROM mission_runs mr
         JOIN sessions s ON s.id = mr.session_id
        WHERE mr.id = $1
        FOR UPDATE OF mr`,
      [input.missionRunId],
    );

    // 2. Re-verify EVERY safety predicate under the lock (fail-closed).
    if (row === null) return { outcome: "ineligible", reason: "run_missing" };
    if (row.session_id !== input.sessionId) {
      return { outcome: "ineligible", reason: "session_mismatch" };
    }
    if (row.status !== "paused_error") {
      return { outcome: "ineligible", reason: "status_changed" };
    }
    if (row.auto_retry_unsafe === true) {
      return { outcome: "ineligible", reason: "unsafe" };
    }
    if (row.stop_reason !== "provider_error") {
      return { outcome: "ineligible", reason: "stop_reason" };
    }
    if (!evidenceIsTransient(row.stop_evidence_json)) {
      return { outcome: "ineligible", reason: "not_transient" };
    }
    if (row.error_retry_count !== input.expectedAttempt) {
      return { outcome: "ineligible", reason: "attempt_mismatch" };
    }
    if (row.permission !== "full") {
      return { outcome: "ineligible", reason: "not_full" };
    }
    const startedAtIso =
      row.started_at instanceof Date ? row.started_at.toISOString() : row.started_at;
    const boundRun = {
      startedAt: startedAtIso,
      contractSnapshotJson: row.contract_snapshot_json,
    };
    // Deadline first (cheap, synchronous), then the COST cap (run-scoped spend
    // vs the frozen dollar cap — the same bound the turn-loop enforces). Distinct
    // reasons for telemetry. Defense-in-depth beneath the watchdog's own
    // pre-check: either bound could tick past between scheduling and claiming.
    if (!withinDeadline(boundRun, nowMs)) {
      return { outcome: "ineligible", reason: "past_deadline" };
    }
    if (!(await withinCostCap(boundRun, input.sessionId))) {
      return { outcome: "ineligible", reason: "past_cost_cap" };
    }

    // 3. Lock + validate the lease row (absent / expired / same-owner).
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
      existingLease !== null &&
      existingLease.expires_at >= new Date() &&
      existingLease.owner_id !== input.ownerId
    ) {
      return { outcome: "lease_busy", currentLease: mapLease(existingLease) };
    }

    // 4. Flip to running + acquire/refresh the lease in the same tx. No wake
    //    cleanup: the consumed self-heal wake is already gone, and a
    //    paused_error run never has a pending continuation wake to cancel.
    await executeWith(
      client,
      `UPDATE mission_runs
          SET status = 'running', last_checkpoint_at = NOW()
        WHERE id = $1`,
      [input.missionRunId],
    );
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
    if (lease === null) {
      throw new Error(
        "claimRunForSelfHeal: lease upsert returned null despite passing validation",
      );
    }
    return { outcome: "claimed", lease };
  });
}
