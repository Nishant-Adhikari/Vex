/**
 * Uniswap quote plausibility guard (exit-guards Fix #1).
 *
 * A live mission passed a RAW WEI value (`48740243348995839475968`) as `amountIn`
 * where human units (`48740.24`) were expected. `parseUnits` scaled it by 10^18
 * AGAIN, yielding a nonsense quote (~19.9 ETH out) that derailed the agent for
 * ~30 min. The guard is ADDITIVE (an advisory `warning` string) and NEVER blocks
 * a quote — it only flags the likely wrong-units / pool-draining cause.
 */

import { describe, it, expect } from "vitest";

import {
  isImplausibleQuote,
  looksLikeRawWei,
  EXTREME_PRICE_IMPACT,
} from "@tools/uniswap/plausibility.js";

const WEI_AS_HUMAN = "48740243348995839475968"; // the incident value (23 digits, 18-dec token)

describe("looksLikeRawWei", () => {
  it("flags a pure-integer string with >= decimals digits (wei-as-human)", () => {
    expect(looksLikeRawWei(WEI_AS_HUMAN, 18)).toBe(true);
  });

  it("does NOT flag a normal human amount with a decimal point", () => {
    expect(looksLikeRawWei("48740.24", 18)).toBe(false);
  });

  it("does NOT flag a small integer human amount", () => {
    expect(looksLikeRawWei("100", 18)).toBe(false);
    expect(looksLikeRawWei("1000000", 18)).toBe(false); // 1M tokens, 7 digits
  });

  it("does NOT flag a large legit meme amount below the digit floor", () => {
    // 1 quadrillion (10^15) of an 18-dec token — 16 digits < 18 threshold.
    expect(looksLikeRawWei("1000000000000000", 18)).toBe(false);
  });

  it("does NOT false-positive on large low-decimal amounts (USDC 6-dec, 1M)", () => {
    // Floor of 15 digits protects 6-dec tokens: 1,000,000 USDC = 7 digits.
    expect(looksLikeRawWei("1000000", 6)).toBe(false);
    expect(looksLikeRawWei("999999999", 6)).toBe(false); // ~1B USDC, 9 digits
  });

  it("ignores leading zeros when counting significant digits", () => {
    expect(looksLikeRawWei("0000000000000000100", 18)).toBe(false); // 3 significant digits
  });

  it("rejects non-integer / signed / scientific strings", () => {
    expect(looksLikeRawWei("1e21", 18)).toBe(false);
    expect(looksLikeRawWei("-48740243348995839475968", 18)).toBe(false);
    expect(looksLikeRawWei("  ", 18)).toBe(false);
  });
});

describe("isImplausibleQuote", () => {
  it("returns a warning naming wrong-units for a raw-wei amountIn", () => {
    const w = isImplausibleQuote({ amountInRaw: WEI_AS_HUMAN, tokenInDecimals: 18, priceImpact: null });
    expect(w).toBeTruthy();
    expect(w).toMatch(/wrong units|raw wei|human units/i);
  });

  it("returns a warning for extreme price impact even with a plausible amountIn", () => {
    const w = isImplausibleQuote({ amountInRaw: "100", tokenInDecimals: 18, priceImpact: 0.99 });
    expect(w).toBeTruthy();
    expect(w).toMatch(/price impact|pool-draining|liquidity/i);
  });

  it("uses the threshold constant as the extreme cut-off", () => {
    expect(isImplausibleQuote({ amountInRaw: "100", tokenInDecimals: 18, priceImpact: EXTREME_PRICE_IMPACT })).toBeTruthy();
    expect(isImplausibleQuote({ amountInRaw: "100", tokenInDecimals: 18, priceImpact: EXTREME_PRICE_IMPACT - 0.01 })).toBeNull();
  });

  it("returns null for a normal, plausible quote (backward-compatible happy path)", () => {
    expect(isImplausibleQuote({ amountInRaw: "10", tokenInDecimals: 18, priceImpact: 0.012 })).toBeNull();
    expect(isImplausibleQuote({ amountInRaw: "1000000", tokenInDecimals: 6, priceImpact: null })).toBeNull();
    expect(isImplausibleQuote({ amountInRaw: "48740.24", tokenInDecimals: 18, priceImpact: null })).toBeNull();
  });

  it("treats a missing/NaN price impact as no impact signal", () => {
    expect(isImplausibleQuote({ amountInRaw: "10", tokenInDecimals: 18 })).toBeNull();
    expect(isImplausibleQuote({ amountInRaw: "10", tokenInDecimals: 18, priceImpact: Number.NaN })).toBeNull();
  });
});
