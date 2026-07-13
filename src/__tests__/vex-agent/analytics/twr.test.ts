/**
 * Time-Weighted Return (TWR) math — pure-function unit tests (TDD, Part 1).
 *
 * The bug these guard against: portfolio "return" was computed naively as
 * `(last - first) / first` over `proj_portfolio_snapshots.total_usd`, which
 * counts DEPOSITS and WITHDRAWALS as PnL. A wallet that withdrew ~2 ETH and
 * then traded UP still showed a large NEGATIVE "all time" return, because the
 * withdrawal dragged the raw series down.
 *
 * TWR neutralises external cash flows by splitting the series into sub-periods
 * at each flow and chaining the per-sub-period growth factors. A flow at time
 * `t` moves the base for the NEXT sub-period (value just after = value just
 * before + flow), so it never shows up as a gain or a loss.
 *
 * Sign convention for flows: `+usd` = deposit (cash IN), `-usd` = withdrawal
 * (cash OUT). Returns are fractions: 0.5 = +50%, -0.44 = -44%.
 */

import { describe, it, expect } from "vitest";

import {
  timeWeightedReturn,
  netFlowAdjustedPnlUsd,
  type Point,
  type Flow,
} from "@vex-agent/analytics/twr.js";

const p = (t: number, valueUsd: number): Point => ({ t, valueUsd });
const f = (t: number, usd: number): Flow => ({ t, usd });

