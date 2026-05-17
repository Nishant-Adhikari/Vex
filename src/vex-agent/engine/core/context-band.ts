/**
 * Context-usage band — classification of prompt pressure relative to the
 * provider's context window. Drives:
 *   - tool-surface projection (the LLM-visible catalog is narrowed to
 *     `safe_at_barrier` + `read_only` + `compact_only` once band reaches
 *     `barrier`),
 *   - dispatcher hard-deny on mutating tools at barrier+,
 *   - the runtime forced-fallback compact at `critical` (when the agent
 *     fails to call `compact_now` itself),
 *   - the system-prompt context-pressure banner.
 *
 * Band is derived from the lagging `sessions.token_count` (the previous
 * prompt's token count, set by `executeTurn` after each completion). This
 * is one turn behind the real pressure, but it's the only signal available
 * before the next provider call — projecting token count pre-prompt would
 * require running the tokenizer, which is out of scope.
 *
 * Thresholds come from `memory/policy.ts` so the policy layer owns the
 * single source of truth. `contextLimit <= 0` is treated as a degenerate
 * config (no meaningful pressure) → always `"normal"`. Prevents
 * division-by-zero.
 */

import {
  PRESSURE_WARNING_FRACTION,
  PRESSURE_BARRIER_FRACTION,
  PRESSURE_CRITICAL_FRACTION,
  classifyPressure,
  type PressureBand,
} from "@vex-agent/memory/policy.js";

export type ContextUsageBand = PressureBand;

export {
  PRESSURE_WARNING_FRACTION,
  PRESSURE_BARRIER_FRACTION,
  PRESSURE_CRITICAL_FRACTION,
};

export function computeBand(
  tokenCount: number,
  contextLimit: number,
): ContextUsageBand {
  if (!Number.isFinite(tokenCount) || tokenCount <= 0) return "normal";
  if (!Number.isFinite(contextLimit) || contextLimit <= 0) return "normal";
  return classifyPressure(tokenCount / contextLimit);
}

/**
 * True iff the band restricts mutating tools at dispatch. Both `barrier`
 * and `critical` are "at-or-past barrier" — the dispatcher's hard-deny and
 * the LLM-catalog narrowing fire identically across them; only the
 * runtime-side forced fallback differentiates the two.
 */
export function isPressureBarrier(band: ContextUsageBand): boolean {
  return band === "barrier" || band === "critical";
}

/**
 * True iff the band is `critical` — the runtime trigger for forced
 * fallback compact.
 */
export function isPressureCritical(band: ContextUsageBand): boolean {
  return band === "critical";
}

/**
 * Compute the token-fraction used by the context-pressure banner. Returns
 * a clamped [0, 1] value safe to format as a percentage.
 */
export function pressureFraction(tokenCount: number, contextLimit: number): number {
  if (!Number.isFinite(tokenCount) || tokenCount <= 0) return 0;
  if (!Number.isFinite(contextLimit) || contextLimit <= 0) return 0;
  const raw = tokenCount / contextLimit;
  if (raw < 0) return 0;
  if (raw > 1) return 1;
  return raw;
}
