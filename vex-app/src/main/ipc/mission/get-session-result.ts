/**
 * `mission.getSessionResult` — read-only latest finalized result for a session.
 * Reads the `mission_results` ledger (written by the engine capture hooks),
 * returning the newest row for the session or null.
 */

import { CH } from "@shared/ipc/channels.js";
import { type Result } from "@shared/ipc/result.js";
import {
  missionGetSessionResultInputSchema,
  missionGetSessionResultResultSchema,
  type MissionGetSessionResultResult,
} from "@shared/schemas/mission.js";
import { getSessionResult } from "../../database/mission-results-db.js";
import { log } from "../../logger/index.js";
import { registerHandler } from "../register-handler.js";

export function registerMissionGetSessionResultHandler(): () => void {
  return registerHandler({
    channel: CH.mission.getSessionResult,
    domain: "mission",
    inputSchema: missionGetSessionResultInputSchema,
    outputSchema: missionGetSessionResultResultSchema,
    handle: async (input, ctx): Promise<Result<MissionGetSessionResultResult>> => {
      const outcome = await getSessionResult(input.sessionId);
      if (outcome.ok) {
        log.info(
          `[ipc:vex:mission:getSessionResult] ok found=${outcome.data !== null} ` +
            `correlationId=${ctx.requestId}`,
        );
        return outcome;
      }
      log.info(
        `[ipc:vex:mission:getSessionResult] errCode=${outcome.error.code} ` +
          `correlationId=${ctx.requestId}`,
      );
      return outcome;
    },
  });
}
