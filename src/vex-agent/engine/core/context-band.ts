/**
 * Context-usage band — classification of prompt pressure relative to the
 * provider's context window. Drives tool-surface projection (warning-band
 * tools) and the forced pre-compact handoff pass (critical band).
 *
 * Band is derived from the lagging `sessions.token_count` (the previous
 * prompt's token count, set by `executeTurn` after each completion). This
 * is one turn behind the real pressure, but it's the only signal available
 * before the next provider call — projecting token count pre-prompt would
 * require running the tokenizer, which is out of scope.
 *
 * PR2 staging: `ContextUsageBand` includes `"barrier"` as a literal so the
 * new memory-layer code can type-check against the planned 4-band system,
 * but `computeBand` still returns only `"normal" | "warning" | "critical"`
 * with the legacy 0.80 / 0.90 thresholds. The PR2 cutover (turn-loop signal
 * handling + legacy delete) will flip the implementation to the 4-band
 * thresholds at 0.85 / 0.88 / 0.92 from `memory/policy.ts`.
 *
 * `contextLimit <= 0` is treated as a degenerate config (no meaningful
 * pressure) → always `"normal"`. Prevents division-by-zero.
 */

export const WARNING_THRESHOLD = 0.80;
export const CRITICAL_THRESHOLD = 0.90;

export type ContextUsageBand = "normal" | "warning" | "barrier" | "critical";

export function computeBand(
  tokenCount: number,
  contextLimit: number,
): ContextUsageBand {
  if (!Number.isFinite(tokenCount) || tokenCount <= 0) return "normal";
  if (!Number.isFinite(contextLimit) || contextLimit <= 0) return "normal";

  const ratio = tokenCount / contextLimit;
  if (ratio >= CRITICAL_THRESHOLD) return "critical";
  if (ratio >= WARNING_THRESHOLD) return "warning";
  return "normal";
}

/** True iff the band restricts mutating tools at dispatch (PR2 cutover). */
export function isPressureBarrier(band: ContextUsageBand): boolean {
  return band === "barrier" || band === "critical";
}
