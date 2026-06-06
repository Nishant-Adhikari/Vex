/**
 * Polymarket CLOB discovery FAÇADE surface test.
 *
 * After the structural split of `embeddings/polymarket/clob.ts` into per-resource
 * chunk modules under `./clob/` (markets / orders / account), the original path
 * stays as a façade that re-assembles the SAME single object,
 * `POLYMARKET_CLOB_DISCOVERY`. Object key order is OBSERVABLE — the CLOB manifest
 * references each entry by `toolId`, and downstream retrieval/registration
 * iterates the object. This test pins the EXACT, ordered `Object.keys(...)` so any
 * accidental reorder, drop, or addition during a future re-split is caught.
 */

import { describe, it, expect } from "vitest";
import { POLYMARKET_CLOB_DISCOVERY } from "@vex-agent/tools/protocols/embeddings/polymarket/clob.js";

// The exact key sequence of the original single-file object, byte-for-byte.
// Order reproduced by the façade's segment spread (head blocks + interleaved
// tail outliers). Do NOT sort — order is the invariant under test.
const EXPECTED_KEYS: readonly string[] = [
  "polymarket.clob.orderbook",
  "polymarket.clob.orderbooks",
  "polymarket.clob.price",
  "polymarket.clob.prices",
  "polymarket.clob.midpoint",
  "polymarket.clob.midpoints",
  "polymarket.clob.spread",
  "polymarket.clob.spreads",
  "polymarket.clob.lastTrade",
  "polymarket.clob.lastTrades",
  "polymarket.clob.priceHistory",
  "polymarket.clob.batchPriceHistory",
  "polymarket.clob.serverTime",
  "polymarket.clob.tickSize",
  "polymarket.clob.feeRate",
  "polymarket.clob.buy",
  "polymarket.clob.sell",
  "polymarket.clob.cancel",
  "polymarket.clob.cancelAll",
  "polymarket.clob.cancelMarket",
  "polymarket.clob.orders",
  "polymarket.clob.order",
  "polymarket.clob.trades",
  "polymarket.clob.simplifiedMarkets",
  "polymarket.clob.rebates",
  "polymarket.clob.heartbeat",
  "polymarket.clob.cancelOrders",
  "polymarket.clob.orderScoring",
];

describe("POLYMARKET_CLOB_DISCOVERY façade surface", () => {
  it("re-assembles the EXACT ordered key set (no reorder/drop/addition)", () => {
    expect(Object.keys(POLYMARKET_CLOB_DISCOVERY)).toEqual(EXPECTED_KEYS);
  });

  it("preserves the original entry count", () => {
    expect(Object.keys(POLYMARKET_CLOB_DISCOVERY)).toHaveLength(28);
  });
});
