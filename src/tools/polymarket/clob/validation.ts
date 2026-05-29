/**
 * Runtime validators for Polymarket CLOB API responses.
 *
 * codex-002 Phase 2: these gate the SHAPE of CLOB market-data, order, and
 * trade responses at the HTTP boundary (the values feed pricing, order, and
 * cancel flows). The CLOB API is LENIENT-DEFAULTING: every field falls back to
 * a safe default rather than rejecting, so a single malformed field never fails
 * the whole response. Schema failure is reserved for a root-type mismatch
 * (object expected but array/null given, or array expected but object given) —
 * the wrapper then throws the SAME plain `Error` the hand-written code threw;
 * the price/midpoint/scoring/batch validators that defaulted on a bad root keep
 * defaulting (no throw).
 *
 * The schemas are intentionally NOT the type source of truth — the wire
 * interfaces in `types.ts` remain canonical, and each exported validator keeps
 * its declared return type so `tsc` verifies the inferred schema output is
 * assignable to that interface.
 */

import { z } from "zod";
import type {
  OrderBookSummary, OrderSummary, SendOrderResponse,
  OpenOrder, PaginatedOrders, CancelResponse,
  ClobTrade, PaginatedTrades, PriceHistoryResponse,
  LastTradePrice, OrderScoringResponse,
} from "./types.js";

// ── Reusable lenient field primitives ─────────────────────────────────
//
// Each mirrors a hand-written `typeof x === "..." ? x : default` guard. They
// never reject: a wrong-typed/missing field is replaced with the same default
// the original produced, so the enclosing object schema fails ONLY on a
// root-type mismatch.

/** `typeof v === "string" ? v : def` */
const strDefault = (def: string) => z.unknown().transform((v) => (typeof v === "string" ? v : def));

/** `typeof v === "number" ? v : def` */
const numDefault = (def: number) => z.unknown().transform((v) => (typeof v === "number" ? v : def));

/** `v === true` (only the literal boolean true is truthy here). */
const isTrue = z.unknown().transform((v) => v === true);

/**
 * `asOptionalString` semantics: a non-empty string passes through, anything
 * else (missing, empty, wrong type) becomes `undefined`.
 */
const asOptionalString = z
  .unknown()
  .transform((v) => (typeof v === "string" && v.length > 0 ? v : undefined));

/**
 * Element-wise string filter: `Array.isArray(v) ? v.filter(isString) : <def>`.
 * Non-array root collapses to the supplied default (`[]` or `undefined`);
 * an array keeps only its string elements.
 */
const stringArrayFilter = <D extends string[] | undefined>(def: D) =>
  z.unknown().transform((v): string[] | D =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : def,
  );

// ── OrderSummary / OrderBook ───────────────────────────────────────────

const orderSummarySchema: z.ZodType<OrderSummary> = z.unknown().transform((raw) => {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { price: "0", size: "0" };
  }
  const r = raw as Record<string, unknown>;
  return {
    price: typeof r.price === "string" ? r.price : String(r.price ?? "0"),
    size: typeof r.size === "string" ? r.size : String(r.size ?? "0"),
  };
});

const orderBookSchema = z.object({
  market: strDefault(""),
  asset_id: strDefault(""),
  timestamp: strDefault(""),
  hash: strDefault(""),
  // Non-array → []; array → element-mapped via orderSummarySchema (which itself
  // defaults non-record elements rather than throwing — matching `parseOrderSummary`).
  bids: z.unknown().transform((v) => (Array.isArray(v) ? v.map((e) => orderSummarySchema.parse(e)) : [])),
  asks: z.unknown().transform((v) => (Array.isArray(v) ? v.map((e) => orderSummarySchema.parse(e)) : [])),
  min_order_size: strDefault("1"),
  tick_size: strDefault("0.01"),
  neg_risk: isTrue,
  last_trade_price: strDefault("0.5"),
});

export function validateOrderBookResponse(raw: unknown): OrderBookSummary {
  const parsed = orderBookSchema.safeParse(raw);
  if (!parsed.success) throw new Error("Expected orderbook object");
  return parsed.data;
}

// ── SendOrderResponse ──────────────────────────────────────────────────

const sendOrderStatusSchema = z
  .unknown()
  .transform((v) => (v === "live" || v === "matched" || v === "delayed" ? v : "delayed"));

const sendOrderResponseSchema = z.object({
  success: isTrue,
  orderID: strDefault(""),
  status: sendOrderStatusSchema,
  makingAmount: asOptionalString,
  takingAmount: asOptionalString,
  transactionsHashes: stringArrayFilter(undefined),
  tradeIDs: stringArrayFilter(undefined),
  errorMsg: strDefault(""),
});

export function validateSendOrderResponse(raw: unknown): SendOrderResponse {
  const parsed = sendOrderResponseSchema.safeParse(raw);
  if (!parsed.success) throw new Error("Expected order response object");
  return parsed.data;
}

// ── OpenOrder ──────────────────────────────────────────────────────────

