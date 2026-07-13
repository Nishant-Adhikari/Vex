/**
 * Time-Weighted Return (TWR) — pure portfolio-return math that neutralises
 * external cash flows (deposits / withdrawals).
 *
 * WHY: portfolio "return" was computed naively as `(last - first) / first`
 * over the `proj_portfolio_snapshots.total_usd` series. That treats every
 * deposit as a gain and every WITHDRAWAL as a loss — so a wallet that pulled
 * ~2 ETH out and then traded UP still reported a large NEGATIVE "all time"
 * return (the real EVM-3 case: -44%). TWR fixes this by splitting the series
 * into sub-periods at each cash flow and chaining the per-sub-period growth
 * factors, so a flow moves the base for the next sub-period instead of
 * showing up as PnL.
 *
 * This module is PURE: no I/O, no clock, no dependencies. It is the reviewed,
 * safe core — cash-flow DETECTION (which transfers are external) lives
 * separately in `./native-cash-flows.ts`; this file only does the arithmetic
 * once someone hands it points + flows.
 *
 * Conventions:
 *  - `Point.t` / `Flow.t` are epoch-ms timestamps.
 *  - `Flow.usd`: `+` = deposit (cash IN), `-` = withdrawal (cash OUT).
 *  - `timeWeightedReturn` returns a FRACTION: 0.5 = +50%, -0.44 = -44%.
 *  - Degenerate inputs (empty, single point, non-finite) return 0 — never NaN
 *    or Infinity — so a caller can always fall back cleanly.
 */

/** One portfolio value observation (a snapshot's total USD at a point in time). */
export interface Point {
  /** Epoch milliseconds. */
  readonly t: number;
  readonly valueUsd: number;
}

/** One external cash flow: `+usd` deposit (in), `-usd` withdrawal (out). */
export interface Flow {
  /** Epoch milliseconds. */
  readonly t: number;
  readonly usd: number;
}

/**
 * Time-weighted return over `points`, neutralising the external `flows`.
 *
 * Method (matches the standard linked TWR):
 *  1. Order points and flows by time (points sort BEFORE a flow at the same
 *     instant — a snapshot at the flow time is the PRE-flow value).
 *  2. Walk the timeline. Track the current sub-period's opening base and the
 *     latest observed snapshot value.
 *  3. At each flow, close the sub-period: growth = latestValue / base; then
 *     open the next sub-period with base = latestValue + flow.usd (the flow
 *     never counts as return).
 *  4. Close the final sub-period at the last snapshot.
 *  5. TWR = Π(growthᵢ) − 1.
 *
 * A sub-period whose opening base is ≤ 0 (or whose endpoints are non-finite)
 * contributes a NEUTRAL factor of 1 rather than dividing by zero. Empty or
 * single-point series, or any non-finite result, yield 0.
 */
export function timeWeightedReturn(
  points: readonly Point[],
  flows: readonly Flow[],
): number {
  if (points.length < 2) return 0;

  // All snapshot values must be finite for a trustworthy chained product; a
  // single bad value collapses the whole thing to the safe 0 fallback.
  for (const point of points) {
    if (!Number.isFinite(point.valueUsd) || !Number.isFinite(point.t)) return 0;
  }

  // Only flows that fall inside the observed window can be attributed to a
  // sub-period boundary; a finite, in-range flow list keeps the split honest.
  const first = points[0]!;
  const last = points[points.length - 1]!;
  const usableFlows = flows
    .filter(
      (flow) =>
        Number.isFinite(flow.usd) &&
        Number.isFinite(flow.t) &&
        flow.t >= first.t &&
        flow.t <= last.t,
    )
    .slice()
    .sort((a, b) => a.t - b.t);

  const sortedPoints = points.slice().sort((a, b) => a.t - b.t);

  let product = 1;
  let base = sortedPoints[0]!.valueUsd; // opening base of the current sub-period
  let latest = sortedPoints[0]!.valueUsd; // latest snapshot value seen so far
  let pointIdx = 1; // sortedPoints[0] is the opening value, already consumed

  const closeSubPeriod = (endValue: number): void => {
    // Guard divide-by-zero / negative base: contribute a neutral factor.
    if (base > 0 && Number.isFinite(endValue) && Number.isFinite(base)) {
      product *= endValue / base;
    }
  };

  for (const flow of usableFlows) {
    // Advance through every snapshot at or before this flow — points sort
    // before a flow at the same instant, so `<=` makes an equal-timestamp
    // snapshot the PRE-flow value.
    while (pointIdx < sortedPoints.length && sortedPoints[pointIdx]!.t <= flow.t) {
      latest = sortedPoints[pointIdx]!.valueUsd;
      pointIdx += 1;
    }
    // Close the sub-period at the pre-flow value, then re-base past the flow.
    closeSubPeriod(latest);
    base = latest + flow.usd;
  }

  // Consume any remaining snapshots and close the final sub-period at the last.
  while (pointIdx < sortedPoints.length) {
    latest = sortedPoints[pointIdx]!.valueUsd;
    pointIdx += 1;
  }
  closeSubPeriod(latest);

  const twr = product - 1;
  return Number.isFinite(twr) ? twr : 0;
}

/**
 * Net-flow-adjusted PnL in USD: `endValue − startValue − Σ flows`.
 *
 * Removing the summed external flows leaves only the value change attributable
 * to trading. A net deposit (+) is subtracted (not a gain); a net withdrawal
 * (−) is added back (the trade-up it masked shows through). Empty / single
 * point / non-finite → 0.
 */
export function netFlowAdjustedPnlUsd(
  points: readonly Point[],
  flows: readonly Flow[],
): number {
  if (points.length < 2) return 0;

  const sorted = points.slice().sort((a, b) => a.t - b.t);
  const start = sorted[0]!.valueUsd;
  const end = sorted[sorted.length - 1]!.valueUsd;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;

  let flowSum = 0;
  for (const flow of flows) {
    if (Number.isFinite(flow.usd)) flowSum += flow.usd;
  }

  const pnl = end - start - flowSum;
  return Number.isFinite(pnl) ? pnl : 0;
}
