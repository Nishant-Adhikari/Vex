/**
 * Pre-buy price-impact / liquidity guard — unit tests.
 *
 * Pins the loss-prevention doctrine (mission #22 lost -26% buying size into a
 * thin pool):
 *   - |impact| ≥ 15% (hard ceiling)  → fail  (BLOCKED at the gate)
 *   - 5% ≤ |impact| < 15%            → unknown + disclosed (allowed-with-warning)
 *   - |impact| < 5% (deep pool)      → pass
 *   - missing / unparseable impact   → unknown (fail-closed, never a silent pass)
 *   - trade USD ≥ 25% of pool USD    → fail  (thin-pool size guard)
 *   - favorable (negative) impact    → pass  (clamped to 0)
 * plus: env-threshold override + fail-open parse, and integration through
 * `extractQuote` for both the KyberSwap (EVM) and Uniswap providers, proving the
 * guard NEVER weakens the existing honeypot / factory `fail`.
 */

import { describe, it, expect } from "vitest";

import {
  evaluatePriceImpactGuard,
  resolvePriceImpactThresholds,
} from "@vex-agent/tools/protocols/prequote/safety/price-impact.js";
import { extractQuote } from "@vex-agent/tools/protocols/swap-prequote.js";

const EVM_TOKEN_IN = "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const EVM_TOKEN_OUT = "0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";

// ── KyberSwap (EVM) result builder — routeSummary carries impact + size ──────
function evmResult(
  routeSummary: Record<string, unknown>,
  legs: {
    tokenIn?: Record<string, unknown>;
    tokenOut?: Record<string, unknown>;
  } = {},
): Record<string, unknown> {
  return {
    chain: "base",
    chainId: 8453,
    tokenIn: { address: EVM_TOKEN_IN, symbol: "AAA", decimals: 18 },
    tokenOut: { address: EVM_TOKEN_OUT, symbol: "BBB", decimals: 18 },
    routeSummary,
    routerAddress: "0xROUTER",
    safety: {
      tokenIn: legs.tokenIn ?? { native: true },
      tokenOut: legs.tokenOut ?? { isHoneypot: false, isFOT: false, tax: 0 },
    },
  };
}

function evmVerdict(routeSummary: Record<string, unknown>, legs = {}) {
  return extractQuote("kyberswap.swap.quote", { amountIn: "1" }, evmResult(routeSummary, legs));
}

// ── Uniswap result builder ───────────────────────────────────────────────────
function uniswapResult(
  priceImpact: number | null,
  overrides: { liquidity?: Record<string, unknown>; factory?: Record<string, unknown> } = {},
): Record<string, unknown> {
  return {
    chainId: 8453,
    tokenIn: { address: EVM_TOKEN_IN, isNative: false },
    tokenOut: { address: EVM_TOKEN_OUT, isNative: false },
    priceImpact,
    safety: {
      factory: overrides.factory ?? { checked: true, allowlisted: true },
      liquidity: overrides.liquidity ?? { checked: true, usd: 500_000, aboveThreshold: true },
      fot: { suspected: false },
    },
  };
}

function uniswapVerdict(priceImpact: number | null, overrides = {}) {
  return extractQuote("uniswap.swap.quote", { amountIn: "1" }, uniswapResult(priceImpact, overrides));
}

// ── The pure guard ───────────────────────────────────────────────────────────