const openOrderSideSchema = z.unknown().transform((v) => (v === "SELL" ? "SELL" : "BUY"));
const openOrderTypeSchema = z
  .unknown()
  .transform((v) => (v === "GTC" || v === "FOK" || v === "GTD" || v === "FAK" ? v : "GTC"));

const openOrderSchema = z.object({
  id: strDefault(""),
  status: strDefault(""),
  owner: strDefault(""),
  maker_address: strDefault(""),
  market: strDefault(""),
  asset_id: strDefault(""),
  side: openOrderSideSchema,
  original_size: strDefault("0"),
  size_matched: strDefault("0"),
  price: strDefault("0"),
  outcome: strDefault(""),
  expiration: strDefault(""),
  order_type: openOrderTypeSchema,
  associate_trades: stringArrayFilter<string[]>([]),
  created_at: numDefault(0),
});

function parseOpenOrder(raw: unknown): OpenOrder {
  const parsed = openOrderSchema.safeParse(raw);
  if (!parsed.success) throw new Error("order must be an object");
  return parsed.data;
}

export function validatePaginatedOrders(raw: unknown): PaginatedOrders {
  const parsed = paginatedOrdersSchema.safeParse(raw);
  if (!parsed.success) throw new Error("Expected paginated orders");
  return parsed.data;
}

const paginatedOrdersSchema = z.object({
  limit: numDefault(100),
  next_cursor: strDefault(""),
  count: numDefault(0),
  // Non-array → []; array → map each through parseOpenOrder, which THROWS
  // "order must be an object" for a non-record element (matching the original
  // `raw.data.map(parseOpenOrder)`). The throw escapes safeParse, so it
  // surfaces directly to the caller — identical to the hand-written behavior.
  data: z.unknown().transform((v) => (Array.isArray(v) ? v.map(parseOpenOrder) : [])),
});

export function validateOpenOrder(raw: unknown): OpenOrder {
  return parseOpenOrder(raw);
}

// ── CancelResponse ─────────────────────────────────────────────────────

const cancelResponseSchema = z.object({
  canceled: stringArrayFilter<string[]>([]),
  // Preserve the raw record subtree exactly as `raw.not_canceled as Record<string,string>`:
  // non-record → {}; record → kept as-is (no element filtering in the original).
  not_canceled: z
    .unknown()
    .transform((v) =>
      typeof v === "object" && v !== null && !Array.isArray(v)
        ? (v as Record<string, string>)
        : ({} as Record<string, string>),
    ),
});

export function validateCancelResponse(raw: unknown): CancelResponse {
  const parsed = cancelResponseSchema.safeParse(raw);
  if (!parsed.success) throw new Error("Expected cancel response");
  return parsed.data;
}

// ── ClobTrade ──────────────────────────────────────────────────────────

const traderSideSchema = z.unknown().transform((v) => (v === "MAKER" ? "MAKER" : "TAKER"));

const clobTradeSchema = z.object({
  id: strDefault(""),
  taker_order_id: strDefault(""),
  market: strDefault(""),
  asset_id: strDefault(""),
  side: openOrderSideSchema,
  size: strDefault("0"),
  fee_rate_bps: strDefault("0"),
  price: strDefault("0"),
  status: strDefault(""),
  match_time: strDefault(""),
  last_update: strDefault(""),
  outcome: strDefault(""),
  owner: strDefault(""),
  maker_address: strDefault(""),
  // `asOptionalString(raw.transaction_hash) ?? null` → non-empty string | null.
  transaction_hash: asOptionalString.transform((v) => v ?? null),
  trader_side: traderSideSchema,
});

function parseClobTrade(raw: unknown): ClobTrade {
  const parsed = clobTradeSchema.safeParse(raw);
  if (!parsed.success) throw new Error("trade must be an object");
  return parsed.data;
}

const paginatedTradesSchema = z.object({
  limit: numDefault(100),
  next_cursor: strDefault(""),
  count: numDefault(0),
  data: z.unknown().transform((v) => (Array.isArray(v) ? v.map(parseClobTrade) : [])),
});

export function validatePaginatedTrades(raw: unknown): PaginatedTrades {
  const parsed = paginatedTradesSchema.safeParse(raw);
  if (!parsed.success) throw new Error("Expected paginated trades");
  return parsed.data;
}

// ── PriceHistory (defaults on bad root — never throws) ─────────────────

const priceHistoryPointSchema = z.unknown().transform((p) => {
  if (typeof p !== "object" || p === null || Array.isArray(p)) return { t: 0, p: 0 };
  const r = p as Record<string, unknown>;
  return { t: typeof r.t === "number" ? r.t : 0, p: typeof r.p === "number" ? r.p : 0 };
});

const priceHistoryResponseSchema = z.object({
  history: z.unknown().transform((v) =>
    Array.isArray(v) ? v.map((p) => priceHistoryPointSchema.parse(p)) : [],
  ),
});

export function validatePriceHistoryResponse(raw: unknown): PriceHistoryResponse {
  const parsed = priceHistoryResponseSchema.safeParse(raw);
  if (!parsed.success) return { history: [] };
  return parsed.data;
}

