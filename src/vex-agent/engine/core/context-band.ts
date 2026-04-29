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
 * Thresholds:
 * - `< 80%`  → `"normal"`  — no band-scoped tools visible.
 * - `≥ 80%` and `< 90%` → `"warning"` — `checkpoint_handoff_prepare` visible.
 * - `≥ 90%` → `"critical"` — checkpoint gate fires; forced pre-compact
 *   handoff pass runs if no active handoff exists for the next generation.
 *
 * `contextLimit <= 0` is treated as a degenerate config (no meaningful
 * pressure) → always `"normal"`. Prevents division-by-zero and keeps the
 * helper total.
 */

export const WARNING_THRESHOLD = 0.80;
export const CRITICAL_THRESHOLD = 0.90;

export type ContextUsageBand = "normal" | "warning" | "critical";

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
