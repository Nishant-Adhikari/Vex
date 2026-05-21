/**
 * Usage schemas — last-turn + session totals from the `usage_log` table.
 *
 * Renderer surfaces the model picker chip + a per-session totals modal.
 * Currency defaults to `USD`; legacy rows that predate the column carry
 * `null` provider/model so the DTO is `nullable` for both.
 *
 * Field names match the canonical refs vocabulary in
 * `BUG-REPORTING.md §3` so Phase 2 BugReportSink can stamp refs without
 * a mapper (`sessionId`, `correlationId` if/when added).
 */

import { z } from "zod";

export const USAGE_DEFAULT_CURRENCY = "USD";

/**
 * One row from `usage_log` mapped for the renderer. All token counts
 * are non-negative integers; `cost` is a JS number (DB column is
 * `NUMERIC` — the mapper parses safely or drops to `null` on overflow,
 * keeping JSON-serializable shape).
 */
export const turnUsageDtoSchema = z
  .object({
    sessionId: z.string().uuid(),
    promptTokens: z.number().int().min(0),
    completionTokens: z.number().int().min(0),
    totalTokens: z.number().int().min(0),
    cachedTokens: z.number().int().min(0),
    reasoningTokens: z.number().int().min(0),
    /** `null` when the DB `NUMERIC` could not be coerced to a finite JS number. */
    cost: z.number().nullable(),
    currency: z.string().min(1).max(8),
    provider: z.string().nullable(),
    model: z.string().nullable(),
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict();
export type TurnUsageDto = z.infer<typeof turnUsageDtoSchema>;

/**
 * Aggregated totals for one session, filtered by currency. The DB query
 * sums per-row counts/cost and returns `requestCount` + the latest
 * `created_at`. Empty sessions resolve to all-zero counts with
 * `lastRequestAt: null` (read-only handler never returns an error
 * shape for "no rows" — that's a normal session state).
 */
export const sessionUsageTotalsDtoSchema = z
  .object({
    sessionId: z.string().uuid(),
    totalPromptTokens: z.number().int().min(0),
    totalCompletionTokens: z.number().int().min(0),
    totalTokens: z.number().int().min(0),
    totalCost: z.number().nullable(),
    currency: z.string().min(1).max(8),
    requestCount: z.number().int().min(0),
    lastRequestAt: z.string().datetime({ offset: true }).nullable(),
  })
  .strict();
export type SessionUsageTotalsDto = z.infer<typeof sessionUsageTotalsDtoSchema>;

export const usageInputSchema = z
  .object({
    sessionId: z.string().uuid(),
    currency: z.string().min(1).max(8).default(USAGE_DEFAULT_CURRENCY),
  })
  .strict();
export type UsageInput = z.infer<typeof usageInputSchema>;

/**
 * Result for `usage.getLastTurn` — `null` when the session has no
 * usage rows yet (mission setup hasn't produced a turn, or all rows
 * were reaped by retention). The renderer renders an empty chip then,
 * not an error toast.
 */
export const lastTurnUsageResultSchema = turnUsageDtoSchema.nullable();
export type LastTurnUsageResult = z.infer<typeof lastTurnUsageResultSchema>;