// ── Scalar market-data responses (default on bad root — never throw) ───

const priceResponseSchema = z.object({ price: numDefault(0) });
export function validatePriceResponse(raw: unknown): { price: number } {
  const parsed = priceResponseSchema.safeParse(raw);
  if (!parsed.success) return { price: 0 };
  return parsed.data;
}

const midpointResponseSchema = z.object({ mid_price: strDefault("0") });
export function validateMidpointResponse(raw: unknown): { mid_price: string } {
  const parsed = midpointResponseSchema.safeParse(raw);
  if (!parsed.success) return { mid_price: "0" };
  return parsed.data;
}

const spreadResponseSchema = z.object({ spread: strDefault("0") });
export function validateSpreadResponse(raw: unknown): { spread: string } {
  const parsed = spreadResponseSchema.safeParse(raw);
  if (!parsed.success) return { spread: "0" };
  return parsed.data;
}

const lastTradePriceResponseSchema = z.object({
  price: strDefault("0.5"),
  side: strDefault(""),
});
export function validateLastTradePriceResponse(raw: unknown): { price: string; side: string } {
  const parsed = lastTradePriceResponseSchema.safeParse(raw);
  if (!parsed.success) return { price: "0.5", side: "" };
  return parsed.data;
}

const tickSizeResponseSchema = z.object({ minimum_tick_size: numDefault(0.01) });
export function validateTickSizeResponse(raw: unknown): { minimum_tick_size: number } {
  const parsed = tickSizeResponseSchema.safeParse(raw);
  if (!parsed.success) return { minimum_tick_size: 0.01 };
  return parsed.data;
}

const feeRateResponseSchema = z.object({ base_fee: numDefault(0) });
export function validateFeeRateResponse(raw: unknown): { base_fee: number } {
  const parsed = feeRateResponseSchema.safeParse(raw);
  if (!parsed.success) return { base_fee: 0 };
  return parsed.data;
}

// ── Array-root validators ──────────────────────────────────────────────

export function validateSendOrdersResponse(raw: unknown): SendOrderResponse[] {
  if (!Array.isArray(raw)) throw new Error("Expected orders response array");
  return raw.map(validateSendOrderResponse);
}

// ── Batch validators ──────────────────────────────────────────────

export function validateBatchOrderBooksResponse(raw: unknown): OrderBookSummary[] {
  if (!Array.isArray(raw)) throw new Error("Expected batch orderbooks array");
  return raw.map(validateOrderBookResponse);
}

/**
 * token → side → numeric price. Non-record root → {}; per token, non-record
 * value is skipped; per side, non-number price is skipped. Built element-wise,
 * so a token with no numeric sides yields `{}` (matching the original).
 */
const batchPricesSchema = z.record(z.string(), z.unknown()).transform((raw) => {
  const result: Record<string, Record<string, number>> = {};
  for (const [tokenId, sides] of Object.entries(raw)) {
    if (typeof sides === "object" && sides !== null && !Array.isArray(sides)) {
      result[tokenId] = {};
      for (const [side, price] of Object.entries(sides as Record<string, unknown>)) {
        if (typeof price === "number") result[tokenId][side] = price;
      }
    }
  }
  return result;
});

export function validateBatchPricesResponse(raw: unknown): Record<string, Record<string, number>> {
  const parsed = batchPricesSchema.safeParse(raw);
  if (!parsed.success) return {};
  return parsed.data;
}

const batchStringMapSchema = z.record(z.string(), z.unknown()).transform((raw) => {
  const result: Record<string, string> = {};
  for (const [tokenId, value] of Object.entries(raw)) {
    if (typeof value === "string") result[tokenId] = value;
  }
  return result;
});

export function validateBatchMidpointsResponse(raw: unknown): Record<string, string> {
  const parsed = batchStringMapSchema.safeParse(raw);
  if (!parsed.success) return {};
  return parsed.data;
}

export function validateBatchSpreadsResponse(raw: unknown): Record<string, string> {
  const parsed = batchStringMapSchema.safeParse(raw);
  if (!parsed.success) return {};
  return parsed.data;
}

const lastTradePriceEntrySchema: z.ZodType<LastTradePrice> = z.unknown().transform((item) => {
  const r = item as Record<string, unknown>;
  return {
    token_id: typeof r.token_id === "string" ? r.token_id : "",
    price: typeof r.price === "string" ? r.price : "0.5",
    side: r.side === "BUY" || r.side === "SELL" ? r.side : "BUY",
  };
});

export function validateBatchLastTradesPricesResponse(raw: unknown): LastTradePrice[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is Record<string, unknown> =>
      typeof item === "object" && item !== null && !Array.isArray(item),
    )
    .map((item) => lastTradePriceEntrySchema.parse(item));
}

const orderScoringResponseSchema = z.object({ scoring: isTrue });
export function validateOrderScoringResponse(raw: unknown): OrderScoringResponse {
  const parsed = orderScoringResponseSchema.safeParse(raw);
  if (!parsed.success) return { scoring: false };
  return parsed.data;
}
