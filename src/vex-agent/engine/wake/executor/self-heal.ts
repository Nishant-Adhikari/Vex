import type { LoopWakeRequest } from "@vex-agent/db/repos/loop-wake.js";
import type { MissionRun } from "@vex-agent/db/repos/mission-runs.js";
import logger from "@utils/logger.js";

import { selfHealEnabled } from "../../self-heal/policy.js";
import {
  applyModelFailover,
  restorePrimaryModel,
} from "../../self-heal/model-failover.js";
import type { WakeDeps } from "./deps.js";
import type { ClaimedWakeOutcome } from "./tick.js";

/**
 * Overnight self-heal resume (OV2). The wake was scheduled by the self-heal
 * watchdog for a `paused_error` run that failed on a TRANSIENT provider error
 * and is still within its deadline. `claimRunForSelfHeal` re-verifies the ENTIRE
 * safety state (kill switch, status, unsafe stamp, provider_error stop_reason,
 * durable transient classification, attempt epoch, live full-mode permission,
 * deadline) under a row lock before flipping to running — so a human Recover
 * that mutated + stamped unsafe between `claimDue` and here makes this skip.
 *
 * MODEL FAILOVER: the watchdog stamps `payload.failover` once the primary model
 * has failed enough consecutive times. We apply/restore the backup model HERE,
 * at the single serialized resume, so the global model state is never raced
 * between the watchdog and executor.
 */
export async function handleSelfHealClaimed(
  wake: LoopWakeRequest,
  run: MissionRun,
  deps: WakeDeps,
): Promise<ClaimedWakeOutcome> {
  // Kill switch — a consumed wake for a now-disabled system is simply dropped
  // without resuming (park-and-wait fallback).
  if (!selfHealEnabled()) {
    logger.info("wake.executor.self_heal_disabled", { wakeId: wake.id, runId: run.id });
    return { kind: "skipped_claim_lost" };
  }

  if (run.status !== "paused_error") {
    logger.info("wake.executor.self_heal_skip_stale", {
      wakeId: wake.id,
      runId: run.id,
      status: run.status,
    });
    return { kind: "skipped_stale_status", currentStatus: run.status };
  }

  const attempt =
    typeof wake.payload?.attempt === "number" ? wake.payload.attempt : -1;
  const wantFailover = wake.payload?.failover === true;

  // Apply/restore the backup model BEFORE the claim so the resume that follows
  // resolves the intended model. Idempotent + fail-soft (never throws).
  if (wantFailover) {
    applyModelFailover();
  } else {
    restorePrimaryModel();
  }

  const ownerId = `self-heal-${wake.id}`;
  const { claimRunForSelfHeal } = await import(
    "../../runtime/lease-and-status.js"
  );
  const claim = await claimRunForSelfHeal({
    sessionId: wake.sessionId,
    missionRunId: run.id,
    expectedAttempt: attempt,
    ownerId,
    processKind: "electron_main",
    ttlMs: 5 * 60_000,
  });
  if (claim.outcome === "lease_busy") {
    logger.info("wake.executor.self_heal_skip_lease_busy", {
      wakeId: wake.id,
      runId: run.id,
    });
    return { kind: "skipped_claim_lost" };
  }
  if (claim.outcome === "ineligible") {
    // A human Recover / terminal transition / deadline / opt-out won the race;
    // the consumed wake is dropped without resuming.
    logger.info("wake.executor.self_heal_ineligible", {
      wakeId: wake.id,
      runId: run.id,
      reason: claim.reason,
    });
    return { kind: "skipped_claim_lost" };
  }

  const { createLeaseHandle } = await import("../../runtime/lease-handle.js");
  const handle = createLeaseHandle({
    lease: claim.lease,
    ownerId,
    ttlMs: 5 * 60_000,
  });
  try {
    await deps.injectWakeBanner(wake.sessionId, wake.reason, wake.dueAt);
    await deps.resumeMissionRun(run.id);
    return { kind: "resumed", runId: run.id };
  } finally {
    const { releaseLeaseAndEmitControlState } = await import(
      "../../runtime/release-and-emit.js"
    );
    await releaseLeaseAndEmitControlState(handle, wake.sessionId, {
      missionRunId: run.id,
    });
  }
}
