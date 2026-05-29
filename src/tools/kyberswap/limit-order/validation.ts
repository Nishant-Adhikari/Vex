/**
 * Runtime validators for KyberSwap Limit Order API responses.
 *
 * codex-002 Phase 2 (full uniformity): these gate the SHAPE of limit-order
 * responses at the HTTP boundary before the values feed wallet/signing flows —
 * contract addresses, EIP-712 messages, order data, operator signatures, and
 * encoded calldata all become inputs to on-chain actions, so the conversion is
 * BEHAVIOUR-PRESERVING with the hand-written code.
 *
 * The file is MIXED per the original:
 *   - Root-type mismatches throw a PLAIN `Error("...")` with the exact original
 *     message (these were `if (!isRecord(raw)) throw new Error(...)` guards).
 *   - Required field rules go through `createFieldValidators(KYBER_API_ERROR,
 *     "KyberSwap Limit Order")`, i.e. they throw `VexError(KYBER_API_ERROR,
 *     "Invalid KyberSwap Limit Order response: missing <field>")`.
 *   - Optional/defaulting fields never throw and reproduce the exact original
 *     default + coercion (`?? "0"`, `typeof x === "number" ? x : undefined`,
 *     preserved raw subtrees, element-wise string filtering).
 *
 * The schemas are intentionally NOT the type source of truth — the wire
 * interfaces in `types.ts` remain canonical, and each exported validator keeps
 * its declared return type so `tsc` verifies the inferred schema output is
 * assignable to that interface. The exported function API (names, signatures,
 * return types) is preserved so `client.ts` / `taker-client.ts` call sites stay
 * unchanged.
 *
 * Behaviour note: `asNumber` (and `typeof x === "number"` guards) accept
 * ±Infinity, which Zod 4 `z.number()` would wrongly reject — so numeric fields
 * use `zNumberField(...)` / a local `typeof === "number"` transform, never
 * `z.number()`.
 */

import { z } from "zod";
import { VexError, ErrorCodes } from "../../../errors.js";
import { isRecord } from "../../../utils/validation-helpers.js";
import {
  zNumberField,
  zStringField,
  zOptionalString,
} from "../../../utils/zod-validation-helpers.js";
import type {
  LimitOrder,
  LimitOrderEip712Message,
  LimitOrderEip712Domain,
  OperatorSignatureResponse,
  EncodedCalldata,
  TradingPair,
  ContractAddresses,
} from "./types.js";

// ---------------------------------------------------------------------------
// Throw helper — reproduces the original VexError(KYBER_API_ERROR, "...") that
// the `createFieldValidators(KYBER_API_ERROR, "KyberSwap Limit Order")` helpers
// raised. The first Zod issue's message carries the original field-path text
// (`Invalid KyberSwap Limit Order response: missing <field>`), so the surfaced
// error is equivalent to the original short-circuit throw.
// ---------------------------------------------------------------------------

function parseOrThrow<T>(schema: z.ZodType<T>, raw: unknown): T {
  const result = schema.safeParse(raw);
  if (result.success) {
    return result.data;
  }
  const issue = result.error.issues[0];
  throw new VexError(ErrorCodes.KYBER_API_ERROR, issue.message);
}

// ---------------------------------------------------------------------------
// Field primitives — mirror createFieldValidators(KYBER_API_ERROR,
// "KyberSwap Limit Order").
// ---------------------------------------------------------------------------

/** Mirrors `asString(value, field)`: non-empty string, else `missing <field>`. */
function asString(field: string): z.ZodType<string> {
  return zStringField(`Invalid KyberSwap Limit Order response: missing ${field}`);
}

/** Mirrors `asNumber(value, field)`: any non-NaN number (incl. ±Infinity), else `missing <field>`. */
function asNumber(field: string): z.ZodType<number> {
  return zNumberField(`Invalid KyberSwap Limit Order response: missing ${field}`);
}

/** Mirrors `asOptionalString`: non-empty string, else `undefined`. Never throws. */
const asOptionalString: z.ZodType<string | undefined> = zOptionalString;

/** `typeof x === "string" ? x : "0"` — filled-amount default. Never throws. */
const stringOrZero: z.ZodType<string> = z
  .unknown()
  .transform((v) => (typeof v === "string" ? v : "0"));

/** `typeof x === "number" ? x : undefined` — decimals default. Never throws. */
const numberOrUndefined: z.ZodType<number | undefined> = z
  .unknown()
  .transform((v) => (typeof v === "number" ? v : undefined));

// ---------------------------------------------------------------------------
// EIP-712 domain
// ---------------------------------------------------------------------------

const domainSchema = z.object({
  name: asString("domain.name"),
  version: asString("domain.version"),
  chainId: asNumber("domain.chainId"),
  verifyingContract: asString("domain.verifyingContract"),
});

