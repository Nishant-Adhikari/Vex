/**
 * `vex.runtime.requestResume` — thin wrapper around the shared
 * `runResumeDispatch` primitive used by both runtime + mission IPC
 * namespaces (puzzle 04 phase 6).
 */

import { CH } from "@shared/ipc/channels.js";
import {
  runtimeRequestInputSchema,
  runtimeRequestResumeResultSchema,
} from "@shared/schemas/runtime.js";
import { registerHandler } from "../register-handler.js";
import { runResumeDispatch } from "../_shared/runtime-resume-dispatch.js";

export function registerRuntimeRequestResumeHandler(): () => void {
  return registerHandler({
    channel: CH.runtime.requestResume,
    domain: "runtime",
    inputSchema: runtimeRequestInputSchema,
    outputSchema: runtimeRequestResumeResultSchema,
    handle: async (input, ctx) =>
      runResumeDispatch(input, {
        requestId: ctx.requestId,
        channelLabel: "vex:runtime:requestResume",
      }),
  });
}
