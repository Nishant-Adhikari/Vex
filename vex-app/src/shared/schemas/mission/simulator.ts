import { z } from "zod";

export const simulatorLaunchPresetInputSchema = z
  .object({
    seed: z.object({}).passthrough(),
  })
  .strict();
export type SimulatorLaunchPresetInput = z.infer<
  typeof simulatorLaunchPresetInputSchema
>;

export const simulatorLaunchPresetResultSchema = z.discriminatedUnion(
  "outcome",
  [
    z
      .object({
        outcome: z.literal("launched"),
        sessionId: z.string().min(1),
        missionId: z.string().min(1),
        runId: z.string().min(1),
      })
      .strict(),
    z
      .object({
        outcome: z.literal("not_ready"),
        missingFields: z.array(z.string().min(1)),
      })
      .strict(),
    z
      .object({
        outcome: z.literal("accept_failed"),
        reason: z.string().min(1),
      })
      .strict(),
    z
      .object({
        outcome: z.literal("start_failed"),
        reason: z.string().min(1),
      })
      .strict(),
  ],
);
export type SimulatorLaunchPresetResult = z.infer<
  typeof simulatorLaunchPresetResultSchema
>;

export const simulatorStartBatchInputSchema = z
  .object({
    durationMinutes: z.number().int().min(30).max(240).optional(),
  })
  .strict();
export type SimulatorStartBatchInput = z.infer<
  typeof simulatorStartBatchInputSchema
>;

export const simulatorStartBatchResultSchema = z
  .object({
    batchId: z.string().min(1),
    launched: z.number().int().nonnegative(),
    requested: z.number().int().positive(),
  })
  .strict();
export type SimulatorStartBatchResult = z.infer<
  typeof simulatorStartBatchResultSchema
>;

export const simulatorStrategyDtoSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    shortRule: z.string().min(1),
  })
  .strict();
export type SimulatorStrategyDto = z.infer<typeof simulatorStrategyDtoSchema>;

export const simulatorBatchDtoSchema = z
  .object({
    id: z.string().min(1),
    status: z.enum(["active", "completed", "aborted"]),
    goal: z.string().min(1),
    requestedParallel: z.number().int().nonnegative(),
    launchedCount: z.number().int().nonnegative(),
    completedCount: z.number().int().nonnegative(),
    winnerRunId: z.string().nullable(),
    winnerScore: z.number().nullable(),
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict();
export type SimulatorBatchDto = z.infer<typeof simulatorBatchDtoSchema>;

export const simulatorBatchEntryDtoSchema = z
  .object({
    ordinal: z.number().int().positive(),
    strategyId: z.string().min(1),
    strategyName: z.string().min(1),
    shortRule: z.string().min(1),
    sessionId: z.string().min(1),
    missionId: z.string().min(1),
    missionRunId: z.string().min(1),
    status: z.string().min(1),
    stopSummary: z.string().nullable(),
    inferenceProvider: z.string().nullable(),
    inferenceModel: z.string().nullable(),
    inferenceFallbackModel: z.string().nullable(),
    score: z.number().nullable(),
    pnlEth: z.number().nullable(),
    pnlPct: z.number().nullable(),
    trades: z.number().int().nonnegative().nullable(),
    outcome: z.string().nullable(),
    simulated: z.boolean(),
  })
  .strict();
export type SimulatorBatchEntryDto = z.infer<
  typeof simulatorBatchEntryDtoSchema
>;

export const simulatorBatchReadResultSchema = z
  .object({
    batch: simulatorBatchDtoSchema.nullable(),
    leaderStrategyId: z.string().nullable(),
    promotedWinnerStrategyId: z.string().nullable(),
    promotedWinnerVersion: z.string().nullable(),
    strategies: z.array(simulatorStrategyDtoSchema),
    entries: z.array(simulatorBatchEntryDtoSchema),
    promptVersions: z.array(
      z
        .object({
          version: z.string().min(1),
          strategyId: z.string().min(1),
          strategyName: z.string().min(1),
          promptText: z.string().min(1),
          sourceBatchId: z.string().min(1),
          promotedAt: z.string().datetime({ offset: true }),
        })
        .strict(),
    ),
  })
  .strict();
export type SimulatorBatchReadResult = z.infer<
  typeof simulatorBatchReadResultSchema
>;

export const simulatorGetLatestBatchInputSchema = z.object({}).strict();
export type SimulatorGetLatestBatchInput = z.infer<
  typeof simulatorGetLatestBatchInputSchema
>;

export const simulatorBatchHistoryItemDtoSchema = z
  .object({
    id: z.string().min(1),
    status: z.enum(["active", "completed", "aborted"]),
    requestedParallel: z.number().int().nonnegative(),
    launchedCount: z.number().int().nonnegative(),
    completedCount: z.number().int().nonnegative(),
    winnerRunId: z.string().nullable(),
    winnerScore: z.number().nullable(),
    winnerStrategyId: z.string().nullable(),
    winnerStrategyName: z.string().nullable(),
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict();
export type SimulatorBatchHistoryItemDto = z.infer<
  typeof simulatorBatchHistoryItemDtoSchema
>;

export const simulatorListBatchesInputSchema = z
  .object({
    limit: z.number().int().min(1).max(50).optional(),
  })
  .strict();
export type SimulatorListBatchesInput = z.infer<
  typeof simulatorListBatchesInputSchema
>;

export const simulatorListBatchesResultSchema = z.array(
  simulatorBatchHistoryItemDtoSchema,
);
export type SimulatorListBatchesResult = z.infer<
  typeof simulatorListBatchesResultSchema
>;
