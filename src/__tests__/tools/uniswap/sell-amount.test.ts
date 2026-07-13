/**
 * Uniswap sell-live-balance resolver (exit-guards Fix #2).
 *
 * Exits require the quote's `amountIn` to match the held balance, but balances
 * DRIFT from entry figures (settlement rounding, fee-on-transfer) → repeated
 * "insufficient balance" + re-quote churn (wasted gas). The resolver lets the
 * agent sell the EXACT live on-chain balance via the sentinel `amountIn: "max"`
 * (or a `sellFraction`). A normal numeric `amountIn` is parsed unchanged.
 */

import { describe, it, expect } from "vitest";
import { parseUnits } from "viem";

import {
  resolveSellAmount,
  isMaxSellSentinel,
  SELL_MAX_SENTINEL,
} from "@tools/uniswap/sell-amount.js";
import { ErrorCodes } from "../../../errors.js";

// Drifted live balance from the incident: entry rounded to 184.99, on-chain 184.9855.
const LIVE = 184985498895318795602n;

describe("isMaxSellSentinel", () => {
  it("matches the sentinel case-insensitively and trimmed", () => {
    expect(isMaxSellSentinel("max")).toBe(true);
    expect(isMaxSellSentinel("MAX")).toBe(true);
    expect(isMaxSellSentinel("  Max ")).toBe(true);
    expect(isMaxSellSentinel(SELL_MAX_SENTINEL)).toBe(true);
  });
  it("does not match numeric amounts", () => {
    expect(isMaxSellSentinel("184.99")).toBe(false);
    expect(isMaxSellSentinel("maximum")).toBe(false);
    expect(isMaxSellSentinel("")).toBe(false);
  });
});

describe("resolveSellAmount", () => {
  it('"max" resolves to the EXACT live balance (kills drift churn)', () => {
    expect(resolveSellAmount({ amountInRaw: "max", tokenInDecimals: 18, liveBalance: LIVE })).toBe(LIVE);
  });

  it("a normal numeric amountIn is parsed unchanged (backward-compatible)", () => {
    expect(resolveSellAmount({ amountInRaw: "184.98", tokenInDecimals: 18, liveBalance: LIVE }))
      .toBe(parseUnits("184.98", 18));
    // The resolver must NOT clamp a numeric amount to the balance — the existing
    // ensureUniswapSufficientBalance guard owns that decision.
    expect(resolveSellAmount({ amountInRaw: "999", tokenInDecimals: 18, liveBalance: LIVE }))
      .toBe(parseUnits("999", 18));
  });

  it("sellFraction resolves a fraction of the live balance", () => {
    expect(resolveSellAmount({ amountInRaw: "max", tokenInDecimals: 18, liveBalance: 1000n, sellFraction: 0.5 })).toBe(500n);
    expect(resolveSellAmount({ amountInRaw: "0", tokenInDecimals: 18, liveBalance: LIVE, sellFraction: 1 })).toBe(LIVE);
  });

  it("sellFraction overrides a numeric amountIn (fraction of holdings wins)", () => {
    expect(resolveSellAmount({ amountInRaw: "5", tokenInDecimals: 18, liveBalance: 1000n, sellFraction: 0.25 })).toBe(250n);
  });

  it("never resolves above the live balance", () => {
    const amt = resolveSellAmount({ amountInRaw: "max", tokenInDecimals: 18, liveBalance: LIVE, sellFraction: 1 });
    expect(amt).toBeLessThanOrEqual(LIVE);
  });

  it("rejects an out-of-range sellFraction with INVALID_AMOUNT", () => {
    for (const bad of [0, -0.5, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => resolveSellAmount({ amountInRaw: "max", tokenInDecimals: 18, liveBalance: LIVE, sellFraction: bad }))
        .toThrowError(expect.objectContaining({ code: ErrorCodes.INVALID_AMOUNT }));
    }
  });
});
