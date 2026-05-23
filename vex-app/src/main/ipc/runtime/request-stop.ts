/**
 * `vex.runtime.requestStop` — thin wrapper around the shared
 * `runStopDispatch` primitive used by both runtime + mission IPC
 * namespaces (puzzle 04 phase 6).
 *
 * Stop stays enqueue-only: the runner observes the request at the
 * iteration-boundary checkpoint and applies the terminal transition
 * (codex puzzle-03 review blocker #1 — IPC must not apply directly).
 */

import { CH } from "@shared/ipc/channels.js";
import {
  runtimeRequestInputSchema,
  runtimeRequestStopResultSchema,
} from "@shared/schemas/runtime.js";
import { registerHandler } from "../register-handler.js";
import { runStopDispatch } from "../_shared/runtime-stop-dispatch.js";

export function registerRuntimeRequestStopHandler(): () => void {
  return registerHandler({
    channel: CH.runtime.requestStop,
    domain: "runtime",
    inputSchema: runtimeRequestInputSchema,
    outputSchema: runtimeRequestStopResultSchema,
    handle: async (input, ctx) =>
      runStopDispatch(input, {
        requestId: ctx.requestId,
        channelLabel: "vex:runtime:requestStop",
      }),
  });
}