/**
 * Mirrors `parseDomain`: non-record → plain `Error("EIP-712 domain must be an
 * object")`; then name/version/verifyingContract via `asString` and chainId via
 * `asNumber` (VexError on failure). The original literal evaluates name →
 * version → chainId → verifyingContract, which is the object-field order Zod
 * reports, so first-error messages match.
 */
function parseDomain(raw: unknown): LimitOrderEip712Domain {
  if (!isRecord(raw)) throw new Error("EIP-712 domain must be an object");
  const d = parseOrThrow(domainSchema, raw);
  return {
    name: d.name,
    version: d.version,
    chainId: d.chainId,
    verifyingContract: d.verifyingContract as LimitOrderEip712Domain["verifyingContract"],
  };
}

/**
 * Mirrors `validateEip712Message`. Order of checks/evaluation preserved exactly:
 *   1. non-record raw           → plain `Error("Expected EIP-712 message object")`
 *   2. non-record raw.message   → plain `Error("EIP-712 message.message must be an object")`
 *   3. domain (parseDomain)     → plain Error / VexError as above
 *   4. types: `raw.types ?? {}` → preserved raw subtree, default `{}`
 *   5. primaryType (asString)   → VexError
 *   6. message.salt (asString)  → VexError; all other message keys preserved.
 */
export function validateEip712Message(raw: unknown): LimitOrderEip712Message {
  if (!isRecord(raw)) throw new Error("Expected EIP-712 message object");
  const message = raw.message;
  if (!isRecord(message)) throw new Error("EIP-712 message.message must be an object");

  return {
    domain: parseDomain(raw.domain),
    types: (raw.types ?? {}) as LimitOrderEip712Message["types"],
    primaryType: parseOrThrow(asString("primaryType"), raw.primaryType),
    message: {
      ...message,
      salt: parseOrThrow(asString("message.salt"), message.salt),
    } as LimitOrderEip712Message["message"],
  };
}

// ---------------------------------------------------------------------------
// Order
// ---------------------------------------------------------------------------

const orderSchema = z.object({
  id: asNumber("order.id"),
  chainId: asString("order.chainId"),
  makerAsset: asString("order.makerAsset"),
  takerAsset: asString("order.takerAsset"),
  maker: asString("order.maker"),
  makingAmount: asString("order.makingAmount"),
  takingAmount: asString("order.takingAmount"),
  filledMakingAmount: stringOrZero,
  filledTakingAmount: stringOrZero,
  status: asString("order.status"),
  expiredAt: asNumber("order.expiredAt"),
  salt: asString("order.salt"),
  signature: asString("order.signature"),
  createdAt: asString("order.createdAt"),
  updatedAt: asString("order.updatedAt"),
  makerAssetSymbol: asOptionalString,
  takerAssetSymbol: asOptionalString,
  makerAssetDecimals: numberOrUndefined,
  takerAssetDecimals: numberOrUndefined,
});

/**
 * Mirrors `parseOrder`: non-record → plain `Error("order must be an object")`.
 * Required string/number fields via asString/asNumber (VexError); filled
 * amounts default to "0"; symbols are optional strings; decimals default to
 * undefined. Object-field order matches the original return literal, so the
 * first failing field's message matches.
 */
function parseOrder(raw: unknown): LimitOrder {
  if (!isRecord(raw)) throw new Error("order must be an object");
  const o = parseOrThrow(orderSchema, raw);
  return {
    id: o.id,
    chainId: o.chainId,
    makerAsset: o.makerAsset,
    takerAsset: o.takerAsset,
    maker: o.maker,
    makingAmount: o.makingAmount,
    takingAmount: o.takingAmount,
    filledMakingAmount: o.filledMakingAmount,
    filledTakingAmount: o.filledTakingAmount,
    status: o.status as LimitOrder["status"],
    expiredAt: o.expiredAt,
    salt: o.salt,
    signature: o.signature,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
    makerAssetSymbol: o.makerAssetSymbol,
    takerAssetSymbol: o.takerAssetSymbol,
    makerAssetDecimals: o.makerAssetDecimals,
    takerAssetDecimals: o.takerAssetDecimals,
  };
}

/**
 * Mirrors `validateOrdersResponse`: an `{ orders: [...] }` envelope maps over
 * `raw.orders`; otherwise a bare array maps directly; anything else throws the
 * plain `Error("Expected orders response")`. (A record whose `orders` is not an
 * array falls through to the array check then the throw — same as the original.)
 */
export function validateOrdersResponse(raw: unknown): LimitOrder[] {
  if (!isRecord(raw) || !Array.isArray(raw.orders)) {
    if (Array.isArray(raw)) return raw.map(parseOrder);
    throw new Error("Expected orders response");
  }
  return raw.orders.map(parseOrder);
}

