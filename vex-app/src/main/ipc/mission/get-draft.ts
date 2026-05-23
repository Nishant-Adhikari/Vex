/**
 * `mission.getDraft` — read-only mapper read of the latest draft row.
 *
 * Moved out of the old monolith `mission.ts` (phase 6) so the
 * directory structure mirrors `runtime/` and stays under the 350-LOC
 * per-file budget.
 */

import { CH } from "@shared/ipc/channels.js";
import { type Result } from "@shared/ipc/result.js";
import {
  missionGetDraftInputSchema,
  missionGetDraftResultSchema,
  type MissionGetDraftResult,
} from "@shared/schemas/mission.js";
import { getDraftForSession } from "../../database/missions-db.js";
import { log } from "../../logger/index.js";
import { registerHandler } from "../register-handler.js";

export function registerMissionGetDraftHandler(): () => void {
  return registerHandler({
    channel: CH.mission.getDraft,
    domain: "mission",
    inputSchema: missionGetDraftInputSchema,
    outputSchema: missionGetDraftResultSchema,
    handle: async (input, ctx): Promise<Result<MissionGetDraftResult>> => {
      const outcome = await getDraftForSession(input.sessionId);
      if (outcome.ok) {
        log.info(
          `[ipc:vex:mission:getDraft] ok sessionId=${input.sessionId} ` +
            `present=${outcome.data !== null} ` +
            `correlationId=${ctx.requestId}`,
        );
        return outcome;
      }
      log.info(
        `[ipc:vex:mission:getDraft] errCode=${outcome.error.code} ` +
          `correlationId=${ctx.requestId}`,
      );
      return outcome;
    },
  });
}
