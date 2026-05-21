/**
 * Runtime IPC handlers — DB-backed control plane (puzzle 03).
 *
 * `getState` reads the active mission run row + lease summary + top
 * pending control kind in one round-trip (see
 * `mission-runs-db.ts getActiveRunForSession`).
 *
 * The four control mutations route through the atomic engine helpers
 * so the DB transition + lease change + pending-wake cancellation all
 * commit together. The `controlStateBus` emits AFTER each commit so
 * the renderer invalidates `runtimeKeys.state(sessionId)` exactly
 * once per atomic state transition.
 *
 * `requestResume` is the most involved: it claims the lease + flips
 * status atomically, then dispatches the continuation work
 * fire-and-forget via a lazy `engine` import. The IPC result reports
 * the synchronous outcome of the claim (`resumed` / `lease_busy` /
 * `blocked_*`); the actual continuation runs to completion in the
 * background with explicit `.then` / `.catch` / `.finally` so the
 * audit `runtime_control_request` row never hangs on `observed`.
 */

import { URL } from "node:url";
import { randomUUID } from "node:crypto";
import { CH } from "@shared/ipc/channels.js";
import { ok, err, type Result, type VexError } from "@shared/ipc/result.js";
import {
  runtimeRequestInputSchema,
  runtimeRequestPauseResultSchema,
  runtimeRequestStopResultSchema,
  runtimeRequestResumeResultSchema,
  runtimeCancelWakeResultSchema,
  runtimeStateDtoSchema,
  CONTROL_STATE_EVENT_TYPE,
  type RuntimeRequestPauseResult,
  type RuntimeRequestStopResult,
  type RuntimeRequestResumeResult,
  type RuntimeCancelWakeResult,
  type RuntimeStateDto,
} from "@shared/schemas/runtime.js";
import { closePool } from "@vex-agent/db/client.js";
import { controlStateBus } from "@vex-agent/engine/runtime/control-bus.js";
import { buildPoolConfig } from "../database/db-config.js";
import { getActiveRunForSession } from "../database/mission-runs-db.js";
import { log } from "../logger/index.js";
import { registerHandler } from "./register-handler.js";

const LEASE_TTL_MS = 5 * 60_000; // 5 minutes
const RESUME_OWNER_PREFIX = "ipc-resume-";

function makePostgresUrl(args: {
  readonly host: string;
  readonly port: number;
  readonly database: string;
  readonly user: string;
  readonly password: string;
}): string {
  const url = new URL(`postgresql://${args.host}:${args.port}/${args.database}`);
  url.username = args.user;
  url.password = args.password;
  return url.toString();
}

async function ensureEngineDbUrl(correlationId: string): Promise<Result<void, VexError>> {
  try {
    const cfg = await buildPoolConfig();
    if (cfg === null) return err(dbUnavailableError(correlationId));
    const nextUrl = makePostgresUrl(cfg);
    if (process.env.VEX_DB_URL === nextUrl) return ok(undefined);
    process.env.VEX_DB_URL = nextUrl;
    await closePool();
    return ok(undefined);
  } catch {
    return err(dbUnavailableError(correlationId));
  }
}

function dbUnavailableError(correlationId: string): VexError {
  return {
    code: "internal.unexpected",
    domain: "runtime",
    message: "Database unavailable. Verify services are running and retry.",
    retryable: true,
    userActionable: true,
    redacted: true,
    correlationId,
  };
}

function controlFailedError(correlationId: string): VexError {
  return {
    code: "internal.unexpected",
    domain: "runtime",
    message: "Unable to apply runtime control request.",
    retryable: true,
    userActionable: false,
    redacted: true,
    correlationId,
  };
}

async function emitControlStateAfterChange(
  sessionId: string,
  correlationId: string | null,
): Promise<void> {
  // Re-read state post-commit so the event payload reflects the
  // canonical row (status flip + wake cancel + lease + pending kind
  // all visible).
  const state = await getActiveRunForSession(sessionId);
  if (!state.ok) {
    log.warn(
      `[ipc:runtime] post-change state read failed code=${state.error.code}`,
    );
    return;
  }
  // Route the emit through `controlStateBus` so `control-bridge`
  // (already subscribed via `setupAgentBridges`) revalidates with
  // `controlStateEventSchema` before `broadcastToAllWindows`. This
  // keeps the pre-send Zod gate as the only path to renderers —
  // even main-side emitters cross the same validation seam.
  controlStateBus.emit({
    type: CONTROL_STATE_EVENT_TYPE,
    sessionId,
    missionRunId: state.data.missionRunId,
    runStatus: state.data.status,
    stopReason: state.data.stopReason,
    pendingControlKind: state.data.pendingControlKind,
    leaseActive: state.data.leaseActive,
    leaseExpiresAt: state.data.leaseExpiresAt,
    correlationId,
  });
}

// ── getState ────────────────────────────────────────────────────────

