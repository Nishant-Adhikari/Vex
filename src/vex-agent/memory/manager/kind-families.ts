/**
 * Candidate kind families (S4 §6/§7). `kind` is OPEN snake_case (not an enum), so
 * the manager classifies it by SUFFIX/substring rather than an exhaustive list.
 *
 * Two families matter to the deterministic stage + judge:
 * - GENERALIZATION: a strategy/risk lesson that claims to apply BEYOND a single
 *   instance. D-REC gates these — they promote only at recurrence ≥ 2; at n=1
 *   they retain (a recallable hypothesis). A single anchored fact is NOT a
 *   generalization and is exempt from the recurrence gate.
 * - TRADE: a trade-outcome / strategy / risk lesson where process-vs-outcome
 *   matters (the lesson must be about the pre-decision PROCESS, not realized
 *   PnL). The judge's `processNotOutcome` axis is only load-bearing here.
 *
 * Pure module: string predicates only. No DB, no I/O.
 */

/** Substrings marking a kind as a generalized lesson (strategy / risk). */
const GENERALIZATION_MARKERS = ["strategy", "risk", "lesson", "pattern", "heuristic"] as const;

/** Substrings marking a kind as trade-family (process-vs-outcome applies). */
const TRADE_MARKERS = ["trade", "strategy", "risk", "position", "entry", "exit"] as const;

function containsAny(kind: string, markers: readonly string[]): boolean {
  const k = kind.toLowerCase();
  return markers.some((m) => k.includes(m));
}

/**
 * Whether `kind` is a GENERALIZED lesson subject to the D-REC recurrence gate.
 * A `*_fact` / `user_preference` / one-off observation is NOT a generalization.
 */
export function isGeneralizationKind(kind: string): boolean {
  return containsAny(kind, GENERALIZATION_MARKERS);
}

/**
 * Whether `kind` is in the trade family, where the judge's process-not-outcome
 * axis is load-bearing (the lesson must be about pre-decision signals, not the
 * realized outcome).
 */
export function isTradeKind(kind: string): boolean {
  return containsAny(kind, TRADE_MARKERS);
}
