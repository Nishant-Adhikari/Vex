/**
 * Mission summary card — pure display model.
 *
 * `MissionSummaryCard.tsx` is a thin map over the strings composed here, so
 * the null-guarding and the sign/tone rules are unit-testable without React.
 *
 * ONE RULE GOVERNS THIS FILE: every money string is derived from the ledger's
 * numeric fields. Nothing here reads `stopSummary` — the agent's prose is
 * rendered verbatim by the component and is never parsed for a figure. See
 * `missionSummaryProse.ts` for the prose side of that split.
 */

import { EM_DASH, formatEth, pnlUsd } from "./missionHistoryModel.js";
import { formatPercentDelta, formatUsdDelta } from "../../lib/format.js";

/**
 * Density of the shared card. `hero` is the post-run readout in the session
 * view; `compact` is the same card at ledger-list scale. A density changes
 * type sizes and padding ONLY — never which elements exist, and never where
 * a value comes from.
 */
export type MissionSummaryDensity = "hero" | "compact";

/** The headline: signed USD PnL at the run's close price. Em dash when either input is missing. */
export function formatPnlUsd(pnlEth: number | null, ethPriceUsdEnd: number | null): string {
  const usd = pnlUsd(pnlEth, ethPriceUsdEnd);
  return usd === null ? EM_DASH : formatUsdDelta(usd);
}

/** The native-unit aside under the headline: `+0.0012 ETH`. Em dash (no suffix) when unknown. */
export function formatPnlEth(pnlEth: number | null): string {
  const body = formatEth(pnlEth, { signed: true });
  return body === EM_DASH ? EM_DASH : `${body} ETH`;
}

/**
 * Percent aside for the headline: `+1.20%`. Empty string when unknown so the
 * headline simply drops it rather than printing a dash beside a real figure.
 */
export function formatPnlPct(pnlPct: number | null): string {
  if (pnlPct === null || !Number.isFinite(pnlPct)) return "";
  return formatPercentDelta(pnlPct);
}

/** `2 trades` / `1 trade` — pluralised counter for the meta line. */
export function formatTrades(trades: number): string {
  return `${trades} ${trades === 1 ? "trade" : "trades"}`;
}

/**
 * Sign -> PnL colour class: positive success, negative destructive,
 * flat/unknown muted. The one place the tone is decided, so the hero and the
 * ledger list can never disagree about what a loss looks like.
 */
export function pnlToneClass(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "text-[var(--vex-text-3)]";
  if (value > 0) return "text-[var(--color-success)]";
  if (value < 0) return "text-destructive";
  return "text-[var(--vex-text-2)]";
}
