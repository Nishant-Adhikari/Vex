/**
 * `mission.continue` — delegates to the shared resume dispatcher.
 *
 * Semantic synonym of `runtime.requestResume`; both channels go
 * through `runResumeDispatch` so lease/audit/continuation logic
 * stays in one place (codex puzzle-04 phase-6 Q1).
 */

import { CH } from "@shared/ipc/channels.js";
import {
  missionContinueInputSchema,
  missionContinueResultSchema,
} from "@shared/schemas/mission.js";
import { registerHandler } from "../register-handler.js";
import { runResumeDispatch } from "../_shared/runtime-resume-dispatch.js";

export function registerMissionContinueHandler(): () => void {
  return registerHandler({
    channel: CH.mission.continue,
    domain: "mission",
    inputSchema: missionContinueInputSchema,
    outputSchema: missionContinueResultSchema,
    handle: async (input, ctx) =>
      runResumeDispatch(input, {
        requestId: ctx.requestId,
        channelLabel: "vex:mission:continue",
      }),
  });
}
