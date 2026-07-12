/**
 * Pure derivations for the Mission History ledger (mission-results-ledger).
 *
 * Every figure the panel renders is computed here so the presentation layer
 * (`MissionHistory.tsx`) stays a thin map over already-derived values and the
 * arithmetic (win-rate denominator, cumulative running sum, sparkline geometry)
 * is unit-testable in isolation. ETH is the native PnL unit; USD is display-only
 * (`ethPriceUsdEnd`), so it never enters these totals.
 *
 * `null`/non-finite guards are deliberate and load-bearing: a finalized run may
 * be missing bankroll snapshots (pnl null), and those rows must drop out of the
 * win-rate denominator and the cumulative sum rather than poison them with NaN.
 */

import type { MissionResultDto } from "@shared/schemas/mission.js";

/** Em dash used for every missing/uncomputable figure — one canonical glyph. */
export const EM_DASH = "—";

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Trim a fixed-decimal string's trailing zeros down to (but not past)
 * `minDecimals` places. `"0.001200"` → `"0.0012"`; `"0.000000"` → `"0.0000"`.
 */
function trimDecimals(fixed: string, minDecimals: number): string {
  const [intPart = "", decPart = ""] = fixed.split(".");
  let dec = decPart;
  while (dec.length > minDecimals && dec.endsWith("0")) {
    dec = dec.slice(0, -1);
  }
  return dec.length > 0 ? `${intPart}.${dec}` : intPart;
}

/**
 * ETH amount to ~4 significant / 4–6 decimals (trailing zeros trimmed to a
 * 4-decimal floor): `0.0012`, `1.234568`. `signed` prefixes non-negative
 * values with `+` for PnL columns. `null`/non-finite → em dash.
 */
export function formatEth(
  value: number | null | undefined,
  opts: { readonly signed?: boolean } = {},
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return EM_DASH;
  }
  const body = trimDecimals(value.toFixed(6), 4);
  return opts.signed && value >= 0 ? `+${body}` : body;
}

/**
 * Duration seconds → `12m 03s`, promoting to `1h 02m 03s` past an hour.
 * `null`/non-finite/negative → em dash.
 */
export function formatDurationS(durationS: number | null | undefined): string {
  if (
    durationS === null ||
    durationS === undefined ||
    !Number.isFinite(durationS) ||
    durationS < 0
  ) {
    return EM_DASH;
  }
  const total = Math.floor(durationS);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, "0");
  if (h > 0) {
    return `${h}h ${String(m).padStart(2, "0")}m ${ss}s`;
  }
  return `${m}m ${ss}s`;
}

/**
 * Win rate as a percentage (0–100): share of missions with `pnlEth > 0`,
 * with null-pnl rows excluded from the denominator. `null` when no row has a
 * computable pnl (so the caller can render an em dash, not `0%`).
 */
export function computeWinRate(
  results: readonly MissionResultDto[],
): number | null {
  let wins = 0;
  let denom = 0;
  for (const r of results) {
    if (r.pnlEth === null || !Number.isFinite(r.pnlEth)) continue;
    denom += 1;
    if (r.pnlEth > 0) wins += 1;
  }
  return denom === 0 ? null : (wins / denom) * 100;
}

/** Cumulative ETH PnL — sum of every computable `pnlEth` (nulls skipped). */
export function sumPnlEth(results: readonly MissionResultDto[]): number {
  let sum = 0;
  for (const r of results) {
    if (r.pnlEth !== null && Number.isFinite(r.pnlEth)) sum += r.pnlEth;
  }
  return sum;
}

/**
 * Running cumulative-pnl series ordered OLDEST→NEWEST for the sparkline. Input
 * is newest-first (as the query returns it), so this reverses it; null-pnl rows
 * carry the running total forward flat rather than breaking the line.
 */
export function cumulativePnlSeries(
  results: readonly MissionResultDto[],
): number[] {
  const series: number[] = [];
  let running = 0;
  for (let i = results.length - 1; i >= 0; i -= 1) {
    const pnl = results[i]?.pnlEth ?? null;
    if (pnl !== null && Number.isFinite(pnl)) running += pnl;
    series.push(running);
  }
  return series;
}

/**
 * Map a value series to an SVG polyline `points` string inside `width`×`height`
 * with `pad` px of vertical breathing room. A flat series (all equal) pins to
 * the vertical middle; a single point centres horizontally. Empty → `""`.
 */
export function sparklinePoints(
  values: readonly number[],
  width: number,
  height: number,
  pad = 2,
): string {
  if (values.length === 0) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const flat = max === min;
  const span = flat ? 1 : max - min;
  const innerH = height - pad * 2;
  const n = values.length;
  const stepX = n > 1 ? width / (n - 1) : 0;
  return values
    .map((v, i) => {
      const x = n > 1 ? i * stepX : width / 2;
      const y = flat ? height / 2 : pad + innerH * (1 - (v - min) / span);
      return `${round2(x)},${round2(y)}`;
    })
    .join(" ");
}

/**
 * USD value of a mission's ETH PnL at close (`pnlEth * ethPriceUsdEnd`) for the
 * PnL tooltip. `null` when either input is missing — the tooltip is omitted, not
 * fabricated.
 */
export function pnlUsd(
  pnlEth: number | null | undefined,
  ethPriceUsdEnd: number | null | undefined,
): number | null {
  if (pnlEth === null || pnlEth === undefined || !Number.isFinite(pnlEth)) {
    return null;
  }
  if (
    ethPriceUsdEnd === null ||
    ethPriceUsdEnd === undefined ||
    !Number.isFinite(ethPriceUsdEnd)
  ) {
    return null;
  }
  return pnlEth * ethPriceUsdEnd;
}