describe("evaluatePriceImpactGuard — price-impact leg", () => {
  it("high impact (≥15%) → fail, disclosed high", () => {
    const r = evaluatePriceImpactGuard({ priceImpact: 0.2 });
    expect(r.verdict).toBe("fail");
    expect(r.detail.priceImpact).toEqual({ checked: true, magnitude: 0.2, high: true });
  });

  it("impact exactly at the 15% ceiling → fail (inclusive)", () => {
    expect(evaluatePriceImpactGuard({ priceImpact: 0.15 }).verdict).toBe("fail");
  });

  it("moderate impact (5%–15%) → unknown + disclosed high", () => {
    const r = evaluatePriceImpactGuard({ priceImpact: 0.08 });
    expect(r.verdict).toBe("unknown");
    expect(r.detail.priceImpact).toEqual({ checked: true, magnitude: 0.08, high: true });
  });

  it("impact exactly at the 5% warn threshold → unknown (inclusive)", () => {
    expect(evaluatePriceImpactGuard({ priceImpact: 0.05 }).verdict).toBe("unknown");
  });

  it("low impact (<5%) → pass, disclosed not-high", () => {
    const r = evaluatePriceImpactGuard({ priceImpact: 0.01 });
    expect(r.verdict).toBe("pass");
    expect(r.detail.priceImpact).toEqual({ checked: true, magnitude: 0.01, high: false });
  });

  it("favorable (negative) impact clamps to 0 → pass", () => {
    const r = evaluatePriceImpactGuard({ priceImpact: -0.3 });
    expect(r.verdict).toBe("pass");
    expect(r.detail.priceImpact).toEqual({ checked: true, magnitude: 0, high: false });
  });

  it("missing impact (null) → unknown, fail-closed disclosure (never a silent pass)", () => {
    const r = evaluatePriceImpactGuard({ priceImpact: null });
    expect(r.verdict).toBe("unknown");
    expect(r.detail.priceImpact).toEqual({ checked: false });
  });

  it("non-finite impact (NaN) → unknown (fail-closed)", () => {
    const r = evaluatePriceImpactGuard({ priceImpact: Number.NaN });
    expect(r.verdict).toBe("unknown");
    expect(r.detail.priceImpact).toEqual({ checked: false });
  });
});

describe("evaluatePriceImpactGuard — trade-size-vs-liquidity leg", () => {
  it("large trade vs thin liquidity (≥25%) → fail even with low impact", () => {
    // 30k trade into a 100k pool = 30% ≥ 25% ceiling.
    const r = evaluatePriceImpactGuard({ priceImpact: 0.01, amountInUsd: 30_000, liquidityUsd: 100_000 });
    expect(r.verdict).toBe("fail");
    expect(r.detail.liquidityImpact).toEqual({ checked: true, fraction: 0.3, high: true });
  });

  it("small trade vs deep liquidity → pass, disclosed not-high", () => {
    const r = evaluatePriceImpactGuard({ priceImpact: 0.01, amountInUsd: 1_000, liquidityUsd: 1_000_000 });
    expect(r.verdict).toBe("pass");
    expect(r.detail.liquidityImpact).toEqual({ checked: true, fraction: 0.001, high: false });
  });

  it("fail-OPEN: missing liquidity → fraction leg does not apply (impact governs)", () => {
    const r = evaluatePriceImpactGuard({ priceImpact: 0.01, amountInUsd: 30_000, liquidityUsd: null });
    expect(r.verdict).toBe("pass");
    expect(r.detail.liquidityImpact).toBeUndefined();
  });

  it("fail-OPEN: missing trade size → fraction leg does not apply", () => {
    const r = evaluatePriceImpactGuard({ priceImpact: 0.01, amountInUsd: null, liquidityUsd: 100_000 });
    expect(r.verdict).toBe("pass");
    expect(r.detail.liquidityImpact).toBeUndefined();
  });

  it("worst-wins: a fraction-fail dominates a passing impact leg", () => {
    const r = evaluatePriceImpactGuard({ priceImpact: 0.001, amountInUsd: 50_000, liquidityUsd: 100_000 });
    expect(r.verdict).toBe("fail");
  });
});

describe("resolvePriceImpactThresholds — env override + fail-open parse", () => {
  it("defaults when env is unset", () => {
    expect(resolvePriceImpactThresholds({})).toEqual({
      maxImpact: 0.15,
      warnImpact: 0.05,
      maxLiquidityFraction: 0.25,
    });
  });

  it("honors valid bps overrides", () => {
    const t = resolvePriceImpactThresholds({
      AGENT_SWAP_MAX_PRICE_IMPACT_BPS: "1000",
      AGENT_SWAP_WARN_PRICE_IMPACT_BPS: "200",
      AGENT_SWAP_MAX_LIQUIDITY_FRACTION_BPS: "1000",
    });
    expect(t).toEqual({ maxImpact: 0.1, warnImpact: 0.02, maxLiquidityFraction: 0.1 });
  });

  it("fail-open: garbage / negative / out-of-range → default", () => {
    expect(
      resolvePriceImpactThresholds({
        AGENT_SWAP_MAX_PRICE_IMPACT_BPS: "abc",
        AGENT_SWAP_WARN_PRICE_IMPACT_BPS: "-5",
        AGENT_SWAP_MAX_LIQUIDITY_FRACTION_BPS: "99999", // > 100%
      }),
    ).toEqual({ maxImpact: 0.15, warnImpact: 0.05, maxLiquidityFraction: 0.25 });
  });

  it("a tightened env ceiling flips a mid-impact quote from unknown to fail", () => {
    const tight = resolvePriceImpactThresholds({ AGENT_SWAP_MAX_PRICE_IMPACT_BPS: "700" });
    expect(evaluatePriceImpactGuard({ priceImpact: 0.08, thresholds: tight }).verdict).toBe("fail");
  });
});

