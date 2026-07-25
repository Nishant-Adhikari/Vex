/**
 * ADAPTIVE STRATEGY — the auto-tunable HALF of the mission strategy prompt.
 *
 * This is the ONLY strategy text the self-improving loop may revise. It is a
 * bounded, versioned block of TACTICS ("how to trade well") — entry/exit
 * heuristics, hold-time, trend checks, trailing-stop usage, position sizing
 * WITHIN the immutable cap, and monitoring cadence. It carries NO safety rules;
 * every "never do X" control lives in the `## MISSION SAFETY CORE` block, which
 * this section is explicitly subordinate to.
 *
 * `ADAPTIVE_STRATEGY_BASELINE` is the human seed (version 0). On first use the
 * loop persists it as the baseline row; "reset to baseline" re-activates a fresh
 * copy of this constant, so edits to the seed here propagate on the next reset.
 *
 * The rewriter must CONSOLIDATE within `ADAPTIVE_SECTION_MAX_CHARS` — it may not
 * append unboundedly. The size cap is the primary drift bound (guardrail (d));
 * the delta/oscillation bounds around it live in the guardrail lib.
 */

/**
 * Hard size ceiling for the adaptive section (drift bound). The rewriter is told
 * this budget and must consolidate to stay inside it; a revision over the cap is
 * rejected. Kept deliberately modest so the section stays a focused tactics list,
 * never an ever-growing scratchpad of contradictory advice.
 */
export const ADAPTIVE_SECTION_MAX_CHARS = 2_000;

/** Minimum sensible size — a revision that collapses to near-nothing is rejected. */
export const ADAPTIVE_SECTION_MIN_CHARS = 80;

/**
 * The human baseline (version 0). Tactical only — no safety rules. Seeded from
 * the discovery/execution guidance the mission run prompt already implies.
 */
export const ADAPTIVE_STRATEGY_BASELINE = [
  "Tactical guidance for trading well WITHIN the immutable safety core. These are",
  "heuristics, not rules — the safety core always overrides them.",
  "",
  "- Discovery: for fresh Solana tokens prefer the Jupiter trending/search feeds",
  "  (organic score, verification, holder/audit signal) over the raw DexScreener",
  "  list. Produce a shortlist before committing to any single candidate.",
  "- Entry: require a concrete, stated edge (momentum, liquidity depth, a credible",
  "  catalyst) before buying — not just \"it is moving\". Prefer tokens with enough",
  "  liquidity that your position is a small fraction of the pool.",
  "- Sizing within the cap: scale position size to conviction and liquidity; keep",
  "  most of the risk budget in reserve early in the run so you can act on a better",
  "  setup later. Never concentrate the whole budget into one illiquid name.",
  "- Trend check: confirm the short-term trend and that liquidity is stable (not",
  "  draining) before entering; skip candidates whose volume is collapsing.",
  "- Exit: take profit into strength rather than round-tripping a gain; when a",
  "  thesis is invalidated, exit promptly instead of hoping. Consider a trailing",
  "  exit to let winners run while protecting realized gains.",
  "- Hold time: these are short-horizon trades. Do not marry a position; if it is",
  "  not working within your planned window, rotate the capital.",
  "- Monitoring cadence: after each execution refresh live balances and re-assess",
  "  before the next action. Use loop_defer to wake on a price/time condition",
  "  rather than busy-polling.",
].join("\n");

/**
 * Render the adaptive-strategy layer for injection into the mission prompt.
 * `content` is the currently-active version (or the baseline). Deterministic —
 * safe in the static cache prefix.
 */
export function buildAdaptiveStrategyPrompt(content: string): string {
  return [
    "## ADAPTIVE STRATEGY (auto-tuned from prior missions)",
    "",
    "Tactical guidance refined from what past missions learned. It is ADVISORY and",
    "strictly subordinate to the `## MISSION SAFETY CORE` above — if any tactic",
    "here seems to conflict with a safety rule, the safety rule wins.",
    "",
    content.trim(),
  ].join("\n");
}

/**
 * Assemble the full immutable+adaptive strategy prompt exactly as the mission
 * run renders it — the canonical string the safety-core validator runs over
 * after a rewrite. Exported so the rewrite pipeline and the prompt builder agree
 * on assembly order byte-for-byte.
 */
export function assembleStrategyPrompt(
  safetyCore: string,
  adaptiveContent: string,
): string {
  return `${safetyCore}\n\n${buildAdaptiveStrategyPrompt(adaptiveContent)}`;
}
