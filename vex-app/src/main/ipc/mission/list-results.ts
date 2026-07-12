/**
 * `mission.listResults` — read-only mission history for the results view.
 * Reads the `mission_results` ledger (written by the engine capture hooks),
 * newest first.
 */

import { CH } from "@shared/ipc/channels.js";
import { type Result } from "@shared/ipc/result.js";
import {
  missionListResultsInputSchema,
  missionListResultsResultSchema,
  type MissionListResultsResult,
} from "@shared/schemas/mission.js";
import { listMissionResults } from "../../database/mission-results-db.js";
import { log } from "../../logger/index.js";
import { registerHandler } from "../register-handler.js";

export function registerMissionListResultsHandler(): () => void {
  return registerHandler({
    channel: CH.mission.listResults,
    domain: "mission",
    inputSchema: missionListResultsInputSchema,
    outputSchema: missionListResultsResultSchema,
    handle: async (input, ctx): Promise<Result<MissionListResultsResult>> => {
      const outcome = await listMissionResults(input.limit ?? 50);
      if (outcome.ok) {
        log.info(
          `[ipc:vex:mission:listResults] ok count=${outcome.data.length} ` +
            `correlationId=${ctx.requestId}`,
        );
        return outcome;
      }
      log.info(
        `[ipc:vex:mission:listResults] errCode=${outcome.error.code} ` +
          `correlationId=${ctx.requestId}`,
      );
      return outcome;
    },
  });
}
