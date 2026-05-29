/**
 * codex-002 Phase 2 — behavior-preservation (equivalence) tests for the Zod
 * rewrite of `src/tools/polymarket/clob/validation.ts`.
 *
 * The CLOB validators are LENIENT-DEFAULTING (financial market-data / order /
 * trade responses): every field defaults instead of rejecting; schema failure
 * is reserved for a ROOT-type mismatch. Some validators throw a plain `Error`
 * on a bad root; others default (never throw). This file pins the NEW
 * implementation against an inline ORACLE that reproduces the ORIGINAL
 * hand-written logic, run over a battery of inputs: fully-valid, partial /
 * missing, wrong-typed, arrays with bad elements (filtered vs mapped vs
 * throwing), and non-record / non-array roots.
 */

import { describe, it, expect } from "vitest";
import {
  validateOrderBookResponse, validateSendOrderResponse, validateSendOrdersResponse,
  validatePaginatedOrders, validateOpenOrder, validateCancelResponse,
  validatePaginatedTrades, validatePriceHistoryResponse,
  validatePriceResponse, validateMidpointResponse, validateSpreadResponse,
  validateLastTradePriceResponse, validateTickSizeResponse, validateFeeRateResponse,
  validateBatchOrderBooksResponse, validateBatchPricesResponse,
  validateBatchMidpointsResponse, validateBatchSpreadsResponse,
  validateBatchLastTradesPricesResponse, validateOrderScoringResponse,
} from "@tools/polymarket/clob/validation.js";

