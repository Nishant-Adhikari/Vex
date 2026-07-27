/**
 * `mission.getSessionResult` — read-only latest finalized result for a session
 * (the post-mission summary card, keyed on the session the renderer has in
 * hand). Reads the `mission_results` ledger (written by the engine's capture
 * hooks); returns null if the session never opened a mission result.
 */

import { CH } from "@shared/ipc/channels.js";
import { ok, err, type Result } from "@shared/ipc/result.js";
import {
  missionGetSessionResultInputSchema,
  missionGetSessionResultResultSchema,
  type MissionGetSessionResultResult,
} from "@shared/schemas/mission.js";
import { log } from "../../logger/index.js";
import { registerHandler } from "../register-handler.js";
import { controlFailedError } from "../runtime/_errors.js";
import { ensureEngineDbUrl } from "../runtime/_ensure-engine-db-url.js";
import { toMissionResultDto } from "./_result-dto.js";
import { repairSimulatedResultRow } from "./_simulator-result-repair.js";

export function registerMissionGetSessionResultHandler(): () => void {
  return registerHandler({
    channel: CH.mission.getSessionResult,
    domain: "mission",
    inputSchema: missionGetSessionResultInputSchema,
    outputSchema: missionGetSessionResultResultSchema,
    handle: async (input, ctx): Promise<Result<MissionGetSessionResultResult>> => {
      const dbUrlOutcome = await ensureEngineDbUrl(ctx.requestId);
      if (!dbUrlOutcome.ok) return dbUrlOutcome;
      try {
        const { getSessionResult } = await import(
          "@vex-agent/db/repos/mission-results.js"
        );
        const row = await getSessionResult(input.sessionId);
        const repairedRow =
          row === null ? null : await repairSimulatedResultRow(row);
        log.info(
          `[ipc:vex:mission:getSessionResult] ok found=${row !== null} correlationId=${ctx.requestId}`,
        );
        return ok(repairedRow === null ? null : toMissionResultDto(repairedRow));
      } catch (cause) {
        log.warn(
          `[ipc:vex:mission:getSessionResult] failed correlationId=${ctx.requestId}`,
          cause,
        );
        return err(controlFailedError(ctx.requestId));
      }
    },
  });
}
