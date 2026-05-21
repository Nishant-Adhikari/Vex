/**
 * Runtime IPC handlers — `getState` is read-only; the four control
 * mutations (`requestPause`, `requestStop`, `requestResume`,
 * `cancelWake`) fail-close with `runtime.feature_unavailable` until
 * puzzle 03 lands the DB-backed control plane + runner leases.
 *
 * The fail-closed contract is intentional: a half-built in-memory
 * `AbortController` would not survive renderer/main restart and would
 * not coordinate with the wake executor. We refuse to ship a "looks
 * working" control surface that drops user pause requests under
 * crash/restart.
 */

import { CH } from "@shared/ipc/channels.js";
import { err, type Result } from "@shared/ipc/result.js";
import {
  runtimeRequestInputSchema,
  runtimeRequestResultSchema,
  runtimeStateDtoSchema,
  type RuntimeRequestResult,
  type RuntimeStateDto,
} from "@shared/schemas/runtime.js";
import { getActiveRunForSession } from "../database/mission-runs-db.js";
import { log } from "../logger/index.js";
import { featureUnavailable } from "./_feature-unavailable.js";
import { registerHandler } from "./register-handler.js";

const PAUSE_UNAVAILABLE_MSG =
  "Pause control lands in puzzle 03 (DB-backed control plane + leases).";
const STOP_UNAVAILABLE_MSG =
  "Stop control lands in puzzle 03 (DB-backed control plane + leases).";
const RESUME_UNAVAILABLE_MSG =
  "Resume control lands in puzzle 03 (DB-backed control plane + leases).";
const CANCEL_WAKE_UNAVAILABLE_MSG =
  "Wake cancellation lands in puzzle 03 (DB-backed control plane + leases).";

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

function registerControlHandler(
  channel: string,
  message: string,
): () => void {
  return registerHandler({
    channel,
    domain: "runtime",
    inputSchema: runtimeRequestInputSchema,
    outputSchema: runtimeRequestResultSchema,
    handle: async (_input, ctx): Promise<Result<RuntimeRequestResult>> => {
      log.info(
        `[ipc:${channel}] fail-closed feature_unavailable ` +
          `correlationId=${ctx.requestId}`,
      );
      return err(
        featureUnavailable({
          domain: "runtime",
          correlationId: ctx.requestId,
          message,
        }),
      );
    },
  });
}

export function registerRuntimeHandlers(): ReadonlyArray<() => void> {
  return [
    registerGetStateHandler(),
    registerControlHandler(CH.runtime.requestPause, PAUSE_UNAVAILABLE_MSG),
    registerControlHandler(CH.runtime.requestStop, STOP_UNAVAILABLE_MSG),
    registerControlHandler(CH.runtime.requestResume, RESUME_UNAVAILABLE_MSG),
    registerControlHandler(CH.runtime.cancelWake, CANCEL_WAKE_UNAVAILABLE_MSG),
  ];
}