// ── Integration through extractQuote (EVM / KyberSwap) ───────────────────────

describe("extractQuote — KyberSwap price-impact integration", () => {
  it("high-impact quote → fail (blocked)", () => {
    expect(evmVerdict({ priceImpact: 0.2, amountInUsd: "100" })?.verdict).toBe("fail");
  });

  it("moderate-impact quote → unknown, disclosed in safetyDetail", () => {
    const q = evmVerdict({ priceImpact: 0.07, amountInUsd: "100" });
    expect(q?.verdict).toBe("unknown");
    expect(q?.safetyDetail.priceImpact).toEqual({ checked: true, magnitude: 0.07, high: true });
  });

  it("low-impact clean quote → pass", () => {
    expect(evmVerdict({ priceImpact: 0.002, amountInUsd: "100" })?.verdict).toBe("pass");
  });

  it("null impact → unknown (fail-closed)", () => {
    const q = evmVerdict({ priceImpact: null, amountInUsd: "100" });
    expect(q?.verdict).toBe("unknown");
    expect(q?.safetyDetail.priceImpact).toEqual({ checked: false });
  });

  it("absent routeSummary → impact leg unknown (never a silent pass)", () => {
    const data = evmResult({});
    delete (data as Record<string, unknown>).routeSummary;
    const q = extractQuote("kyberswap.swap.quote", { amountIn: "1" }, data);
    expect(q?.verdict).toBe("unknown");
    expect(q?.safetyDetail.priceImpact).toEqual({ checked: false });
  });

  it("guard NEVER weakens a honeypot fail: honeypot + low impact → fail", () => {
    const q = evmVerdict(
      { priceImpact: 0.002, amountInUsd: "100" },
      { tokenOut: { isHoneypot: true, isFOT: false, tax: 0 } },
    );
    expect(q?.verdict).toBe("fail");
  });

  it("high-impact + honeypot → fail (both agree, fail dominates)", () => {
    const q = evmVerdict(
      { priceImpact: 0.5, amountInUsd: "100" },
      { tokenOut: { isHoneypot: true, isFOT: false, tax: 0 } },
    );
    expect(q?.verdict).toBe("fail");
  });
});

// ── Integration through extractQuote (Uniswap) ───────────────────────────────

describe("extractQuote — Uniswap price-impact integration", () => {
  it("high-impact quote → fail", () => {
    expect(uniswapVerdict(0.2)?.verdict).toBe("fail");
  });

  it("moderate-impact quote → unknown, disclosed", () => {
    const q = uniswapVerdict(0.08);
    expect(q?.verdict).toBe("unknown");
    expect(q?.safetyDetail.priceImpact).toEqual({ checked: true, magnitude: 0.08, high: true });
  });

  it("low-impact deep-liquidity quote → pass", () => {
    expect(uniswapVerdict(0.01)?.verdict).toBe("pass");
  });

  it("null impact (V3 / multi-hop) → unknown (fail-closed)", () => {
    const q = uniswapVerdict(null);
    expect(q?.verdict).toBe("unknown");
    expect(q?.safetyDetail.priceImpact).toEqual({ checked: false });
  });

  it("guard NEVER weakens a spoofed-factory fail: not-allowlisted + low impact → fail", () => {
    const q = uniswapVerdict(0.01, { factory: { checked: true, allowlisted: false } });
    expect(q?.verdict).toBe("fail");
  });

  it("high impact does not downgrade a factory fail (still fail)", () => {
    const q = uniswapVerdict(0.3, { factory: { checked: true, allowlisted: false } });
    expect(q?.verdict).toBe("fail");
  });
});
