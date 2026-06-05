/**
 * transactions failure classifier — Stage 9 unit tests.
 *
 * Pins:
 *   - the allowlist is derived from MUTATION_MATRIX.expectedType → TYPE_TO_PRODUCT
 *     and contains ONLY trade-impacting tools (product ∈ {spot,perps,prediction,
 *     bridge,order}).
 *   - non-trade mutating tools (lend/stake/lp/utility) are EXCLUDED.
 *   - read tools are never present (they are not in MUTATION_MATRIX at all).
 *   - the productType-scoped allowlist filters by DERIVED PRODUCT.
 */

import { describe, it, expect } from "vitest";
import {
  FAILURE_TOOL_ALLOWLIST,
  FAILURE_TOOL_PRODUCTS,
  TRANSACTION_PRODUCTS,
  failureToolsForProduct,
} from "@vex-agent/db/repos/transactions-failure-tools.js";

describe("transactions failure classifier", () => {
  it("every allowlisted tool maps to a transaction product", () => {
    for (const toolId of FAILURE_TOOL_ALLOWLIST) {
      const product = FAILURE_TOOL_PRODUCTS.get(toolId);
      expect(product, `${toolId} has no product`).toBeDefined();
      expect(TRANSACTION_PRODUCTS.has(product!), `${toolId} → ${product} not a tx product`).toBe(true);
    }
  });

  it("includes trade-impacting tools across spot/perps→? + prediction + order + bridge", () => {
    // Spot (swaps)
    expect(FAILURE_TOOL_PRODUCTS.get("solana.swap.execute")).toBe("spot");
    expect(FAILURE_TOOL_PRODUCTS.get("kyberswap.swap.buy")).toBe("spot");
    // Prediction
    expect(FAILURE_TOOL_PRODUCTS.get("solana.predict.buy")).toBe("prediction");
    // Order (limit orders, cancels)
    expect(FAILURE_TOOL_PRODUCTS.get("kyberswap.limitOrder.create")).toBe("order");
    expect(FAILURE_TOOL_PRODUCTS.get("polymarket.clob.cancel")).toBe("order");
    // Bridge
    expect(FAILURE_TOOL_PRODUCTS.get("khalani.bridge")).toBe("bridge");
  });

  it("excludes non-trade mutating tools (lend, lp, utility)", () => {
    // lend → "lend" (not a tx product)
    expect(FAILURE_TOOL_PRODUCTS.has("solana.lend.deposit")).toBe(false);
    expect(FAILURE_TOOL_PRODUCTS.has("solana.lend.withdraw")).toBe(false);
    // lp (zap) → "lp" (not a tx product)
    expect(FAILURE_TOOL_PRODUCTS.has("kyberswap.zap.in")).toBe(false);
    // utility → "social" (not in TYPE_TO_PRODUCT as a tx product)
    expect(FAILURE_TOOL_PRODUCTS.has("polymarket.clob.heartbeat")).toBe(false);
  });

  it("excludes read tools entirely (never in the matrix → never in the allowlist)", () => {
    expect(FAILURE_TOOL_PRODUCTS.has("wallet_balances")).toBe(false);
    expect(FAILURE_TOOL_PRODUCTS.has("portfolio")).toBe(false);
    expect(FAILURE_TOOL_PRODUCTS.has("kyberswap.swap.quote")).toBe(false);
  });

  it("resolves a dual-type tool (prediction|order) to the first tx product (prediction)", () => {
    expect(FAILURE_TOOL_PRODUCTS.get("polymarket.clob.buy")).toBe("prediction");
    expect(FAILURE_TOOL_PRODUCTS.get("polymarket.clob.sell")).toBe("prediction");
  });

  it("failureToolsForProduct(undefined) returns the full allowlist", () => {
    expect(failureToolsForProduct()).toEqual(FAILURE_TOOL_ALLOWLIST);
  });

  it("failureToolsForProduct(product) intersects to tools whose derived product matches", () => {
    const spotTools = failureToolsForProduct("spot");
    expect(spotTools.length).toBeGreaterThan(0);
    for (const toolId of spotTools) {
      expect(FAILURE_TOOL_PRODUCTS.get(toolId)).toBe("spot");
    }
    expect(spotTools).toContain("solana.swap.execute");
    expect(spotTools).not.toContain("khalani.bridge");
  });

  it("failureToolsForProduct(unknown) returns an empty list (failure half matches nothing)", () => {
    expect(failureToolsForProduct("definitely-not-a-product")).toEqual([]);
    expect(failureToolsForProduct("lend")).toEqual([]); // lend is excluded from the allowlist
  });
});
