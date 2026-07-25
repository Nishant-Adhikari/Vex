/**
 * Mission History — pure display model.
 *
 * Every function here is pure (data in, derived value out) so the math is
 * unit-tested independently of React.
 *
 * `missionDisplayOutcome` is the ONE place the raw ledger
 * `(outcome, stopReason)` pair maps to a presentation-level outcome —
 * deadline semantics stay out of SQL (mission-results.ts / the migration)
 * and out of every component that renders this data. A run whose ledger
 * `outcome` is terminal-but-not-goal and whose `stopReason` is
 * "deadline_reached" displays as "timeBoxed": a neutral, medium-level
 * outcome ("the time-box was reached"), never a failure.
 *
 * Naming: this is a "mission result (ETH)" — an honest PnL record, never
 * "performance" anywhere in this module or its consumers.
 */

import type { MissionResultDto } from "@shared/schemas/mission.js";
import type { PnlCurrency } from "../../stores/uiStore.js";
import { formatUsdDelta } from "../../lib/format.js";

export const EM_DASH = "—";

export type MissionDisplayOutcome =
  | "completed"
  | "timeBoxed"
  | "cancelled"
  | "failed"
  | "stopped"
  | "running";

/** Raw ledger (outcome, stopReason) -> the presentation-level outcome. */
export function missionDisplayOutcome(
  result: Pick<MissionResultDto, "outcome" | "stopReason">,
): MissionDisplayOutcome {
  if (result.stopReason === "deadline_reached" && result.outcome !== "completed") {
    return "timeBoxed";
  }
  return result.outcome;
}

/** Completed AND time-boxed runs count as a "completion" for stats (the win-rate population). */
export function isCompletionLike(displayOutcome: MissionDisplayOutcome): boolean {
  return displayOutcome === "completed" || displayOutcome === "timeBoxed";
}

/**
 * Win-rate (%) over completion-like runs with a known PnL sign. `null` when
 * no run is eligible (e.g. history has only cancelled/still-running rows).
 */
export function computeWinRate(results: readonly MissionResultDto[]): number | null {
  const eligible = results.filter(
    (r) => isCompletionLike(missionDisplayOutcome(r)) && r.pnlEth !== null,
  );
  if (eligible.length === 0) return null;
  const wins = eligible.filter((r) => (r.pnlEth as number) > 0).length;
  return (wins / eligible.length) * 100;
}

/** Sum of known ETH PnL across all results (a null/unknown PnL contributes 0). */
export function sumPnlEth(results: readonly MissionResultDto[]): number {
  return results.reduce((total, r) => total + (r.pnlEth ?? 0), 0);
}

/**
 * Best (max) and worst (min) single-mission ETH PnL across the results. Only
 * rows with a finite `pnlEth` count; `null` when none qualify (so the panel can
 * drop the figure rather than print a fabricated 0).
 */
export function bestWorst(
  results: readonly MissionResultDto[],
): { best: number; worst: number } | null {
  let best: number | null = null;
  let worst: number | null = null;
  for (const r of results) {
    if (r.pnlEth === null || !Number.isFinite(r.pnlEth)) continue;
    const pnl = r.pnlEth;
    if (best === null || pnl > best) best = pnl;
    if (worst === null || pnl < worst) worst = pnl;
  }
  if (best === null || worst === null) return null;
  return { best, worst };
}

const ETH_DECIMALS = 4;

/** Fixed-precision ETH amount; `signed` prefixes +/-. `null`/non-finite -> em dash. */
export function formatEth(value: number | null, opts: { signed?: boolean } = {}): string {
  if (value === null || !Number.isFinite(value)) return EM_DASH;
  const sign = opts.signed ? (value > 0 ? "+" : value < 0 ? "-" : "") : "";
  return `${sign}${Math.abs(value).toFixed(ETH_DECIMALS)}`;
}

/** USD value implied by an ETH PnL at the run's close price; null if either input is unknown. */
export function pnlUsd(pnlEth: number | null, ethPriceUsdEnd: number | null): number | null {
  if (pnlEth === null || ethPriceUsdEnd === null) return null;
  return pnlEth * ethPriceUsdEnd;
}

/**
 * Self-describing signed PnL string in the SELECTED denomination — the single
 * reusable formatter behind the Missions ETH|USD toggle (and reusable for the
 * per-position / per-move PnL readouts later):
 *
 *  - `usd` + a known ETH→USD price  → compact signed USD (`+$12.30`, `-$4.00`);
 *  - `eth`, OR `usd` with a null/non-finite price (FAIL-SOFT) → signed ETH
 *    (`+0.0279 ETH`) so a run with no captured close price is never blank/`$NaN`;
 *  - null/non-finite `ethAmount` → em dash.
 *
 * Pure: the price is passed in (the row's own `ethPriceUsdEnd`), never fetched.
 */
export function formatPnl(
  ethAmount: number | null,
  currency: PnlCurrency,
  ethUsdPrice: number | null,
): string {
  if (ethAmount === null || !Number.isFinite(ethAmount)) return EM_DASH;
  if (
    currency === "usd" &&
    ethUsdPrice !== null &&
    Number.isFinite(ethUsdPrice)
  ) {
    return formatUsdDelta(ethAmount * ethUsdPrice);
  }
  return `${formatEth(ethAmount, { signed: true })} ETH`;
}

/**
 * Cumulative realized USD PnL — the sum of each contributing run valued at ITS
 * OWN close price (`pnlEth × ethPriceUsdEnd`), NOT a single live spot applied to
 * the ETH total. `null` (so the header falls back to the ETH total) when either
 * no run has a known PnL, OR any PnL-bearing run lacks a close price — a partial
 * USD total that silently drops runs would misrepresent the aggregate.
 */
export function sumPnlUsd(results: readonly MissionResultDto[]): number | null {
  let total = 0;
  let counted = 0;
  for (const r of results) {
    if (r.pnlEth === null || !Number.isFinite(r.pnlEth)) continue;
    if (r.ethPriceUsdEnd === null) return null;
    total += r.pnlEth * r.ethPriceUsdEnd;
    counted += 1;
  }
  return counted === 0 ? null : total;
}

/**
 * The cumulative PnL header string in the selected denomination. `usd` shows
 * the summed realized USD when every PnL-bearing run has a close price; it
 * FAILS SOFT to the signed ETH total otherwise (and always in `eth` mode).
 */
export function formatCumulativePnl(
  results: readonly MissionResultDto[],
  currency: PnlCurrency,
): string {
  if (currency === "usd") {
    const usd = sumPnlUsd(results);
    if (usd !== null) return formatUsdDelta(usd);
  }
  return `${formatEth(sumPnlEth(results), { signed: true })} ETH`;
}

/**
 * True when `usd` is selected but the figure had to fall back to ETH (no usable
 * close price) — lets the view show a subtle "showing ETH" hint without
 * duplicating the fallback logic.
 */
export function isUsdFallback(
  currency: PnlCurrency,
  ethAmount: number | null,
  ethUsdPrice: number | null,
): boolean {
  return (
    currency === "usd" &&
    ethAmount !== null &&
    Number.isFinite(ethAmount) &&
    (ethUsdPrice === null || !Number.isFinite(ethUsdPrice))
  );
}

/** `Xs` / `Xm` / `Xh Ym` for a run's persisted duration in seconds; em dash when unknown. */
export function formatDurationS(durationS: number | null): string {
  if (durationS === null || !Number.isFinite(durationS) || durationS < 0) return EM_DASH;
  const totalMinutes = Math.floor(durationS / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  if (totalMinutes > 0) return `${totalMinutes}m`;
  return `${durationS}s`;
}
