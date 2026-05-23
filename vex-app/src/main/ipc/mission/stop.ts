/**
 * `mission.stop` — delegates to the shared stop dispatcher.
 *
 * Semantic synonym of `runtime.requestStop`; both channels go through
 * `runStopDispatch` so the audit row + emit pattern stays in one
 * place (codex puzzle-04 phase-6 Q1).
 */

import { CH } from "@shared/ipc/channels.js";
import {
  missionStopInputSchema,
  missionStopResultSchema,
} from "@shared/schemas/mission.js";
import { registerHandler } from "../register-handler.js";
import { runStopDispatch } from "../_shared/runtime-stop-dispatch.js";

export function registerMissionStopHandler(): () => void {
  return registerHandler({
    channel: CH.mission.stop,
    domain: "mission",
    inputSchema: missionStopInputSchema,
    outputSchema: missionStopResultSchema,
    handle: async (input, ctx) =>
      runStopDispatch(input, {
        requestId: ctx.requestId,
        channelLabel: "vex:mission:stop",
      }),
  });
}