// ── ORACLE: verbatim reproduction of the ORIGINAL hand-written logic ───
// (copied from the pre-conversion validation.ts so expected outputs are
// derived from the original, not from the new code under test).

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function oAsOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function oParseOrderSummary(raw: unknown) {
  if (!isRecord(raw)) return { price: "0", size: "0" };
  return {
    price: typeof raw.price === "string" ? raw.price : String(raw.price ?? "0"),
    size: typeof raw.size === "string" ? raw.size : String(raw.size ?? "0"),
  };
}
function oOrderBook(raw: unknown) {
  if (!isRecord(raw)) throw new Error("Expected orderbook object");
  return {
    market: typeof raw.market === "string" ? raw.market : "",
    asset_id: typeof raw.asset_id === "string" ? raw.asset_id : "",
    timestamp: typeof raw.timestamp === "string" ? raw.timestamp : "",
    hash: typeof raw.hash === "string" ? raw.hash : "",
    bids: Array.isArray(raw.bids) ? raw.bids.map(oParseOrderSummary) : [],
    asks: Array.isArray(raw.asks) ? raw.asks.map(oParseOrderSummary) : [],
    min_order_size: typeof raw.min_order_size === "string" ? raw.min_order_size : "1",
    tick_size: typeof raw.tick_size === "string" ? raw.tick_size : "0.01",
    neg_risk: raw.neg_risk === true,
    last_trade_price: typeof raw.last_trade_price === "string" ? raw.last_trade_price : "0.5",
  };
}
function oSendOrder(raw: unknown) {
  if (!isRecord(raw)) throw new Error("Expected order response object");
  return {
    success: raw.success === true,
    orderID: typeof raw.orderID === "string" ? raw.orderID : "",
    status: (raw.status === "live" || raw.status === "matched" || raw.status === "delayed") ? raw.status : "delayed",
    makingAmount: oAsOptionalString(raw.makingAmount),
    takingAmount: oAsOptionalString(raw.takingAmount),
    transactionsHashes: Array.isArray(raw.transactionsHashes) ? raw.transactionsHashes.filter((t): t is string => typeof t === "string") : undefined,
    tradeIDs: Array.isArray(raw.tradeIDs) ? raw.tradeIDs.filter((t): t is string => typeof t === "string") : undefined,
    errorMsg: typeof raw.errorMsg === "string" ? raw.errorMsg : "",
  };
}
function oParseOpenOrder(raw: unknown) {
  if (!isRecord(raw)) throw new Error("order must be an object");
  return {
    id: typeof raw.id === "string" ? raw.id : "",
    status: typeof raw.status === "string" ? raw.status : "",
    owner: typeof raw.owner === "string" ? raw.owner : "",
    maker_address: typeof raw.maker_address === "string" ? raw.maker_address : "",
    market: typeof raw.market === "string" ? raw.market : "",
    asset_id: typeof raw.asset_id === "string" ? raw.asset_id : "",
    side: raw.side === "SELL" ? "SELL" : "BUY",
    original_size: typeof raw.original_size === "string" ? raw.original_size : "0",
    size_matched: typeof raw.size_matched === "string" ? raw.size_matched : "0",
    price: typeof raw.price === "string" ? raw.price : "0",
    outcome: typeof raw.outcome === "string" ? raw.outcome : "",
    expiration: typeof raw.expiration === "string" ? raw.expiration : "",
    order_type: (raw.order_type === "GTC" || raw.order_type === "FOK" || raw.order_type === "GTD" || raw.order_type === "FAK") ? raw.order_type : "GTC",
    associate_trades: Array.isArray(raw.associate_trades) ? raw.associate_trades.filter((t): t is string => typeof t === "string") : [],
    created_at: typeof raw.created_at === "number" ? raw.created_at : 0,
  };
}
function oPaginatedOrders(raw: unknown) {
  if (!isRecord(raw)) throw new Error("Expected paginated orders");
  return {
    limit: typeof raw.limit === "number" ? raw.limit : 100,
    next_cursor: typeof raw.next_cursor === "string" ? raw.next_cursor : "",
    count: typeof raw.count === "number" ? raw.count : 0,
    data: Array.isArray(raw.data) ? raw.data.map(oParseOpenOrder) : [],
  };
}
function oCancel(raw: unknown) {
  if (!isRecord(raw)) throw new Error("Expected cancel response");
  return {
    canceled: Array.isArray(raw.canceled) ? raw.canceled.filter((c): c is string => typeof c === "string") : [],
    not_canceled: isRecord(raw.not_canceled) ? raw.not_canceled as Record<string, string> : {},
  };
}
function oParseClobTrade(raw: unknown) {
  if (!isRecord(raw)) throw new Error("trade must be an object");
  return {
    id: typeof raw.id === "string" ? raw.id : "",
    taker_order_id: typeof raw.taker_order_id === "string" ? raw.taker_order_id : "",
    market: typeof raw.market === "string" ? raw.market : "",
    asset_id: typeof raw.asset_id === "string" ? raw.asset_id : "",
    side: raw.side === "SELL" ? "SELL" : "BUY",
    size: typeof raw.size === "string" ? raw.size : "0",
    fee_rate_bps: typeof raw.fee_rate_bps === "string" ? raw.fee_rate_bps : "0",
    price: typeof raw.price === "string" ? raw.price : "0",
    status: typeof raw.status === "string" ? raw.status : "",
    match_time: typeof raw.match_time === "string" ? raw.match_time : "",
    last_update: typeof raw.last_update === "string" ? raw.last_update : "",
    outcome: typeof raw.outcome === "string" ? raw.outcome : "",
    owner: typeof raw.owner === "string" ? raw.owner : "",
    maker_address: typeof raw.maker_address === "string" ? raw.maker_address : "",
    transaction_hash: oAsOptionalString(raw.transaction_hash) ?? null,
    trader_side: raw.trader_side === "MAKER" ? "MAKER" : "TAKER",
  };
}
function oPaginatedTrades(raw: unknown) {
  if (!isRecord(raw)) throw new Error("Expected paginated trades");
  return {
    limit: typeof raw.limit === "number" ? raw.limit : 100,
    next_cursor: typeof raw.next_cursor === "string" ? raw.next_cursor : "",
    count: typeof raw.count === "number" ? raw.count : 0,
    data: Array.isArray(raw.data) ? raw.data.map(oParseClobTrade) : [],
  };
}
function oPriceHistory(raw: unknown) {
  if (!isRecord(raw)) return { history: [] };
  return {
    history: Array.isArray(raw.history) ? raw.history.map((p: unknown) => {
      if (!isRecord(p)) return { t: 0, p: 0 };
      return { t: typeof p.t === "number" ? p.t : 0, p: typeof p.p === "number" ? p.p : 0 };
    }) : [],
  };
}
function oBatchPrices(raw: unknown) {
  if (!isRecord(raw)) return {};
  const result: Record<string, Record<string, number>> = {};
  for (const [tokenId, sides] of Object.entries(raw)) {
    if (isRecord(sides)) {
      result[tokenId] = {};
      for (const [side, price] of Object.entries(sides as Record<string, unknown>)) {
        if (typeof price === "number") result[tokenId][side] = price;
      }
    }
  }
  return result;
}
function oBatchStrMap(raw: unknown) {
  if (!isRecord(raw)) return {};
  const result: Record<string, string> = {};
  for (const [tokenId, value] of Object.entries(raw)) {
    if (typeof value === "string") result[tokenId] = value;
  }
  return result;
}
function oBatchLastTrades(raw: unknown) {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isRecord).map((item) => ({
    token_id: typeof item.token_id === "string" ? item.token_id : "",
    price: typeof item.price === "string" ? item.price : "0.5",
    side: (item.side === "BUY" || item.side === "SELL") ? item.side : "BUY",
  }));
}
function oOrderScoring(raw: unknown) {
  if (!isRecord(raw)) return { scoring: false };
  return { scoring: raw.scoring === true };
}

