import { CH } from "@shared/ipc/channels.js";
import { ok, err, type Result } from "@shared/ipc/result.js";
import {
  simulatorBatchReadResultSchema,
  simulatorGetLatestBatchInputSchema,
  type SimulatorBatchReadResult,
} from "@shared/schemas/mission.js";
import {
  BASELINE_PROMPT_VERSION,
  BASELINE_STRATEGY_ID,
  BASELINE_STRATEGY_NAME,
  buildPonsLiveBaselineSeed,
  buildPonsLiveStrategySeed,
  PONS_PAPER_STRATEGIES,
  strategyForOrdinal,
} from "../../../shared/simulator/pons-paper-strategies.js";
import { log } from "../../logger/index.js";
import { registerHandler } from "../register-handler.js";
import { controlFailedError } from "../runtime/_errors.js";
import { ensureEngineDbUrl } from "../runtime/_ensure-engine-db-url.js";

export function registerMissionSimulatorGetLatestBatchHandler(): () => void {
  return registerHandler({
    channel: CH.mission.simulatorGetLatestBatch,
    domain: "mission",
    inputSchema: simulatorGetLatestBatchInputSchema,
    outputSchema: simulatorBatchReadResultSchema,
    handle: async (_input, ctx): Promise<Result<SimulatorBatchReadResult>> => {
      const dbUrlOutcome = await ensureEngineDbUrl(ctx.requestId);
      if (!dbUrlOutcome.ok) return dbUrlOutcome;
      try {
        const {
          getLatestSimulatorBatch,
          listCompletedSimulatorBatches,
          listEntriesForBatch,
        } = await import("@vex-agent/db/repos/simulator-batches.js");
        const { getResultByRunId } = await import("@vex-agent/db/repos/mission-results.js");
        const { getRun } = await import("@vex-agent/db/repos/mission-runs.js");
        const { recomputeSimulatorTournamentBatch } = await import("@vex-agent/engine/index.js");

        let batch = await getLatestSimulatorBatch();
        if (batch !== null) {
          await recomputeSimulatorTournamentBatch(batch.id);
          batch = await getLatestSimulatorBatch();
        }

        if (batch === null) {
          return ok({
            batch: null,
            leaderStrategyId: null,
            promotedWinnerStrategyId: null,
            promotedWinnerVersion: null,
            strategies: PONS_PAPER_STRATEGIES.map((strategy) => ({
              id: strategy.id,
              name: strategy.name,
              shortRule: strategy.shortRule,
            })),
            entries: [],
            promptVersions: [],
          });
        }

        const entries = await listEntriesForBatch(batch.id);
        const enrichedEntries = await Promise.all(
          entries.map(async (entry) => {
            const strategy = strategyForOrdinal(entry.ordinal);
            const result = await getResultByRunId(entry.missionRunId);
            const run = await getRun(entry.missionRunId);
            return {
              ordinal: entry.ordinal,
              strategyId: strategy?.id ?? `slot-${entry.ordinal}`,
              strategyName: strategy?.name ?? `Strategy ${entry.ordinal}`,
              shortRule: strategy?.shortRule ?? "Unnamed strategy slot.",
              sessionId: entry.sessionId,
              missionId: entry.missionId,
              missionRunId: entry.missionRunId,
              status: run?.status ?? entry.status,
              stopSummary: run?.stopSummary ?? null,
              inferenceProvider: run?.inferenceProvider ?? null,
              inferenceModel: run?.inferenceModel ?? null,
              inferenceFallbackModel: run?.inferenceFallbackModel ?? null,
              score: entry.score,
              pnlEth: result?.pnlEth ?? null,
              pnlPct: result?.pnlPct ?? null,
              trades: result?.trades ?? null,
              outcome: result?.outcome ?? null,
              simulated: result?.simulated ?? true,
            };
          }),
        );
        const leaderEntry =
          batch.winnerRunId === null
            ? null
            : enrichedEntries.find((entry) => entry.missionRunId === batch.winnerRunId) ?? null;
        const completedBatches = await listCompletedSimulatorBatches(100);
        const promotedVersions = await Promise.all(
          completedBatches.map(async (completedBatch, index) => {
            const version = `v1.${index + 1}`;
            const batchEntries = await listEntriesForBatch(completedBatch.id);
            const winningBatchEntry =
              completedBatch.winnerRunId === null
                ? null
                : batchEntries.find(
                    (entry) => entry.missionRunId === completedBatch.winnerRunId,
                  ) ?? null;
            const strategy =
              winningBatchEntry === null
                ? null
                : strategyForOrdinal(winningBatchEntry.ordinal);
            return strategy === null
              ? null
              : {
                  version,
                  strategyId: strategy.id,
                  strategyName: strategy.name,
                  promptText: String(buildPonsLiveStrategySeed(strategy).goal ?? ""),
                  sourceBatchId: completedBatch.id,
                  promotedAt: completedBatch.updatedAt,
                };
          }),
        );
        const validPromotedVersions = promotedVersions.filter(
          (item): item is NonNullable<(typeof promotedVersions)[number]> => item !== null,
        );
        const latestPromoted = validPromotedVersions.at(-1) ?? null;
        const promotable =
          batch.status === "completed" &&
          batch.launchedCount === PONS_PAPER_STRATEGIES.length &&
          batch.completedCount === PONS_PAPER_STRATEGIES.length &&
          leaderEntry !== null;
        return ok({
          batch,
          leaderStrategyId: leaderEntry?.strategyId ?? null,
          promotedWinnerStrategyId: promotable
            ? leaderEntry?.strategyId ?? null
            : latestPromoted?.strategyId ?? null,
          promotedWinnerVersion: promotable
            ? `v1.${validPromotedVersions.length + 1}`
            : latestPromoted?.version ?? null,
          strategies: PONS_PAPER_STRATEGIES.map((strategy) => ({
            id: strategy.id,
            name: strategy.name,
            shortRule: strategy.shortRule,
          })),
          entries: enrichedEntries,
          promptVersions: [
            {
              version: BASELINE_PROMPT_VERSION,
              strategyId: BASELINE_STRATEGY_ID,
              strategyName: BASELINE_STRATEGY_NAME,
              promptText: String(buildPonsLiveBaselineSeed().goal ?? ""),
              sourceBatchId: "baseline",
              promotedAt: batch.createdAt,
            },
            ...validPromotedVersions,
          ],
        });
      } catch (cause) {
        log.warn(
          `[ipc:vex:mission:simulatorGetLatestBatch] failed correlationId=${ctx.requestId}`,
          cause,
        );
        return err(controlFailedError(ctx.requestId));
      }
    },
  });
}
