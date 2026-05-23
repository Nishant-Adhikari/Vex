/**
 * Shared stop-dispatch primitive used by both
 * `runtime.requestStop` and `mission.stop` IPC handlers.
 *
 * Returns the discriminated union compatible with both
 * `runtimeRequestStopResultSchema` and `missionStopResultSchema`.
 *
 * Stop is enqueue-only: the IPC handler writes a `stop_terminal` audit
 * row and the runner observes it at the iteration-boundary checkpoint
 * (codex puzzle-03 review blocker #1 — IPC must not apply directly).
 */

import { ok, err, type Result } from "@shared/ipc/result.js";
import type { MissionRunStatus } from "@shared/schemas/sessions.js";
import { getActiveRunForSession } from "../../database/mission-runs-db.js";
import { log } from "../../logger/index.js";
import { controlFailedError } from "../runtime/_errors.js";
import { ensureEngineDbUrl } from "../runtime/_ensure-engine-db-url.js";
import { emitControlStateAfterChange } from "../runtime/_emit-control-state.js";

export interface StopFlowInput {
  readonly sessionId: string;
}

export interface StopFlowContext {
  readonly requestId: string;
  readonly channelLabel: string;
}

export type StopFlowResult =
  | { readonly outcome: "queued"; readonly requestId: string }
  | {
    readonly outcome: "already_terminal";
    readonly status: MissionRunStatus;
  }
  | { readonly outcome: "no_active_run" };

export async function runStopDispatch(
  input: StopFlowInput,
  ctx: StopFlowContext,
): Promise<Result<StopFlowResult>> {
  const dbUrlOutcome = await ensureEngineDbUrl(ctx.requestId);
  if (!dbUrlOutcome.ok) return dbUrlOutcome;
  try {
    const state = await getActiveRunForSession(input.sessionId);
    if (!state.ok) return state;
    if (!state.data.hasActiveRun) {
      return ok({ outcome: "no_active_run" });
    }
    const status = state.data.status;
    if (
      status === "completed"
      || status === "failed"
      || status === "stopped"
      || status === "cancelled"
    ) {
      return ok({ outcome: "already_terminal", status });
    }
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
      `[ipc:${ctx.channelLabel}] failed correlationId=${ctx.requestId}`,
      cause,
    );
    return err(controlFailedError(ctx.requestId));
  }
}