function registerGetStateHandler(): () => void {
  return registerHandler({
    channel: CH.runtime.getState,
    domain: "runtime",
    inputSchema: runtimeRequestInputSchema,
    outputSchema: runtimeStateDtoSchema,
    handle: async (input, ctx): Promise<Result<RuntimeStateDto>> => {
      const outcome = await getActiveRunForSession(input.sessionId);
      if (outcome.ok) {
        log.info(
          `[ipc:vex:runtime:getState] ok sessionId=${input.sessionId} ` +
            `hasActiveRun=${outcome.data.hasActiveRun} ` +
            `status=${outcome.data.status ?? "none"} ` +
            `leaseActive=${outcome.data.leaseActive} ` +
            `pendingControl=${outcome.data.pendingControlKind ?? "none"} ` +
            `correlationId=${ctx.requestId}`,
        );
        return outcome;
      }
      log.info(
        `[ipc:vex:runtime:getState] errCode=${outcome.error.code} ` +
          `correlationId=${ctx.requestId}`,
      );
      return outcome;
    },
  });
}

// ── requestPause ────────────────────────────────────────────────────

function registerRequestPauseHandler(): () => void {
  return registerHandler({
    channel: CH.runtime.requestPause,
    domain: "runtime",
    inputSchema: runtimeRequestInputSchema,
    outputSchema: runtimeRequestPauseResultSchema,
    handle: async (input, ctx): Promise<Result<RuntimeRequestPauseResult>> => {
      const dbUrlOutcome = await ensureEngineDbUrl(ctx.requestId);
      if (!dbUrlOutcome.ok) return dbUrlOutcome;
      try {
        const state = await getActiveRunForSession(input.sessionId);
        if (!state.ok) return state;
        if (!state.data.hasActiveRun) {
          return ok({ outcome: "no_active_run" });
        }
        const status = state.data.status;
        if (status === "completed" || status === "failed" || status === "stopped" || status === "cancelled") {
          return ok({ outcome: "terminal", status });
        }
        if (status === "paused_user" || status === "paused_approval" || status === "paused_wake" || status === "paused_error") {
          // Already paused — return state without enqueueing a new
          // duplicate audit row. The active control plane (whoever
          // resumes next) will be the one to honor a fresh request.
          return ok({ outcome: "already_paused", status });
        }
        // Running — enqueue the request and return. The runner
        // observes pending pause requests at its iteration-boundary
        // checkpoint in `turn-loop.ts` and applies the transition
        // there. IPC MUST NOT apply the transition directly: clearing
        // the request before the runner sees it would let the active
        // turn-loop continue and overwrite the status (codex review
        // blocker #1).
        const { enqueueRequest, getPendingForSession } = await import(
          "@vex-agent/db/repos/runtime-control-requests.js"
        );
        const pending = await getPendingForSession(input.sessionId);
        const existingPause = pending.find((p) => p.kind === "pause_after_step");
        if (existingPause) {
          return ok({ outcome: "already_pending", requestId: existingPause.id });
        }
        const request = await enqueueRequest({
          sessionId: input.sessionId,
          missionRunId: state.data.missionRunId,
          kind: "pause_after_step",
          requestedBy: "user",
          correlationId: ctx.requestId,
        });
        await emitControlStateAfterChange(input.sessionId, ctx.requestId);
        return ok({ outcome: "queued", requestId: request.id });
      } catch (cause) {
        log.warn(
          `[ipc:vex:runtime:requestPause] failed correlationId=${ctx.requestId}`,
          cause,
        );
        return err(controlFailedError(ctx.requestId));
      }
    },
  });
}

// ── requestStop ─────────────────────────────────────────────────────

function registerRequestStopHandler(): () => void {
  return registerHandler({
    channel: CH.runtime.requestStop,
    domain: "runtime",
    inputSchema: runtimeRequestInputSchema,
    outputSchema: runtimeRequestStopResultSchema,
    handle: async (input, ctx): Promise<Result<RuntimeRequestStopResult>> => {
      const dbUrlOutcome = await ensureEngineDbUrl(ctx.requestId);
      if (!dbUrlOutcome.ok) return dbUrlOutcome;
      try {
        const state = await getActiveRunForSession(input.sessionId);
        if (!state.ok) return state;
        if (!state.data.hasActiveRun) {
          return ok({ outcome: "no_active_run" });
        }
        const status = state.data.status;
        if (status === "completed" || status === "failed" || status === "stopped" || status === "cancelled") {
          return ok({ outcome: "already_terminal", status });
        }
        // Enqueue only — the active runner's iteration-boundary
        // checkpoint observes pending `stop_terminal` requests and
        // applies the transition. See codex review blocker #1.
        const { enqueueRequest } = await import(
          "@vex-agent/db/repos/runtime-control-requests.js"
        );
        const request = await enqueueRequest({
          sessionId: input.sessionId,
          missionRunId: state.data.missionRunId,
          kind: "stop_terminal",
          requestedBy: "user",
          correlationId: ctx.requestId,
        });
        await emitControlStateAfterChange(input.sessionId, ctx.requestId);
        return ok({ outcome: "queued", requestId: request.id });
      } catch (cause) {
        log.warn(
          `[ipc:vex:runtime:requestStop] failed correlationId=${ctx.requestId}`,
          cause,
        );
        return err(controlFailedError(ctx.requestId));
      }
    },
  });
}

