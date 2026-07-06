/**
 * Pendle LP quote extraction — verdict matrix (impact / liquidity) + expiry
 * DISCLOSURE (P5). LP is NOT a fixed-rate term commitment: neither direction
 * carries a term-lock, and NO expiry is a hard `fail` (a matured market still
 * removes). The `safetyDetail.expiry` block discloses maturity for the approval
 * preview instead.
 */

import { describe, it, expect } from "vitest";

import { extractPendleLpQuote } from "@vex-agent/tools/protocols/prequote/safety/extract.js";

const FUTURE = "2099-01-01T00:00:00.000Z";
const PAST = "2000-01-01T00:00:00.000Z";
const PARAMS = { amountIn: "1", slippageBps: 50 };

function data(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    action: "add-liquidity",
    direction: "add",
    chainId: 1,
    tokenIn: { address: "0xaaa" },
    tokenOut: { address: "0xmkt" },
    market: "0xmkt",
    expiry: FUTURE,
    liquidityUsd: 3_000_000,
    priceImpact: -0.0001,
    ...over,
  };
}

describe("extractPendleLpQuote — verdicts", () => {
  it("healthy add (deep liquidity, tiny impact) → pass, NO termLock", () => {
    const e = extractPendleLpQuote(PARAMS, data())!;
    expect(e.direction).toBe("add");
    expect(e.verdict).toBe("pass");
    // LP is not a fixed lock — never emits a termLock.
    expect(e.safetyDetail.termLock).toBeUndefined();
    // Expiry is disclosed (informational), not a gate.
    expect((e.safetyDetail.expiry as Record<string, unknown>).matured).toBe(false);
  });

  it("add into an EXPIRED market → NOT a fail (matured still removes); expiry marked matured", () => {
    const e = extractPendleLpQuote(PARAMS, data({ expiry: PAST }))!;
    // Expiry is informational for LP — the verdict stays driven by liquidity/impact.
    expect(e.verdict).toBe("pass");
    expect((e.safetyDetail.expiry as Record<string, unknown>).matured).toBe(true);
    expect(e.safetyDetail.termLock).toBeUndefined();
  });

  it("thin liquidity → unknown (never a silent pass)", () => {
    const e = extractPendleLpQuote(PARAMS, data({ liquidityUsd: 1000 }))!;
    expect(e.verdict).toBe("unknown");
  });

  it("high price impact → unknown (magnitude, sign ignored)", () => {
    const e = extractPendleLpQuote(PARAMS, data({ priceImpact: -0.09 }))!;
    expect(e.verdict).toBe("unknown");
  });

  it("missing liquidity + impact → unknown", () => {
    const e = extractPendleLpQuote(PARAMS, data({ liquidityUsd: null, priceImpact: null }))!;
    expect(e.verdict).toBe("unknown");
  });

  it("remove direction surfaces direction=remove for the recorder dispatch; no termLock", () => {
    const e = extractPendleLpQuote(PARAMS, data({ action: "remove-liquidity", direction: "remove", tokenIn: { address: "0xmkt" }, tokenOut: { address: "0xaaa" } }))!;
    expect(e.direction).toBe("remove");
    expect(e.safetyDetail.termLock).toBeUndefined();
  });

  it("returns null on a missing amount or malformed data", () => {
    expect(extractPendleLpQuote({}, data())).toBeNull();
    expect(extractPendleLpQuote(PARAMS, { nonsense: true })).toBeNull();
  });
});