// ── Shared root-mismatch battery ───────────────────────────────────────
const nonRecordRoots: ReadonlyArray<readonly [string, unknown]> = [
  ["null", null],
  ["undefined", undefined],
  ["number", 42],
  ["string", "bad"],
  ["boolean", true],
  ["array", [1, 2, 3]],
];
const nonArrayRoots: ReadonlyArray<readonly [string, unknown]> = [
  ["null", null],
  ["undefined", undefined],
  ["number", 42],
  ["string", "bad"],
  ["object", { a: 1 }],
];

// ── Object-root validators that THROW plain Error on bad root ──────────

describe("validateOrderBookResponse — equivalence", () => {
  const valid = {
    market: "0xabc", asset_id: "t1", timestamp: "ts", hash: "h",
    bids: [{ price: "0.48", size: "100" }, { price: 0.5, size: 9 }, "junk", null],
    asks: [{ size: "5" }],
    min_order_size: "2", tick_size: "0.05", neg_risk: true, last_trade_price: "0.7",
  };
  const partial = { market: "0x" }; // everything else missing -> defaults
  const wrongTyped = { market: 1, tick_size: 5, neg_risk: "yes", bids: "notarray", last_trade_price: null };

  it.each([
    ["valid (incl. coerced/non-record bid elements)", valid],
    ["partial", partial],
    ["wrong-typed", wrongTyped],
  ])("matches oracle: %s", (_label, input) => {
    expect(validateOrderBookResponse(input)).toEqual(oOrderBook(input));
  });

  it("coerces non-string order-summary price/size via String(x ?? '0')", () => {
    const r = validateOrderBookResponse({ bids: [{ price: 0.5, size: 9 }, {}] });
    expect(r.bids).toEqual([{ price: "0.5", size: "9" }, { price: "0", size: "0" }]);
  });

  it.each(nonRecordRoots)("throws plain Error on non-record root: %s", (_l, root) => {
    expect(() => validateOrderBookResponse(root)).toThrowError(new Error("Expected orderbook object"));
  });
});

