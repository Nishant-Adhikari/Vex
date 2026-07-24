/**
 * Mission token-budget pressure banner — the spend-box analogue of
 * `context-pressure.ts`, for the hard MISSION TOKEN BUDGET.
 *
 * Motivation: unlike the deadline (a canonical, agent-known stop), the token
 * budget was INVISIBLE to the agent — so a run would get hard-cut mid-position
 * and the system would force-liquidate at market (worse fills, can strand
 * illiquid tokens). Surfacing live budget usage lets the agent exit on its own
 * terms BEFORE the cutoff, mirroring how it force-closes before the deadline.
 *
 * Empty string below the warning threshold (and when there is no budget box)
 * so the prompt stack omits this section entirely (`buildPromptStack` filters
 * empty layers). `fraction` is `tokensUsed / budget`.
 */
export function buildMissionBudgetBanner(fraction: number | null): string {
  if (fraction == null || fraction < 0.7) return "";
  const pct = (fraction * 100).toFixed(0);
  if (fraction < 0.85) {
    return `[Mission token budget at ${pct}% — runway is getting short. Favor closing/trimming open positions over opening new ones, and line up a clean exit.]`;
  }
  if (fraction < 0.95) {
    return [
      `[ACTION REQUIRED: mission token budget at ${pct}%.`,
      `FLATTEN any open positions now and finalize the run (mission_stop) — at 100% the run is hard-cut and the system force-liquidates at market, which fills worse and can strand illiquid tokens.`,
      `Exit on your own terms this turn.`,
      `]`,
    ].join(" ");
  }
  return [
    `[CRITICAL: mission token budget at ${pct}%.`,
    `Flatten every open position and finalize THIS turn (mission_stop) — the hard cut + blunt system liquidation is imminent.`,
    `]`,
  ].join(" ");
}