// ── requestResume ───────────────────────────────────────────────────

function registerRequestResumeHandler(): () => void {
  return registerHandler({
    channel: CH.runtime.requestResume,
    domain: "runtime",
    inputSchema: runtimeRequestInputSchema,
    outputSchema: runtimeRequestResumeResultSchema,
    handle: async (input, ctx): Promise<Result<RuntimeRequestResumeResult>> => {
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
            pendingApprovalId: runId, // placeholder; precise id comes in puzzle 05
          });
        }
        if (status === "paused_error") {
          return ok({
            outcome: "blocked_error",
            reason: state.data.stopReason ?? "paused_error",
          });
        }
        if (
          status === "completed" ||
          status === "failed" ||
          status === "stopped" ||
          status === "cancelled"
        ) {
          return ok({ outcome: "blocked_error", reason: status });
        }
        // status is `paused_user` or `paused_wake` — claim lease + atomic flip.
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
          return ok({
            outcome: "blocked_error",
            reason: "status_changed",
          });
        }

        // Lease claimed + status flipped to running. Mark request
        // observed + dispatch continuation fire-and-forget. The
        // explicit completion wrapper (.then/.catch/.finally) ensures
        // the audit row + lease both reach a terminal state even on
        // continuation throw or process crash within main.
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
        // Fire-and-forget — IPC returns immediately with `resumed`.
        void (async () => {
          try {
            const { resumeMissionRun } = await import(
              "@vex-agent/engine/index.js"
            );
            await resumeMissionRun(runId);
            await markCleared(auditRequest.id, "resumed");
          } catch (err) {
            log.warn(
              `[runtime:requestResume] continuation failed runId=${runId}`,
              err,
            );
            try {
              await markFailed(auditRequest.id, "continuation_failed");
            } catch {
              // intentionally swallowed — audit row best-effort
            }
            try {
              const { getBugReportSink } = await import(
                "@vex-agent/engine/support/bug-report-registry.js"
              );
              const { emitBugReportSafe } = await import(
                "../../../../../src/lib/diagnostics/bug-report-sink.js"
              );
              await emitBugReportSafe(
                getBugReportSink(),
                {
                  source: "agent",
                  category: "mission_system_error",
                  severity: "error",
                  title: "runtime.requestResume.continuation_failed",
                  description:
                    err instanceof Error ? err.message : String(err),
                  refs: {
                    sessionId: input.sessionId,
                    missionRunId: runId,
                    correlationId: ctx.requestId,
                  },
                  agentContext: {
                    runtimeStatus: "running",
                  },
                },
                log,
              );
            } catch {
              // bug sink itself unreachable — log already covered above
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
              // intentionally swallowed
            }
          }
        })();

        await emitControlStateAfterChange(input.sessionId, ctx.requestId);
        return ok({ outcome: "resumed", runId });
      } catch (cause) {
        log.warn(
          `[ipc:vex:runtime:requestResume] failed correlationId=${ctx.requestId}`,
          cause,
        );
        return err(controlFailedError(ctx.requestId));
      }
    },
  });
}

// ── cancelWake ──────────────────────────────────────────────────────

function registerCancelWakeHandler(): () => void {
  return registerHandler({
    channel: CH.runtime.cancelWake,
    domain: "runtime",
    inputSchema: runtimeRequestInputSchema,
    outputSchema: runtimeCancelWakeResultSchema,
    handle: async (input, ctx): Promise<Result<RuntimeCancelWakeResult>> => {
      const dbUrlOutcome = await ensureEngineDbUrl(ctx.requestId);
      if (!dbUrlOutcome.ok) return dbUrlOutcome;
      try {
        const { cancelForSession } = await import(
          "@vex-agent/db/repos/loop-wake.js"
        );
        const cancelledCount = await cancelForSession(
          input.sessionId,
          "user_cancel",
        );
        // Audit row.
        const { enqueueRequest } = await import(
          "@vex-agent/db/repos/runtime-control-requests.js"
        );
        await enqueueRequest({
          sessionId: input.sessionId,
          kind: "cancel_wake",
          requestedBy: "user",
          correlationId: ctx.requestId,
          reason: `cancelled=${cancelledCount}`,
        });
        await emitControlStateAfterChange(input.sessionId, ctx.requestId);
        if (cancelledCount === 0) {
          return ok({ outcome: "no_pending_wake" });
        }
        return ok({ outcome: "cancelled_wake", cancelledCount });
      } catch (cause) {
        log.warn(
          `[ipc:vex:runtime:cancelWake] failed correlationId=${ctx.requestId}`,
          cause,
        );
        return err(controlFailedError(ctx.requestId));
      }
    },
  });
}

export function registerRuntimeHandlers(): ReadonlyArray<() => void> {
  return [
    registerGetStateHandler(),
    registerRequestPauseHandler(),
    registerRequestStopHandler(),
    registerRequestResumeHandler(),
    registerCancelWakeHandler(),
  ];
}
