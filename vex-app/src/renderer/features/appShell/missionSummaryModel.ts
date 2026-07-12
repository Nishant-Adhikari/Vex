/**
 * Pure derivations for the post-mission summary card (mission-results-ledger).
 *
 * The card is a glanceable readout of ONE finalized `MissionResultDto` — every
 * string it prints is composed here so `MissionSummaryCard.tsx` stays a thin map
 * over already-formatted values and the null-guarding is unit-testable. ETH is
 * the native PnL unit; USD (`ethPriceUsdEnd`) is a tooltip only, never a headline
 * figure. Shared ETH/duration/USD helpers are reused from `missionHistoryModel`
 * so the two ledger surfaces format identically.
 */

import { EM_DASH, formatEth, pnlUsd } from "./missionHistoryModel.js";
import { formatPercentDelta, formatUsd } from "../../lib/format.js";

/**
 * Headline PnL in ETH: `+0.0012 ETH`, `-0.0034 ETH`. `null`/non-finite → em
 * dash (no `ETH` suffix — a missing figure prints nothing fabricated).
 */
export function formatPnlEth(pnlEth: number | null): string {
  const body = formatEth(pnlEth, { signed: true });
  return body === EM_DASH ? EM_DASH : `${body} ETH`;
}

/**
 * Parenthetical percent for the PnL headline: `(+1.20%)`, `(-3.40%)`. `null` →
 * empty string so the headline drops the parenthetical rather than showing a
 * dash inside brackets.
 */
export function formatPnlPct(pnlPct: number | null): string {
  if (pnlPct === null || !Number.isFinite(pnlPct)) return "";
  return `(${formatPercentDelta(pnlPct)})`;
}

/**
 * Settlement clause: `ended flat ✅` when no bags are held, else `N bag(s)
 * held ⚠` with the noun pluralised. Flat = `openPositionsCount === 0`.
 */
export function formatSettlement(openPositionsCount: number): string {
  if (openPositionsCount <= 0) return "ended flat ✅";
  const noun = openPositionsCount === 1 ? "bag" : "bags";
  return `${openPositionsCount} ${noun} held ⚠`;
}

/**
 * Meta line: `{trades} trades · {settlement}` — the at-a-glance trade count and
 * whether the mission closed clean.
 */
export function formatMetaLine(
  trades: number,
  openPositionsCount: number,
): string {
  return `${trades} trades · ${formatSettlement(openPositionsCount)}`;
}

/**
 * USD value of the ETH PnL at close for the headline tooltip: `$30.00 at close`.
 * `undefined` when either input is missing — the title attribute is omitted, not
 * fabricated.
 */
export function pnlUsdTitle(
  pnlEth: number | null,
  ethPriceUsdEnd: number | null,
): string | undefined {
  const usd = pnlUsd(pnlEth, ethPriceUsdEnd);
  return usd === null ? undefined : `${formatUsd(usd)} at close`;
}

/**
 * Sign → PnL colour class: positive success, negative destructive, flat/unknown
 * muted. Mirrors `MissionHistory`'s local `pnlTone` so both surfaces agree.
 */
export function pnlToneClass(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "text-[var(--vex-text-3)]";
  }
  if (value > 0) return "text-[var(--color-success)]";
  if (value < 0) return "text-destructive";
  return "text-[var(--vex-text-2)]";
}
