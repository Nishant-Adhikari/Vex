/**
 * LIFECYCLE GUARD — Prequote / liquidity-impact veto (#54).
 *
 * The pre-buy safety guard is what stopped mission #22's "-26% into a thin pool"
 * class of loss. This guard pins the VETO DECISION: a buy into a thin pool
 * (trade large vs pool liquidity) or a catastrophic-price-impact quote yields a
 * `fail` verdict. The execute-time prequote gate turns any `fail` verdict into a
 * hard block BEFORE the swap handler runs, so the trade is never broadcast.
 *
 * How the veto reaches "never broadcasts" (covered by referenced tests in the
 * suite index, NOT duplicated here):
 *   - fail verdict -> `evaluatePrequoteGate` returns { kind: "block" }  →
 *     `runtime-prequote-gate.test.ts` (handler is never invoked)
 *   - the broadcast primitive itself refuses under a blocked/sim context →
 *     `sim/broadcast-primitive-guard.test.ts`
 * This file guards the decision that TRIGGERS the veto — the thin-pool /
 * high-impact `fail` — using the real guard with explicit thresholds.
 */

import { describe, expect, it } from "vitest";
import {
  evaluatePriceImpactGuard,
  type PriceImpactThresholds,
} from "@vex-agent/tools/protocols/prequote/safety/price-impact.js";

const THRESHOLDS: PriceImpactThresholds = {
  maxImpact: 0.15,
  warnImpact: 0.05,
  maxLiquidityFraction: 0.25,
};

describe("prequote price-impact / liquidity veto", () => {
  it("VETOES a buy into a THIN pool (trade >= 25% of pool liquidity) -> fail", () => {
    const result = evaluatePriceImpactGuard({
      priceImpact: 0.01, // impact itself modest
      amountInUsd: 300, // but 300 / 1000 = 30% of the pool -> thin-pool fail
      liquidityUsd: 1000,
      thresholds: THRESHOLDS,
    });
    expect(result.verdict).toBe("fail");
  });

  it("VETOES a catastrophic price-impact quote (>= 15%) -> fail (the #22 case)", () => {
    const result = evaluatePriceImpactGuard({
      priceImpact: 0.26,
      amountInUsd: 10,
      liquidityUsd: 1_000_000,
      thresholds: THRESHOLDS,
    });
    expect(result.verdict).toBe("fail");
  });

  it("ALLOWS a small trade into a deep pool at low impact -> pass (no false veto)", () => {
    const result = evaluatePriceImpactGuard({
      priceImpact: 0.01,
      amountInUsd: 10,
      liquidityUsd: 1_000_000,
      thresholds: THRESHOLDS,
    });
    expect(result.verdict).toBe("pass");
  });

  it("is fail-CLOSED (unknown, disclosed) when the impact is missing/unparseable", () => {
    const result = evaluatePriceImpactGuard({
      priceImpact: null,
      amountInUsd: 10,
      liquidityUsd: 1_000_000,
      thresholds: THRESHOLDS,
    });
    expect(result.verdict).toBe("unknown");
  });
});
