/**
 * `mission.listPaperResults` — read-only, paper-only mission history for the
 * simulator surfaces. Reads ONLY simulated rows from `mission_results`, newest
 * first, and is intentionally independent of any live wallet address.
 */

import { CH } from "@shared/ipc/channels.js";
import { ok, err, type Result } from "@shared/ipc/result.js";
import {
  missionListPaperResultsInputSchema,
  missionListPaperResultsResultSchema,
  DEFAULT_MISSION_RESULTS_LIMIT,
  type MissionListPaperResultsResult,
} from "@shared/schemas/mission.js";
import { log } from "../../logger/index.js";
import { registerHandler } from "../register-handler.js";
import { controlFailedError } from "../runtime/_errors.js";
import { ensureEngineDbUrl } from "../runtime/_ensure-engine-db-url.js";
import { toMissionResultDto } from "./_result-dto.js";
import { repairSimulatedResultRow } from "./_simulator-result-repair.js";

export function registerMissionListPaperResultsHandler(): () => void {
  return registerHandler({
    channel: CH.mission.listPaperResults,
    domain: "mission",
    inputSchema: missionListPaperResultsInputSchema,
    outputSchema: missionListPaperResultsResultSchema,
    handle: async (input, ctx): Promise<Result<MissionListPaperResultsResult>> => {
      const dbUrlOutcome = await ensureEngineDbUrl(ctx.requestId);
      if (!dbUrlOutcome.ok) return dbUrlOutcome;
      try {
        const [{ listSimulatedResults }, { listBatchIdsForMissionRuns }] =
          await Promise.all([
            import("@vex-agent/db/repos/mission-results.js"),
            import("@vex-agent/db/repos/simulator-batches.js"),
          ]);
        const rows = await listSimulatedResults(
          input.limit ?? DEFAULT_MISSION_RESULTS_LIMIT,
        );
        const repairedRows = await Promise.all(rows.map(repairSimulatedResultRow));
        const batchIdsByRun = await listBatchIdsForMissionRuns(
          repairedRows.map((row) => row.missionRunId),
        );
        const dtos = repairedRows.map((row) => ({
          ...toMissionResultDto(row),
          sourceBatchId: batchIdsByRun.get(row.missionRunId) ?? null,
        }));
        log.info(
          `[ipc:vex:mission:listPaperResults] ok count=${dtos.length} correlationId=${ctx.requestId}`,
        );
        return ok(dtos);
      } catch (cause) {
        log.warn(
          `[ipc:vex:mission:listPaperResults] failed correlationId=${ctx.requestId}`,
          cause,
        );
        return err(controlFailedError(ctx.requestId));
      }
    },
  });
}
