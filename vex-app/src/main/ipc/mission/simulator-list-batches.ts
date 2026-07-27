import { CH } from "@shared/ipc/channels.js";
import { ok, err, type Result } from "@shared/ipc/result.js";
import {
  simulatorListBatchesInputSchema,
  simulatorListBatchesResultSchema,
  type SimulatorListBatchesResult,
} from "@shared/schemas/mission.js";
import {
  listActiveSimulatorBatches,
  listCompletedSimulatorBatches,
} from "@vex-agent/db/repos/simulator-batches.js";
import { strategyForOrdinal } from "../../../shared/simulator/pons-paper-strategies.js";
import { log } from "../../logger/index.js";
import { registerHandler } from "../register-handler.js";
import { controlFailedError } from "../runtime/_errors.js";
import { ensureEngineDbUrl } from "../runtime/_ensure-engine-db-url.js";

export function registerMissionSimulatorListBatchesHandler(): () => void {
  return registerHandler({
    channel: CH.mission.simulatorListBatches,
    domain: "mission",
    inputSchema: simulatorListBatchesInputSchema,
    outputSchema: simulatorListBatchesResultSchema,
    handle: async (input, ctx): Promise<Result<SimulatorListBatchesResult>> => {
      const dbUrlOutcome = await ensureEngineDbUrl(ctx.requestId);
      if (!dbUrlOutcome.ok) return dbUrlOutcome;
      try {
        const limit = input.limit ?? 12;
        const [active, completed, { listEntriesForBatch }] = await Promise.all([
          listActiveSimulatorBatches(limit),
          listCompletedSimulatorBatches(limit),
          import("@vex-agent/db/repos/simulator-batches.js"),
        ]);
        const batches = [...active, ...completed]
          .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
          .slice(0, limit);
        const rows = await Promise.all(
          batches.map(async (batch) => {
            const winnerEntry =
              batch.winnerRunId === null
                ? null
                : (await listEntriesForBatch(batch.id)).find(
                    (entry) => entry.missionRunId === batch.winnerRunId,
                  ) ?? null;
            const winnerStrategy =
              winnerEntry === null ? null : strategyForOrdinal(winnerEntry.ordinal);
            return {
              id: batch.id,
              status: batch.status,
              requestedParallel: batch.requestedParallel,
              launchedCount: batch.launchedCount,
              completedCount: batch.completedCount,
              winnerRunId: batch.winnerRunId,
              winnerScore: batch.winnerScore,
              winnerStrategyId: winnerStrategy?.id ?? null,
              winnerStrategyName: winnerStrategy?.name ?? null,
              createdAt: batch.createdAt,
              updatedAt: batch.updatedAt,
            };
          }),
        );
        log.info(
          `[ipc:vex:mission:simulatorListBatches] ok count=${rows.length} correlationId=${ctx.requestId}`,
        );
        return ok(rows);
      } catch (cause) {
        log.warn(
          `[ipc:vex:mission:simulatorListBatches] failed correlationId=${ctx.requestId}`,
          cause,
        );
        return err(controlFailedError(ctx.requestId));
      }
    },
  });
}