describe("validateSendOrderResponse — equivalence", () => {
  const valid = { success: true, orderID: "0x1", status: "matched", makingAmount: "10", takingAmount: "", transactionsHashes: ["0xtx", 9, "0xtx2"], tradeIDs: [1, "t1"], errorMsg: "e" };
  const partial = {};
  const wrongStatus = { status: "weird", success: "true" };

  it.each([
    ["valid (mixed-type arrays filtered, empty takingAmount -> undefined)", valid],
    ["partial -> all defaults", partial],
    ["bad status -> delayed", wrongStatus],
  ])("matches oracle: %s", (_l, input) => {
    expect(validateSendOrderResponse(input)).toEqual(oSendOrder(input));
  });

  it("non-array hash fields default to undefined (key absent)", () => {
    const r = validateSendOrderResponse({ transactionsHashes: "x", tradeIDs: 5 });
    expect(r.transactionsHashes).toBeUndefined();
    expect(r.tradeIDs).toBeUndefined();
  });

  it.each(nonRecordRoots)("throws plain Error on non-record root: %s", (_l, root) => {
    expect(() => validateSendOrderResponse(root)).toThrowError(new Error("Expected order response object"));
  });
});

describe("validateOpenOrder / validatePaginatedOrders — equivalence", () => {
  const order = { id: "0x1", side: "SELL", order_type: "FOK", original_size: "100", created_at: 5, associate_trades: ["a", 2, "b"] };
  const orderPartial = {};

  it.each([
    ["full order", order],
    ["partial -> defaults (side BUY, order_type GTC, sizes '0')", orderPartial],
  ])("validateOpenOrder matches oracle: %s", (_l, input) => {
    expect(validateOpenOrder(input)).toEqual(oParseOpenOrder(input));
  });

  it.each(nonRecordRoots)("validateOpenOrder throws 'order must be an object' on %s", (_l, root) => {
    expect(() => validateOpenOrder(root)).toThrowError(new Error("order must be an object"));
  });

  it("paginated orders: non-array data -> [], element-map preserved", () => {
    const input = { limit: "x", count: 3, next_cursor: 7, data: [order, {}] };
    expect(validatePaginatedOrders(input)).toEqual(oPaginatedOrders(input));
  });

  it("paginated orders: a non-record element makes .map throw (parseOpenOrder)", () => {
    // Original: raw.data.map(parseOpenOrder) throws on non-record element.
    expect(() => validatePaginatedOrders({ data: [order, null] })).toThrowError(
      new Error("order must be an object"),
    );
    expect(() => oPaginatedOrders({ data: [order, null] })).toThrowError(
      new Error("order must be an object"),
    );
  });

  it.each(nonRecordRoots)("validatePaginatedOrders throws on non-record root: %s", (_l, root) => {
    expect(() => validatePaginatedOrders(root)).toThrowError(new Error("Expected paginated orders"));
  });
});

describe("validateCancelResponse — equivalence", () => {
  it.each([
    ["full", { canceled: ["0x1", 2, "0x2"], not_canceled: { "0x3": "not found" } }],
    ["empty", { canceled: [], not_canceled: {} }],
    ["non-array canceled + non-record not_canceled -> defaults", { canceled: "x", not_canceled: 5 }],
    ["not_canceled raw subtree preserved (kept as-is, not filtered)", { not_canceled: { a: "1", b: 2 } }],
  ])("matches oracle: %s", (_l, input) => {
    expect(validateCancelResponse(input)).toEqual(oCancel(input));
  });

  it.each(nonRecordRoots)("throws plain Error on non-record root: %s", (_l, root) => {
    expect(() => validateCancelResponse(root)).toThrowError(new Error("Expected cancel response"));
  });
});

