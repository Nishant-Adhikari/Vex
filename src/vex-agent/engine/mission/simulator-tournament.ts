import { randomUUID } from "node:crypto";

import {
  addSimulatorBatchEntry,
  createSimulatorBatch,
  finalizeSimulatorBatchState,
  getLatestSimulatorBatch,
  listActiveSimulatorBatches,
  listEntriesForBatch,
  updateSimulatorBatchEntry,
  type SimulatorBatch,
} from "../../db/repos/simulator-batches.js";
import { getResultByRunId } from "../../db/repos/mission-results.js";
import { getRun } from "../../db/repos/mission-runs.js";
import logger from "@utils/logger.js";
import { scoreSimulatorResult } from "./simulator-tournament-score.js";

export async function createSimulatorTournamentBatch(input: {
  goal: string;
  requestedParallel: number;
}): Promise<SimulatorBatch> {
  const id = `sim-batch-${Date.now()}-${randomUUID().slice(0, 8)}`;
  await createSimulatorBatch({
    id,
    goal: input.goal,
    requestedParallel: input.requestedParallel,
  });
  return (await getLatestSimulatorBatch())!;
}

export async function recordSimulatorTournamentLaunch(input: {
  batchId: string;
  ordinal: number;
  sessionId: string;
  missionId: string;
  runId: string;
}): Promise<void> {
  await addSimulatorBatchEntry({
    id: `sim-entry-${Date.now()}-${randomUUID().slice(0, 8)}`,
    batchId: input.batchId,
    ordinal: input.ordinal,
    sessionId: input.sessionId,
    missionId: input.missionId,
    missionRunId: input.runId,
  });
}

export async function recomputeSimulatorTournamentBatch(
  batchId: string,
): Promise<{
  winnerRunId: string | null;
  winnerScore: number | null;
  completedCount: number;
  totalCount: number;
  completed: boolean;
}> {
  const entries = await listEntriesForBatch(batchId);
  let completedCount = 0;
  let winnerRunId: string | null = null;
  let winnerScore: number | null = null;

  for (const entry of entries) {
    const run = await getRun(entry.missionRunId);
    const result = await getResultByRunId(entry.missionRunId);
    const scored = scoreSimulatorResult(result);
    const status = run?.status ?? entry.status;
    const terminal =
      status === "completed" ||
      status === "failed" ||
      status === "stopped" ||
      status === "cancelled";
    if (terminal) completedCount += 1;
    const score = scored.terminal ? scored.score : null;
    await updateSimulatorBatchEntry(batchId, entry.missionRunId, {
      status,
      score,
    });
    if (score !== null && (winnerScore === null || score > winnerScore)) {
      winnerScore = score;
      winnerRunId = entry.missionRunId;
    }
  }

  const completed = entries.length > 0 && completedCount >= entries.length;
  await finalizeSimulatorBatchState({
    batchId,
    completedCount,
    winnerRunId,
    winnerScore,
    completed,
  });
  logger.info("sim.tournament.recomputed", {
    batchId,
    completedCount,
    totalCount: entries.length,
    winnerRunId,
    winnerScore,
    completed,
    modeTag: "paper",
  });
  return {
    winnerRunId,
    winnerScore,
    completedCount,
    totalCount: entries.length,
    completed,
  };
}

export async function recomputeActiveSimulatorTournaments(): Promise<void> {
  const batches = await listActiveSimulatorBatches(10);
  for (const batch of batches) {
    try {
      await recomputeSimulatorTournamentBatch(batch.id);
    } catch (err) {
      logger.warn("sim.tournament.recompute_failed", {
        batchId: batch.id,
        modeTag: "paper",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