describe("timeWeightedReturn", () => {
  it("returns 0 for an empty series", () => {
    expect(timeWeightedReturn([], [])).toBe(0);
  });

  it("returns 0 for a single point (no interval to measure)", () => {
    expect(timeWeightedReturn([p(1, 100)], [])).toBe(0);
  });

  it("pure trading up 100 -> 200 with no flows is +100%", () => {
    expect(timeWeightedReturn([p(1, 100), p(2, 200)], [])).toBeCloseTo(1.0, 10);
  });

  it("pure trading down 100 -> 50 with no flows is -50%", () => {
    expect(timeWeightedReturn([p(1, 100), p(2, 50)], [])).toBeCloseTo(-0.5, 10);
  });

  it("DEPOSIT then flat is ~0% (a deposit is NOT a gain)", () => {
    // Value 100, deposit +50 mid-way, series ends at 150 purely because of the
    // deposit. TWR must read this as flat, not +50%.
    const points = [p(1, 100), p(3, 150)];
    const flows = [f(2, 50)];
    expect(timeWeightedReturn(points, flows)).toBeCloseTo(0, 10);
  });

  it("WITHDRAW then flat is ~0% (a withdrawal is NOT a loss) — the headline bug", () => {
    // Value 100, withdraw -50 mid-way, series ends at 50 purely because of the
    // withdrawal. Naive return would say -50%; TWR must say ~0%.
    const points = [p(1, 100), p(3, 50)];
    const flows = [f(2, -50)];
    expect(timeWeightedReturn(points, flows)).toBeCloseTo(0, 10);
  });

  it("gain THEN withdrawal keeps the gain: 100 ->150, withdraw 50 (->100), flat => +50%", () => {
    // The +50% trading gain happened BEFORE the withdrawal; pulling cash out
    // must not erase it.
    const points = [p(1, 100), p(2, 150), p(4, 100)];
    const flows = [f(3, -50)];
    expect(timeWeightedReturn(points, flows)).toBeCloseTo(0.5, 10);
  });

  it("two flows between the SAME two snapshots aggregate into one base adjustment (~0%)", () => {
    // The headline multi-flow bug: two deposits fall between the SAME adjacent
    // snapshots (t=1 $100 and t=4 $200) with NO snapshot in between. The two
    // +$50 deposits ($100 total) exactly explain the $100→$200 rise, so TWR is
    // FLAT (0%). The buggy loop closed a sub-period per-flow against the stale
    // $100 snapshot, multiplying an extra 100/150 factor → −11.11%.
    const points = [p(1, 100), p(4, 200)];
    const flows = [f(2, 50), f(3, 50)];
    expect(timeWeightedReturn(points, flows)).toBeCloseTo(0, 10);
  });

  it("handles multiple flows across the series", () => {
    // Sub 1: 100 -> 120 (growth 1.2), then deposit +80 -> base 200
    // Sub 2: 200 -> 240 (growth 1.2), then withdraw -40 -> base 200
    // Sub 3: 200 -> 300 (growth 1.5)
    // TWR = 1.2 * 1.2 * 1.5 - 1 = 1.16 = +116%
    const points = [p(1, 100), p(2, 120), p(4, 240), p(6, 300)];
    const flows = [f(3, 80), f(5, -40)];
    expect(timeWeightedReturn(points, flows)).toBeCloseTo(1.16, 10);
  });

  it("EVM-3 reconciliation: big withdrawal + trade-up reads STRONGLY POSITIVE, not -44%", () => {
    // Representative of wallet 0x384c...C23e: first=4605, drifts to ~4600,
    // a ~-3550 withdrawal drops it to ~1050, then it TRADES UP to 2613.
    // Naive: (2613 - 4605) / 4605 = -43.3% (the reported -44%).
    // TWR: (4600/4605) * (2613/1050) - 1 = +148.5%.
    const points = [p(1, 4605), p(2, 4600), p(4, 1050), p(6, 2613)];
    const flows = [f(3, -3550)];
    const twr = timeWeightedReturn(points, flows);
    const naive = (2613 - 4605) / 4605;
    expect(naive).toBeCloseTo(-0.433, 2);
    expect(twr).toBeGreaterThan(1.0); // > +100%
    expect(twr).toBeCloseTo((4600 / 4605) * (2613 / 1050) - 1, 6);
  });

  it("guards divide-by-zero: a zero sub-period base contributes a neutral factor", () => {
    // Start at 0, deposit +100, then trade to 150. The zero-base opening
    // sub-period can't yield a return; it must not produce Infinity/NaN.
    const points = [p(1, 0), p(3, 150)];
    const flows = [f(2, 100)];
    const twr = timeWeightedReturn(points, flows);
    expect(Number.isFinite(twr)).toBe(true);
    expect(twr).toBeCloseTo(0.5, 10); // 150/100 - 1
  });

  it("returns 0 (not NaN) when values are non-finite", () => {
    expect(timeWeightedReturn([p(1, Number.NaN), p(2, 100)], [])).toBe(0);
    expect(timeWeightedReturn([p(1, 100), p(2, Number.POSITIVE_INFINITY)], [])).toBe(0);
  });

  it("treats a point at the same timestamp as a flow as the PRE-flow value", () => {
    // Point 150 and withdrawal -50 share t=2; the 150 is the value BEFORE the
    // withdrawal, so post-flow base is 100 and the flat tail is +50% overall.
    const points = [p(1, 100), p(2, 150), p(3, 100)];
    const flows = [f(2, -50)];
    expect(timeWeightedReturn(points, flows)).toBeCloseTo(0.5, 10);
  });
});

describe("netFlowAdjustedPnlUsd", () => {
  it("returns 0 for empty / single-point series", () => {
    expect(netFlowAdjustedPnlUsd([], [])).toBe(0);
    expect(netFlowAdjustedPnlUsd([p(1, 100)], [])).toBe(0);
  });

  it("is end - start with no flows", () => {
    expect(netFlowAdjustedPnlUsd([p(1, 100), p(2, 250)], [])).toBeCloseTo(150, 10);
  });

  it("subtracts a net deposit so it is not counted as PnL", () => {
    // 100 -> 150 but +50 was deposited: real PnL is 0.
    expect(netFlowAdjustedPnlUsd([p(1, 100), p(2, 150)], [f(1, 50)])).toBeCloseTo(0, 10);
  });

  it("adds back a net withdrawal so the trade-up shows through (EVM-3)", () => {
    // end 2613 - start 4605 - (-3550 withdrawn) = +1558 real PnL.
    expect(
      netFlowAdjustedPnlUsd([p(1, 4605), p(2, 2613)], [f(1, -3550)]),
    ).toBeCloseTo(1558, 10);
  });

  it("returns 0 (not NaN) for non-finite inputs", () => {
    expect(netFlowAdjustedPnlUsd([p(1, Number.NaN), p(2, 100)], [])).toBe(0);
  });
});