describe("validatePaginatedTrades — equivalence", () => {
  const trade = { id: "t1", side: "SELL", trader_side: "MAKER", size: "10", transaction_hash: "0xhash", price: 0.5 };

  it.each([
    ["full trade (price non-string -> '0', transaction_hash kept)", { data: [trade] }],
    ["trade missing tx hash -> null", { data: [{ id: "t" }] }],
    ["non-array data -> []", { data: "x", limit: "y" }],
  ])("matches oracle: %s", (_l, input) => {
    expect(validatePaginatedTrades(input)).toEqual(oPaginatedTrades(input));
  });

  it("empty-string transaction_hash defaults to null (asOptionalString)", () => {
    const r = validatePaginatedTrades({ data: [{ transaction_hash: "" }] });
    expect(r.data[0].transaction_hash).toBeNull();
  });

  it("a non-record trade element makes .map throw", () => {
    expect(() => validatePaginatedTrades({ data: [trade, 5] })).toThrowError(new Error("trade must be an object"));
  });

  it.each(nonRecordRoots)("throws on non-record root: %s", (_l, root) => {
    expect(() => validatePaginatedTrades(root)).toThrowError(new Error("Expected paginated trades"));
  });
});

describe("validateSendOrdersResponse / validateBatchOrderBooksResponse — array roots", () => {
  it("maps array elements", () => {
    const input = [{ success: true, orderID: "0x1", status: "live", errorMsg: "" }];
    expect(validateSendOrdersResponse(input)).toEqual(input.map(oSendOrder));
  });
  it.each(nonArrayRoots)("validateSendOrdersResponse throws on non-array root: %s", (_l, root) => {
    expect(() => validateSendOrdersResponse(root)).toThrowError(new Error("Expected orders response array"));
  });
  it.each(nonArrayRoots)("validateBatchOrderBooksResponse throws on non-array root: %s", (_l, root) => {
    expect(() => validateBatchOrderBooksResponse(root)).toThrowError(new Error("Expected batch orderbooks array"));
  });
});

// ── Defaulting validators (NEVER throw on bad root) ────────────────────

describe("validatePriceHistoryResponse — defaults, no throw", () => {
  it.each([
    ["valid points", { history: [{ t: 1, p: 0.65 }, { t: "bad", p: "bad" }, "junk"] }],
    ["non-array history -> []", { history: 5 }],
  ])("matches oracle: %s", (_l, input) => {
    expect(validatePriceHistoryResponse(input)).toEqual(oPriceHistory(input));
  });
  it.each(nonRecordRoots)("returns {history:[]} (no throw) on non-record root: %s", (_l, root) => {
    expect(validatePriceHistoryResponse(root)).toEqual({ history: [] });
    expect(oPriceHistory(root)).toEqual({ history: [] });
  });
});

describe("scalar defaulting validators — match oracle incl. non-record roots", () => {
  const cases: ReadonlyArray<readonly [string, (r: unknown) => unknown, (r: unknown) => unknown, unknown]> = [
    ["validatePriceResponse", validatePriceResponse, (r) => (isRecord(r) ? { price: typeof r.price === "number" ? r.price : 0 } : { price: 0 }), { price: 0.45 }],
    ["validateMidpointResponse", validateMidpointResponse, (r) => (isRecord(r) ? { mid_price: typeof r.mid_price === "string" ? r.mid_price : "0" } : { mid_price: "0" }), { mid_price: "0.5" }],
    ["validateSpreadResponse", validateSpreadResponse, (r) => (isRecord(r) ? { spread: typeof r.spread === "string" ? r.spread : "0" } : { spread: "0" }), { spread: "0.02" }],
    ["validateTickSizeResponse", validateTickSizeResponse, (r) => (isRecord(r) ? { minimum_tick_size: typeof r.minimum_tick_size === "number" ? r.minimum_tick_size : 0.01 } : { minimum_tick_size: 0.01 }), { minimum_tick_size: 0.02 }],
    ["validateFeeRateResponse", validateFeeRateResponse, (r) => (isRecord(r) ? { base_fee: typeof r.base_fee === "number" ? r.base_fee : 0 } : { base_fee: 0 }), { base_fee: 30 }],
  ];
  for (const [label, fn, oracle, validInput] of cases) {
    it(`${label}: valid + wrong-typed + non-record roots`, () => {
      expect(fn(validInput)).toEqual(oracle(validInput));
      expect(fn({})).toEqual(oracle({})); // missing -> default
      expect(fn({ price: "x", mid_price: 1, spread: 1, minimum_tick_size: "x", base_fee: "x" }))
        .toEqual(oracle({ price: "x", mid_price: 1, spread: 1, minimum_tick_size: "x", base_fee: "x" }));
      for (const [, root] of nonRecordRoots) expect(fn(root)).toEqual(oracle(root));
    });
  }

  it("validateLastTradePriceResponse: valid, wrong-typed, non-record", () => {
    expect(validateLastTradePriceResponse({ price: "0.45", side: "BUY" })).toEqual({ price: "0.45", side: "BUY" });
    expect(validateLastTradePriceResponse({ price: 1, side: 2 })).toEqual({ price: "0.5", side: "" });
    for (const [, root] of nonRecordRoots) expect(validateLastTradePriceResponse(root)).toEqual({ price: "0.5", side: "" });
  });
});

