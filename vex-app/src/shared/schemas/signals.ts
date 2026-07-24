/**
 * Signals schemas — read-only view of today's ingested TrendRadar signals
 * plus the LLM-as-judge grade (Signals section, minimal wiring).
 *
 * Sanitized for the renderer: the list DTO carries the display features the
 * panel renders (symbol / score / liquidity / velocity / mentions / risk
 * flags) plus three fields lifted out of the row's `raw` jsonb in main
 * (`priceChange24hPct`, `marketCapUsd`, `dexscreenerUrl`) so the renderer
 * never parses arbitrary provider JSON. Signals are DISCOVERY/observability
 * only — there is deliberately NO mutation surface here and nothing that can
 * authorise a trade.
 *
 * The grade is the LLM-as-judge verdict for ONE signal, graded on the
 * signal's own features (a compact `{ grade, verdict, rationale }`). It is
 * ephemeral in the renderer (React Query cache) and never persisted.
 */

import { z } from "zod";

export const SIGNALS_LIST_TODAY_DEFAULT_LIMIT = 100;
export const SIGNALS_LIST_TODAY_MAX_LIMIT = 200;

/**
 * Input for `signals.listToday`. `withinHours` bounds the rolling window
 * ("today" = last 24h by default); `limit` is bounded so this is never a
 * caller-controlled unbounded scan.
 */
export const signalsListTodayInputSchema = z
  .object({
    withinHours: z.number().int().positive().max(168).default(24),
    limit: z
      .number()
      .int()
      .positive()
      .max(SIGNALS_LIST_TODAY_MAX_LIMIT)
      .default(SIGNALS_LIST_TODAY_DEFAULT_LIMIT),
  })
  .strict();
export type SignalsListTodayInput = z.infer<typeof signalsListTodayInputSchema>;

/** One signal row, sanitized for the panel. `id` keys the per-row grade. */
export const signalListItemDtoSchema = z
  .object({
    id: z.number().int().positive(),
    source: z.string(),
    chain: z.string(),
    contract: z.string(),
    symbol: z.string().nullable(),
    action: z.string().nullable(),
    score: z.number().nullable(),
    todayMentions: z.number().nullable(),
    yesterdayMentions: z.number().nullable(),
    velocityPct: z.number().nullable(),
    liquidityUsd: z.number().nullable(),
    volume24hUsd: z.number().nullable(),
    priceUsd: z.number().nullable(),
    /** Lifted from `raw.price_change_24h_pct` (nullable when absent). */
    priceChange24hPct: z.number().nullable(),
    /** Lifted from `raw.market_cap` / `raw.fdv` (nullable when absent). */
    marketCapUsd: z.number().nullable(),
    /** Lifted from `raw.dexscreener_url` (nullable when absent). */
    dexscreenerUrl: z.string().nullable(),
    narratives: z.array(z.string()),
    riskFlags: z.array(z.string()),
    feedGeneratedAt: z.string().nullable(),
    ingestedAt: z.string(),
  })
  .strict();
export type SignalListItemDto = z.infer<typeof signalListItemDtoSchema>;

/** Result for `signals.listToday` — always an array (global store, no scope). */
export const signalsListTodayResultSchema = z.array(signalListItemDtoSchema);
export type SignalsListTodayResult = z.infer<
  typeof signalsListTodayResultSchema
>;

/** Input for `signals.grade` — the signal id to grade. */
export const signalGradeInputSchema = z
  .object({ id: z.number().int().positive() })
  .strict();
export type SignalGradeInput = z.infer<typeof signalGradeInputSchema>;

export const SIGNAL_GRADE_VERDICTS = ["runner", "trap", "neutral"] as const;
export const signalGradeVerdictSchema = z.enum(SIGNAL_GRADE_VERDICTS);
export type SignalGradeVerdict = z.infer<typeof signalGradeVerdictSchema>;

export const SIGNAL_GRADE_RATIONALE_MAX = 200;

/**
 * The LLM-as-judge verdict. `grade` is 0-100 (higher = more likely a real
 * runner), `verdict` is the coarse bucket, `rationale` is a short (<=200
 * char) one-line justification. Graded on the signal's OWN features — a
 * post-hoc price-outcome grade is a later enhancement (see grade.ts TODO).
 */
export const signalGradeResultSchema = z
  .object({
    id: z.number().int().positive(),
    grade: z.number().int().min(0).max(100),
    verdict: signalGradeVerdictSchema,
    rationale: z.string().max(SIGNAL_GRADE_RATIONALE_MAX),
  })
  .strict();
export type SignalGradeResult = z.infer<typeof signalGradeResultSchema>;
