import { CH } from "@shared/ipc/channels.js";
import { ok, err, type Result } from "@shared/ipc/result.js";
import {
  simulatorStartBatchInputSchema,
  simulatorStartBatchResultSchema,
  type SimulatorStartBatchResult,
} from "@shared/schemas/mission.js";
import {
  buildPonsPaperStrategySeed,
  DEFAULT_SIMULATOR_DURATION_MINUTES,
  PONS_PAPER_STRATEGIES,
} from "../../../shared/simulator/pons-paper-strategies.js";
import { log } from "../../logger/index.js";
import { registerHandler } from "../register-handler.js";
import { controlFailedError } from "../runtime/_errors.js";
import { ensureEngineDbUrl } from "../runtime/_ensure-engine-db-url.js";

export function registerMissionSimulatorStartBatchHandler(): () => void {
  return registerHandler({
    channel: CH.mission.simulatorStartBatch,
    domain: "mission",
    inputSchema: simulatorStartBatchInputSchema,
    outputSchema: simulatorStartBatchResultSchema,
    handle: async (input, ctx): Promise<Result<SimulatorStartBatchResult>> => {
      const dbUrlOutcome = await ensureEngineDbUrl(ctx.requestId);
      if (!dbUrlOutcome.ok) return dbUrlOutcome;
      try {
        const durationMinutes =
          input.durationMinutes ?? DEFAULT_SIMULATOR_DURATION_MINUTES;
        const {
          createSimulatorTournamentBatch,
          recordSimulatorTournamentLaunch,
          recomputeSimulatorTournamentBatch,
          launchScheduledSimulatorMission,
        } = await import("@vex-agent/engine/index.js");

        const batch = await createSimulatorTournamentBatch({
          goal: `PONS paper simulator batch — ${PONS_PAPER_STRATEGIES.length} strategies, ${durationMinutes}m`,
          requestedParallel: PONS_PAPER_STRATEGIES.length,
        });

        let launched = 0;
        for (const [index, strategy] of PONS_PAPER_STRATEGIES.entries()) {
          const result = await launchScheduledSimulatorMission({
            seed: buildPonsPaperStrategySeed(strategy, durationMinutes),
          });
          log.info(
            `[ipc:vex:mission:simulatorStartBatch] strategy=${strategy.id} outcome=${result.outcome} batch=${batch.id} mode=paper correlationId=${ctx.requestId}`,
          );
          if (
            result.outcome === "launched" &&
            result.sessionId &&
            result.missionId &&
            result.runId
          ) {
            launched += 1;
            await recordSimulatorTournamentLaunch({
              batchId: batch.id,
              ordinal: index + 1,
              sessionId: result.sessionId,
              missionId: result.missionId,
              runId: result.runId,
            });
          }
        }
        await recomputeSimulatorTournamentBatch(batch.id);
        return ok({
          batchId: batch.id,
          launched,
          requested: PONS_PAPER_STRATEGIES.length,
        });
      } catch (cause) {
        log.warn(
          `[ipc:vex:mission:simulatorStartBatch] failed mode=paper correlationId=${ctx.requestId}`,
          cause,
        );
        return err(controlFailedError(ctx.requestId));
      }
    },
  });
}
