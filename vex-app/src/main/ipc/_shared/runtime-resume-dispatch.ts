/**
 * Shared resume-dispatch primitive used by both
 * `runtime.requestResume` and `mission.continue` IPC handlers.
 *
 * Per puzzle 04 phase 6 codex review: "mission.continue and
 * mission.stop are semantic synonyms for runtime.requestResume /
 * requestStop; share via _shared dispatcher (no nested IPC, no
 * duplicated lease/audit logic)."
 *
 * The dispatcher returns a discriminated union compatible with both
 * `runtimeRequestResumeResultSchema` and `missionContinueResultSchema`
 * (the two are deliberately identical).
 */

import { randomUUID } from "node:crypto";
import { ok, err, type Result } from "@shared/ipc/result.js";
import { getActiveRunForSession } from "../../database/mission-runs-db.js";
import { log } from "../../logger/index.js";
import { controlFailedError } from "../runtime/_errors.js";
import { ensureEngineDbUrl } from "../runtime/_ensure-engine-db-url.js";
import { emitControlStateAfterChange } from "../runtime/_emit-control-state.js";

export interface ResumeFlowInput {
  readonly sessionId: string;
}

export interface ResumeFlowContext {
  readonly requestId: string;
  /** Label used for structured logs (channel name without colon prefix). */
  readonly channelLabel: string;
}

export type ResumeFlowResult =
  | { readonly outcome: "resumed"; readonly runId: string }
  | { readonly outcome: "already_running"; readonly runId: string }
  | { readonly outcome: "no_active_run" }
  | {
    readonly outcome: "blocked_approval";
    readonly pendingApprovalId: string;
  }
  | { readonly outcome: "blocked_error"; readonly reason: string }
  | {
    readonly outcome: "lease_busy";
    readonly retryAfterMs?: number;
  };

const LEASE_TTL_MS = 5 * 60_000;
const RESUME_OWNER_PREFIX = "ipc-resume-";

export async function runResumeDispatch(
  input: ResumeFlowInput,
  ctx: ResumeFlowContext,
): Promise<Result<ResumeFlowResult>> {
  const dbUrlOutcome = await ensureEngineDbUrl(ctx.requestId);
  if (!dbUrlOutcome.ok) return dbUrlOutcome;
  try {
    const state = await getActiveRunForSession(input.sessionId);
    if (!state.ok) return state;
    if (!state.data.hasActiveRun || state.data.missionRunId === null) {
      return ok({ outcome: "no_active_run" });
    }
    const status = state.data.status;
    const runId = state.data.missionRunId;
    if (status === "running") {
      return ok({ outcome: "already_running", runId });
    }
    if (status === "paused_approval") {
      return ok({
        outcome: "blocked_approval",
        pendingApprovalId: runId,
      });
    }
    if (status === "paused_error") {
      return ok({
        outcome: "blocked_error",
        reason: state.data.stopReason ?? "paused_error",
      });
    }
    if (
      status === "completed"
      || status === "failed"
      || status === "stopped"
      || status === "cancelled"
    ) {
      return ok({ outcome: "blocked_error", reason: status });
    }
    // paused_user or paused_wake — claim + flip + dispatch.
    const { enqueueRequest, markObserved, markCleared, markFailed } =
      await import("@vex-agent/db/repos/runtime-control-requests.js");
    const auditRequest = await enqueueRequest({
      sessionId: input.sessionId,
      missionRunId: runId,
      kind: "resume",
      requestedBy: "user",
      correlationId: ctx.requestId,
    });
    const { claimRunLeaseAndFlipToRunning } = await import(
      "@vex-agent/engine/runtime/lease-and-status.js"
    );
    const claim = await claimRunLeaseAndFlipToRunning({
      sessionId: input.sessionId,
      missionRunId: runId,
      fromStatuses: [status],
      ownerId: `${RESUME_OWNER_PREFIX}${randomUUID()}`,
      processKind: "electron_main",
      ttlMs: LEASE_TTL_MS,
    });
    if (claim.outcome === "lease_busy") {
      await markFailed(auditRequest.id, "lease_busy");
      const retryAfterMs = Math.max(
        0,
        claim.currentLease.expiresAt.getTime() - Date.now(),
      );
      await emitControlStateAfterChange(input.sessionId, ctx.requestId);
      return ok({ outcome: "lease_busy", retryAfterMs });
    }
    if (claim.outcome === "status_mismatch") {
      await markFailed(auditRequest.id, "status_changed");
      return ok({ outcome: "blocked_error", reason: "status_changed" });
    }
    await markObserved(auditRequest.id);
    const ownerId = claim.lease.ownerId;
    const { createLeaseHandle } = await import(
      "@vex-agent/engine/runtime/lease-handle.js"
    );
    const handle = createLeaseHandle({
      lease: claim.lease,
      ownerId,
      ttlMs: LEASE_TTL_MS,
    });
    // Fire-and-forget. Bug-report sink + audit lifecycle on continuation.
    void (async () => {
      try {
        const { resumeMissionRun } = await import(
          "@vex-agent/engine/index.js"
        );
        await resumeMissionRun(runId);
        await markCleared(auditRequest.id, "resumed");
      } catch (cause) {
        log.warn(
          `[ipc:${ctx.channelLabel}] continuation failed runId=${runId}`,
          cause,
        );
        try {
          await markFailed(auditRequest.id, "continuation_failed");
        } catch {
          // best-effort audit
        }
        try {
          const { getBugReportSink } = await import(
            "@vex-agent/engine/support/bug-report-registry.js"
          );
          const { emitBugReportSafe } = await import(
            "@vex-lib/diagnostics/bug-report-sink.js"
          );
          await emitBugReportSafe(
            getBugReportSink(),
            {
              source: "agent",
              category: "mission_system_error",
              severity: "error",
              title: `${ctx.channelLabel}.continuation_failed`,
              description:
                cause instanceof Error ? cause.message : String(cause),
              refs: {
                sessionId: input.sessionId,
                missionRunId: runId,
                correlationId: ctx.requestId,
              },
              agentContext: { runtimeStatus: "running" },
            },
            log,
          );
        } catch {
          // sink unreachable
        }
      } finally {
        try {
          const { releaseLeaseAndEmitControlState } = await import(
            "@vex-agent/engine/runtime/release-and-emit.js"
          );
          await releaseLeaseAndEmitControlState(handle, input.sessionId, {
            missionRunId: runId,
            correlationId: ctx.requestId,
          });
        } catch {
          // best-effort
        }
      }
    })();
    await emitControlStateAfterChange(input.sessionId, ctx.requestId);
    return ok({ outcome: "resumed", runId });
  } catch (cause) {
    log.warn(
      `[ipc:${ctx.channelLabel}] failed correlationId=${ctx.requestId}`,
      cause,
    );
    return err(controlFailedError(ctx.requestId));
  }
}