// ---------------------------------------------------------------------------
// Create order
// ---------------------------------------------------------------------------

/**
 * Mirrors `validateCreateOrderResponse`: non-record → plain `Error("Expected
 * create order response")`; otherwise `orderId = asNumber(raw.id ?? raw.orderId)`
 * (VexError "missing orderId" when neither is a valid number).
 */
export function validateCreateOrderResponse(raw: unknown): { orderId: number } {
  if (!isRecord(raw)) throw new Error("Expected create order response");
  return { orderId: parseOrThrow(asNumber("orderId"), raw.id ?? raw.orderId) };
}

// ---------------------------------------------------------------------------
// Active making amount
// ---------------------------------------------------------------------------

/**
 * Mirrors `validateActiveMakingAmount`: non-record → plain `Error("Expected
 * active making amount response")`; otherwise `asString(raw.activeMakingAmount
 * ?? raw.data, "activeMakingAmount")` (VexError "missing activeMakingAmount").
 */
export function validateActiveMakingAmount(raw: unknown): string {
  if (!isRecord(raw)) throw new Error("Expected active making amount response");
  return parseOrThrow(asString("activeMakingAmount"), raw.activeMakingAmount ?? raw.data);
}

// ---------------------------------------------------------------------------
// Operator signature
// ---------------------------------------------------------------------------

/**
 * Mirrors `validateOperatorSignature`: non-record → plain `Error("Expected
 * operator signature response")`; otherwise `operatorSignatures` is an
 * element-wise string filter of the array, else `[]` (never throws field-wise).
 */
export function validateOperatorSignature(raw: unknown): OperatorSignatureResponse {
  if (!isRecord(raw)) throw new Error("Expected operator signature response");
  const sigs = Array.isArray(raw.operatorSignatures) ? raw.operatorSignatures : [];
  return {
    operatorSignatures: sigs.filter((s): s is string => typeof s === "string"),
  };
}

// ---------------------------------------------------------------------------
// Encoded calldata
// ---------------------------------------------------------------------------

/**
 * Mirrors `validateEncodedCalldata`: non-record → plain `Error("Expected
 * encoded calldata response")`; encodedData via asString (VexError);
 * routerAddress is an optional string (cast).
 */
export function validateEncodedCalldata(raw: unknown): EncodedCalldata {
  if (!isRecord(raw)) throw new Error("Expected encoded calldata response");
  return {
    encodedData: parseOrThrow(asString("encodedData"), raw.encodedData),
    routerAddress: parseOrThrow(asOptionalString, raw.routerAddress) as EncodedCalldata["routerAddress"],
  };
}

// ---------------------------------------------------------------------------
// Trading pairs
// ---------------------------------------------------------------------------

const tradingPairSchema = z.object({
  makerAsset: asString("pair.makerAsset"),
  takerAsset: asString("pair.takerAsset"),
  chainId: asString("pair.chainId"),
});

/**
 * Mirrors `parseTradingPair`: non-record → plain `Error("trading pair must be
 * an object")`; makerAsset/takerAsset/chainId via asString (VexError).
 */
function parseTradingPair(raw: unknown): TradingPair {
  if (!isRecord(raw)) throw new Error("trading pair must be an object");
  return parseOrThrow(tradingPairSchema, raw);
}

/**
 * Mirrors `validateTradingPairsResponse`: bare array maps directly; otherwise a
 * record with a `pairs` array maps over it; otherwise a record with a `data`
 * array maps over it; otherwise plain `Error("Expected trading pairs
 * response")`.
 */
export function validateTradingPairsResponse(raw: unknown): TradingPair[] {
  if (!Array.isArray(raw)) {
    if (isRecord(raw) && Array.isArray(raw.pairs)) return (raw.pairs as unknown[]).map(parseTradingPair);
    if (isRecord(raw) && Array.isArray(raw.data)) return (raw.data as unknown[]).map(parseTradingPair);
    throw new Error("Expected trading pairs response");
  }
  return raw.map(parseTradingPair);
}

// ---------------------------------------------------------------------------
// Contract addresses
// ---------------------------------------------------------------------------

/**
 * Mirrors `validateContractAddressResponse`: non-record → plain `Error("Expected
 * contract address response")`; otherwise build a map keeping only string
 * values (non-string entries dropped). Element-wise over the raw record's
 * entries — no whole-object drop.
 */
export function validateContractAddressResponse(raw: unknown): ContractAddresses {
  if (!isRecord(raw)) throw new Error("Expected contract address response");
  const result: ContractAddresses = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string") {
      result[key] = value;
    }
  }
  return result;
}
