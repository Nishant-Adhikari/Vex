import { describe, it, expect } from "vitest";
import {
  validateOrderBookResponse, validateSendOrderResponse, validateSendOrdersResponse,
  validatePaginatedOrders, validateOpenOrder, validateCancelResponse,
  validatePaginatedTrades, validatePriceHistoryResponse,
  validatePriceResponse, validateMidpointResponse, validateSpreadResponse,
  validateLastTradePriceResponse, validateTickSizeResponse, validateFeeRateResponse,
} from "../polymarket/clob/validation.js";

describe("validateOrderBookResponse", () => {
  it("parses valid orderbook", () => {
    const book = validateOrderBookResponse({
      market: "0xabc", asset_id: "token123", timestamp: "1234", hash: "hash",
      bids: [{ price: "0.48", size: "100" }], asks: [{ price: "0.52", size: "50" }],
      min_order_size: "1", tick_size: "0.01", neg_risk: false, last_trade_price: "0.50",
    });
    expect(book.bids).toHaveLength(1);
    expect(book.asks).toHaveLength(1);
    expect(book.last_trade_price).toBe("0.50");
  });
  it("handles empty bids/asks", () => {
    const book = validateOrderBookResponse({ market: "0x", asset_id: "", timestamp: "", hash: "" });
    expect(book.bids).toEqual([]);
    expect(book.asks).toEqual([]);
  });
  it("throws for non-object", () => { expect(() => validateOrderBookResponse(null)).toThrow(); });
});

describe("validateSendOrderResponse", () => {
  it("parses success", () => {
    const r = validateSendOrderResponse({ success: true, orderID: "0xabc", status: "live", errorMsg: "" });
    expect(r.success).toBe(true);
    expect(r.status).toBe("live");
  });
  it("parses matched with tx hashes", () => {
    const r = validateSendOrderResponse({ success: true, orderID: "0x1", status: "matched", transactionsHashes: ["0xtx"], tradeIDs: ["t1"], errorMsg: "" });
    expect(r.transactionsHashes).toEqual(["0xtx"]);
    expect(r.tradeIDs).toEqual(["t1"]);
  });
  it("defaults error fields", () => {
    const r = validateSendOrderResponse({});
    expect(r.success).toBe(false);
    expect(r.status).toBe("delayed");
  });
});

describe("validateSendOrdersResponse", () => {
  it("parses array", () => {
    const result = validateSendOrdersResponse([{ success: true, orderID: "0x1", status: "live", errorMsg: "" }]);
    expect(result).toHaveLength(1);
  });
  it("throws for non-array", () => { expect(() => validateSendOrdersResponse(null)).toThrow(); });
});

describe("validatePaginatedOrders", () => {
  it("parses paginated response", () => {
    const r = validatePaginatedOrders({
      limit: 100, next_cursor: "abc", count: 1,
      data: [{ id: "0x1", status: "ORDER_STATUS_LIVE", owner: "uuid", maker_address: "0x", market: "0x", asset_id: "t", side: "BUY", original_size: "100", size_matched: "0", price: "0.5", outcome: "YES", expiration: "0", order_type: "GTC", created_at: 123 }],
    });
    expect(r.count).toBe(1);
    expect(r.data[0].side).toBe("BUY");
  });
});

describe("validateCancelResponse", () => {
  it("parses canceled + not_canceled", () => {
    const r = validateCancelResponse({ canceled: ["0x1"], not_canceled: { "0x2": "not found" } });
    expect(r.canceled).toEqual(["0x1"]);
    expect(r.not_canceled["0x2"]).toBe("not found");
  });
  it("handles empty", () => {
    const r = validateCancelResponse({ canceled: [], not_canceled: {} });
    expect(r.canceled).toEqual([]);
  });
});

describe("validatePaginatedTrades", () => {
  it("parses trades", () => {
    const r = validatePaginatedTrades({
      limit: 100, next_cursor: "", count: 1,
      data: [{ id: "t1", taker_order_id: "0x1", market: "0x", asset_id: "t", side: "BUY", size: "10", fee_rate_bps: "30", price: "0.5", status: "TRADE_STATUS_CONFIRMED", match_time: "123", last_update: "123", outcome: "YES", owner: "u", maker_address: "0x", trader_side: "TAKER" }],
    });
    expect(r.data[0].trader_side).toBe("TAKER");
  });
});

describe("validatePriceHistoryResponse", () => {
  it("parses history points", () => {
    const r = validatePriceHistoryResponse({ history: [{ t: 1700000000, p: 0.65 }] });
    expect(r.history).toHaveLength(1);
    expect(r.history[0].p).toBe(0.65);
  });
  it("defaults to empty", () => {
    expect(validatePriceHistoryResponse(null).history).toEqual([]);
  });
});

describe("price validators", () => {
  it("validatePriceResponse", () => { expect(validatePriceResponse({ price: 0.45 }).price).toBe(0.45); });
  it("validateMidpointResponse", () => { expect(validateMidpointResponse({ mid_price: "0.50" }).mid_price).toBe("0.50"); });
  it("validateSpreadResponse", () => { expect(validateSpreadResponse({ spread: "0.02" }).spread).toBe("0.02"); });
  it("validateLastTradePriceResponse", () => {
    const r = validateLastTradePriceResponse({ price: "0.45", side: "BUY" });
    expect(r.price).toBe("0.45");
    expect(r.side).toBe("BUY");
  });
  it("validateTickSizeResponse", () => { expect(validateTickSizeResponse({ minimum_tick_size: 0.01 }).minimum_tick_size).toBe(0.01); });
  it("validateFeeRateResponse", () => { expect(validateFeeRateResponse({ base_fee: 30 }).base_fee).toBe(30); });
});
