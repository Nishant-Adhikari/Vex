import { describe, expect, it } from "vitest";
import {
  applySimFill,
  valueSimPosition,
  EMPTY_SIM_POSITION,
  type SimSwapFill,
} from "@vex-agent/sim/paper-fill.js";

function buy(overrides: Partial<SimSwapFill> = {}): SimSwapFill {
  return {
    side: "buy",
    chain: "robinhood",
    dex: "uniswap",
    tokenAddress: "0xtok",
    tokenSymbol: "TKN",
    tokenQty: 1000,
    nativeValue: 1,
    priceImpact: 0.01,
    ...overrides,
  };
}

function sell(overrides: Partial<SimSwapFill> = {}): SimSwapFill {
  return { ...buy(), side: "sell", ...overrides };
}

describe("applySimFill", () => {
  it("a buy opens a position: qty and native cost basis accumulate, no realized PnL", () => {
    const { next, realizedDelta, closed } = applySimFill(EMPTY_SIM_POSITION, buy({ tokenQty: 1000, nativeValue: 2 }));
    expect(next.qty).toBe(1000);
    expect(next.costNative).toBe(2);
    expect(next.realizedPnlNative).toBe(0);
    expect(realizedDelta).toBe(0);
    expect(closed).toBe(false);
  });

  it("a second buy averages into the same position", () => {
    const first = applySimFill(EMPTY_SIM_POSITION, buy({ tokenQty: 1000, nativeValue: 2 })).next;
    const second = applySimFill(first, buy({ tokenQty: 500, nativeValue: 1.5 })).next;
    expect(second.qty).toBe(1500);
    expect(second.costNative).toBe(3.5);
  });

  it("a full sell realizes proceeds minus the whole cost basis and closes the position", () => {
    const opened = applySimFill(EMPTY_SIM_POSITION, buy({ tokenQty: 1000, nativeValue: 2 })).next;
    // Sell all 1000 for 3 native → realized = 3 - 2 = +1.
    const { next, realizedDelta, closed } = applySimFill(opened, sell({ tokenQty: 1000, nativeValue: 3 }));
    expect(realizedDelta).toBeCloseTo(1, 12);
    expect(closed).toBe(true);
    expect(next.qty).toBe(0);
    expect(next.costNative).toBe(0);
    expect(next.realizedPnlNative).toBeCloseTo(1, 12);
  });

  it("a partial sell realizes only the proportional cost basis", () => {
    const opened = applySimFill(EMPTY_SIM_POSITION, buy({ tokenQty: 1000, nativeValue: 2 })).next;
    // Sell half (500) for 1.5 native → costRemoved = 1, realized = 1.5 - 1 = +0.5.
    const { next, realizedDelta, closed } = applySimFill(opened, sell({ tokenQty: 500, nativeValue: 1.5 }));
    expect(realizedDelta).toBeCloseTo(0.5, 12);
    expect(closed).toBe(false);
    expect(next.qty).toBe(500);
    expect(next.costNative).toBeCloseTo(1, 12);
    expect(next.realizedPnlNative).toBeCloseTo(0.5, 12);
  });

  it("a losing sell realizes a negative delta", () => {
    const opened = applySimFill(EMPTY_SIM_POSITION, buy({ tokenQty: 1000, nativeValue: 2 })).next;
    const { realizedDelta } = applySimFill(opened, sell({ tokenQty: 1000, nativeValue: 1.2 }));
    expect(realizedDelta).toBeCloseTo(-0.8, 12);
  });

  it("selling more than held clamps to the held quantity and still closes", () => {
    const opened = applySimFill(EMPTY_SIM_POSITION, buy({ tokenQty: 1000, nativeValue: 2 })).next;
    const { next, closed } = applySimFill(opened, sell({ tokenQty: 5000, nativeValue: 3 }));
    expect(closed).toBe(true);
    expect(next.qty).toBe(0);
  });

  it("a token<->token leg (null nativeValue) moves qty but realizes no native PnL", () => {
    const opened = applySimFill(EMPTY_SIM_POSITION, buy({ tokenQty: 1000, nativeValue: 2 })).next;
    const { next, realizedDelta } = applySimFill(opened, sell({ tokenQty: 500, nativeValue: null }));
    expect(realizedDelta).toBe(0);
    expect(next.qty).toBe(500);
  });
});

describe("valueSimPosition", () => {
  it("marks to market and reports unrealized PnL vs cost basis", () => {
    const opened = applySimFill(EMPTY_SIM_POSITION, buy({ tokenQty: 1000, nativeValue: 2 })).next;
    // price 0.0025 native/token → 1000 * 0.0025 = 2.5 value; unrealized = 0.5.
    const { marketValueNative, unrealizedPnlNative } = valueSimPosition(opened, 0.0025);
    expect(marketValueNative).toBeCloseTo(2.5, 12);
    expect(unrealizedPnlNative).toBeCloseTo(0.5, 12);
  });
});
