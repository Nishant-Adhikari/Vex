/**
 * Mission budget-pressure banner — the spend-box analogue of
 * `context-pressure.ts`, for the hard MISSION BUDGET.
 *
 * The `fraction` is the PRIMARY spend meter — `costUsed / costCapUsd` (dollars),
 * the same cost cap the turn-loop enforcer hard-cuts on. It falls back to the
 * token fraction only when there is no cost cap or its read failed, so the same
 * escalation thresholds (0.7 / 0.85 / 0.95) apply either way — the banner is
 * unit-agnostic and speaks of "mission budget".
 *
 * Motivation: unlike the deadline (a canonical, agent-known stop), the spend
 * budget was INVISIBLE to the agent — so a run would get hard-cut mid-position
 * and the system would force-liquidate at market (worse fills, can strand
 * illiquid tokens). Surfacing live budget usage lets the agent exit on its own
 * terms BEFORE the cutoff, mirroring how it force-closes before the deadline.
 *
 * Empty string below the warning threshold (and when there is no budget box)
 * so the prompt stack omits this section entirely (`buildPromptStack` filters
 * empty layers).
 */
export function buildMissionBudgetBanner(fraction: number | null): string {
  if (fraction == null || fraction < 0.7) return "";
  const pct = (fraction * 100).toFixed(0);
  if (fraction < 0.85) {
    return `[Mission budget at ${pct}% — runway is getting short. Favor closing/trimming open positions over opening new ones, and line up a clean exit.]`;
  }
  if (fraction < 0.95) {
    return [
      `[ACTION REQUIRED: mission budget at ${pct}%.`,
      `FLATTEN any open positions now and finalize the run (mission_stop) — at 100% the run is hard-cut and the system force-liquidates at market, which fills worse and can strand illiquid tokens.`,
      `Exit on your own terms this turn.`,
      `]`,
    ].join(" ");
  }
  return [
    `[CRITICAL: mission budget at ${pct}%.`,
    `Flatten every open position and finalize THIS turn (mission_stop) — the hard cut + blunt system liquidation is imminent.`,
    `]`,
  ].join(" ");
}