describe("batch map validators — element-wise filter, default {} on bad root", () => {
  it("validateBatchPricesResponse: keeps numeric prices, drops non-number, skips non-record sides", () => {
    const input = { t1: { BUY: 0.45, SELL: "bad" }, t2: { BUY: 0.5 }, t3: 5, t4: { foo: null } };
    expect(validateBatchPricesResponse(input)).toEqual(oBatchPrices(input));
    expect(validateBatchPricesResponse(input)).toEqual({ t1: { BUY: 0.45 }, t2: { BUY: 0.5 }, t4: {} });
  });
  it.each(nonRecordRoots)("validateBatchPricesResponse -> {} on %s", (_l, root) => {
    expect(validateBatchPricesResponse(root)).toEqual({});
  });

  it("validateBatchMidpointsResponse / Spreads: keep string values only", () => {
    const input = { t1: "0.5", t2: 9, t3: "0.65" };
    expect(validateBatchMidpointsResponse(input)).toEqual(oBatchStrMap(input));
    expect(validateBatchSpreadsResponse(input)).toEqual(oBatchStrMap(input));
    expect(validateBatchMidpointsResponse(input)).toEqual({ t1: "0.5", t3: "0.65" });
  });
  it.each(nonRecordRoots)("Midpoints/Spreads -> {} on %s", (_l, root) => {
    expect(validateBatchMidpointsResponse(root)).toEqual({});
    expect(validateBatchSpreadsResponse(root)).toEqual({});
  });
});

describe("validateBatchLastTradesPricesResponse — filters non-records, maps defaults", () => {
  it.each([
    ["mixed", ["bad", null, { token_id: "t1", price: "0.5", side: "SELL" }, { side: "weird" }]],
    ["empty array", []],
  ])("matches oracle: %s", (_l, input) => {
    expect(validateBatchLastTradesPricesResponse(input)).toEqual(oBatchLastTrades(input));
  });
  it.each(nonArrayRoots)("returns [] (no throw) on non-array root: %s", (_l, root) => {
    expect(validateBatchLastTradesPricesResponse(root)).toEqual([]);
  });
});

describe("validateOrderScoringResponse — default {scoring:false}", () => {
  it.each([
    ["true", { scoring: true }],
    ["false", { scoring: false }],
    ["non-boolean -> false", { scoring: "yes" }],
    ["missing -> false", {}],
  ])("matches oracle: %s", (_l, input) => {
    expect(validateOrderScoringResponse(input)).toEqual(oOrderScoring(input));
  });
  it.each(nonRecordRoots)("returns {scoring:false} (no throw) on %s", (_l, root) => {
    expect(validateOrderScoringResponse(root)).toEqual({ scoring: false });
  });
});
