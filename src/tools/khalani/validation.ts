/**
 * Zod response schemas + validators for the Khalani / HyperStream HTTP API
 * (codex-002 Phase 2, full uniformity).
 *
 * These gate the SHAPE of swap/quote/order/deposit responses at the HTTP
 * boundary before the values feed transaction signing (deposit plans become
 * EVM/Solana approvals, orders/quotes feed UI + bot decisions). The Khalani
 * client uses the STRICT pattern: a malformed required field throws
 * `VexError(KHALANI_API_ERROR)` with a field-path message. Lenient sub-parts
 * (optional strings, token metadata, timestamps, provider status, error
 * bodies) never throw — they fall back to undefined/null/[]/{} exactly as the
 * hand-written validators did.
 *
 * The schemas are intentionally NOT the type source of truth — the wire
 * interfaces in `types.ts` remain canonical, and each exported validator keeps
 * its declared return type so `tsc` verifies the inferred schema output is
 * assignable to that interface. The exported function API (names, signatures,
 * return types) is preserved so `client.ts` call sites stay unchanged.
 *
 * Behaviour-preservation note: every required-field rule carries the exact
 * `missing <field>` / discriminator message the original `createFieldValidators`
 * helpers produced, so `throwFirstIssue` re-raises an equivalent
 * `VexError(KHALANI_API_ERROR)`. Lenient sub-schemas use `.catch(...)` /
 * `.transform(...)` so they never surface an issue.
 */

import { z } from "zod";
import { VexError, ErrorCodes } from "../../errors.js";
import { zNumberField } from "../../utils/zod-validation-helpers.js";
import type {
  Approval,
  AutocompleteResponse,
  DepositPlan,
  KhalaniChain,
  KhalaniErrorBody,
  KhalaniOrder,
  KhalaniProviderStatus,
  KhalaniToken,
  OrdersResponse,
  QuoteStreamRoute,
  QuoteResponse,
  SubmitResponse,
  TokenSearchResponse,
} from "./types.js";

// ---------------------------------------------------------------------------
// Throw helper — reproduces the original VexError(KHALANI_API_ERROR, "...").
// ---------------------------------------------------------------------------

/**
 * Parse `raw` with `schema`, returning the typed value or throwing the SAME
 * `VexError(KHALANI_API_ERROR, msg)` the hand-written validator would have.
 * The thrown message is the first Zod issue's message; every required-field
 * rule below carries the original field-path message, and `superRefine`
 * branches set the original discriminator messages, so the surfaced message is
 * equivalent to the original short-circuit throw.
 */
function parseOrThrow<T>(schema: z.ZodType<T>, raw: unknown): T {
  const result = schema.safeParse(raw);
  if (result.success) {
    return result.data;
  }
  const issue = result.error.issues[0];
  throw new VexError(ErrorCodes.KHALANI_API_ERROR, issue.message);
}

// ---------------------------------------------------------------------------
// Field primitives — mirror createFieldValidators(KHALANI_API_ERROR, "Khalani").
// ---------------------------------------------------------------------------

/** Mirrors `asString(value, field)`: non-empty string, else `missing <field>`. */
function asString(field: string): z.ZodType<string> {
  return z
    .string({ message: `Invalid Khalani response: missing ${field}` })
    .min(1, `Invalid Khalani response: missing ${field}`);
}

/** Mirrors `asNumber(value, field)`: any non-NaN number (incl. ±Infinity), else `missing <field>`. */
function asNumber(field: string): z.ZodType<number> {
  // Shared primitive — guards `typeof v === "number" && !Number.isNaN(v)`
  // (accepts Infinity, which Zod 4 `z.number()` would wrongly reject).
  return zNumberField(`Invalid Khalani response: missing ${field}`);
}

/**
 * Mirrors `asOptionalString`: returns the string only when it is a non-empty
 * string, otherwise `undefined`. Never throws on bad input.
 */
const asOptionalString: z.ZodType<string | undefined> = z
  .unknown()
  .transform((v) => (typeof v === "string" && v.length > 0 ? v : undefined));

/**
 * Mirrors `asStringArray`: non-array → `[]`; array → keep only string elements.
 * Element-wise filter (NOT whole-array drop).
 */
const asStringArray: z.ZodType<string[]> = z
  .unknown()
  .transform((v) =>
    Array.isArray(v) ? v.filter((entry): entry is string => typeof entry === "string") : [],
  );

/**
 * A raw record subtree preserved verbatim when present, else `undefined`.
 * Mirrors `isRecord(x) ? x as ... : undefined`.
 */
const optionalRecord: z.ZodType<Record<string, unknown> | undefined> = z
  .unknown()
  .transform((v) => (isRecordValue(v) ? v : undefined));

/** Local `isRecord` (non-null, non-array object) used inside transforms. */
function isRecordValue(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// Chain
// ---------------------------------------------------------------------------

/**
 * nativeCurrency: original coerces a non-record to `{}`, then `name` falls back
 * to `symbol` when `name` is absent/empty (live Solana omits it). `symbol` and
 * `decimals` are required. We model the fallback with a transform that reads
 * the already-normalised `symbol`.
 */
const nativeCurrencySchema = z
  .preprocess(
    (v) => (isRecordValue(v) ? v : {}),
    z.object({
      // Read raw name/symbol/decimals; symbol+decimals required, name optional.
      name: asOptionalString,
      symbol: asString("chain.nativeCurrency.symbol"),
      decimals: asNumber("chain.nativeCurrency.decimals"),
    }),
  )
  .transform((nc) => ({
    name: nc.name && nc.name.length > 0 ? nc.name : nc.symbol,
    symbol: nc.symbol,
    decimals: nc.decimals,
  }));

/**
 * The original `parseChain` short-circuits:
 *   1. non-record  -> "chain must be an object"
 *   2. type missing/empty -> "missing chain.type"   (asString)
 *   3. type not in {eip155,solana} -> "unsupported chain type <type>"
 * `z.enum` cannot distinguish (2) from (3), so the `type` check stays explicit
 * to preserve both exact messages; the remaining fields go through Zod.
 */
function parseChain(raw: unknown): KhalaniChain {
  if (!isRecordValue(raw)) {
    throw new VexError(ErrorCodes.KHALANI_API_ERROR, "Invalid Khalani response: chain must be an object");
  }
  const type = parseOrThrow(asString("chain.type"), raw.type);
  if (type !== "eip155" && type !== "solana") {
    throw new VexError(ErrorCodes.KHALANI_API_ERROR, `Invalid Khalani response: unsupported chain type ${type}`);
  }

  // Original evaluation order in parseChain's return literal: id, name, then
  // nativeCurrency. Preserve it so multi-failure inputs surface the SAME first
  // message (e.g. missing id wins over a missing nativeCurrency.symbol).
  const rest = parseOrThrow(
    z.object({
      id: asNumber("chain.id"),
      name: asString("chain.name"),
      rpcUrls: optionalRecord,
      blockExplorers: optionalRecord,
    }),
    raw,
  );
  const nativeCurrency = parseOrThrow(nativeCurrencySchema, raw.nativeCurrency);

  return {
    type,
    id: rest.id,
    name: rest.name,
    nativeCurrency,
    rpcUrls: rest.rpcUrls as KhalaniChain["rpcUrls"],
    blockExplorers: rest.blockExplorers as KhalaniChain["blockExplorers"],
  };
}

// ---------------------------------------------------------------------------
// Token
// ---------------------------------------------------------------------------

const tokenSchema: z.ZodType<KhalaniToken> = z
  .object(
    {
      address: asString("token.address"),
      chainId: asNumber("token.chainId"),
      name: asString("token.name"),
      symbol: asString("token.symbol"),
      decimals: asNumber("token.decimals"),
      logoURI: asOptionalString,
      extensions: optionalRecord,
    },
    { message: "Invalid Khalani response: token must be an object" },
  )
  .transform((t) => ({
    address: t.address,
    chainId: t.chainId,
    name: t.name,
    symbol: t.symbol,
    decimals: t.decimals,
    logoURI: t.logoURI,
    extensions: t.extensions as KhalaniToken["extensions"],
  }));

function parseToken(raw: unknown): KhalaniToken {
  return parseOrThrow(tokenSchema, raw);
}

// ---------------------------------------------------------------------------
// Token metadata (lenient: null on bad input)
// ---------------------------------------------------------------------------

/**
 * Mirrors `parseTokenMeta`: non-record OR symbol-not-string OR
 * decimals-not-number → `null`. Otherwise `{symbol, decimals, logoURI?}`.
 * Modelled lenient — never throws.
 */
const tokenMetaSchema: z.ZodType<KhalaniOrder["fromTokenMeta"]> = z
  .unknown()
  .transform((v) => {
    if (!isRecordValue(v)) return null;
    if (typeof v.symbol !== "string" || typeof v.decimals !== "number") return null;
    const logoURI = typeof v.logoURI === "string" && v.logoURI.length > 0 ? v.logoURI : undefined;
    return { symbol: v.symbol, decimals: v.decimals, logoURI };
  });

// ---------------------------------------------------------------------------
// Timestamps (lenient: filter non-string values; empty → undefined)
// ---------------------------------------------------------------------------

const timestampsSchema: z.ZodType<Record<string, string> | undefined> = z
  .unknown()
  .transform((v) => {
    if (!isRecordValue(v)) return undefined;
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(v)) {
      if (typeof value === "string") {
        result[key] = value;
      }
    }
    return Object.keys(result).length > 0 ? result : undefined;
  });

// ---------------------------------------------------------------------------
// Provider status (lenient: undefined on bad input)
// ---------------------------------------------------------------------------

const providerStatusSchema: z.ZodType<KhalaniProviderStatus | undefined> = z
  .unknown()
  .transform((v) => {
    if (!isRecordValue(v)) return undefined;
    if (typeof v.provider !== "string" || typeof v.nativeStatus !== "string") return undefined;
    return {
      provider: v.provider,
      nativeStatus: v.nativeStatus,
      substatus: typeof v.substatus === "string" ? v.substatus : undefined,
      metadata: isRecordValue(v.metadata) ? v.metadata : undefined,
    };
  });

// ---------------------------------------------------------------------------
// Order
// ---------------------------------------------------------------------------

const orderSchema: z.ZodType<KhalaniOrder> = z
  .object(
    {
      id: asString("order.id"),
      type: asString("order.type"),
      quoteId: asString("order.quoteId"),
      routeId: asString("order.routeId"),
      fromChainId: asNumber("order.fromChainId"),
      fromToken: asString("order.fromToken"),
      toChainId: asNumber("order.toChainId"),
      toToken: asString("order.toToken"),
      srcAmount: asString("order.srcAmount"),
      destAmount: asString("order.destAmount"),
      status: asString("order.status"),
      author: asString("order.author"),
      // recipient/refundTo: string or null (non-string → null).
      recipient: z.unknown().transform((v) => (typeof v === "string" ? v : null)),
      refundTo: z.unknown().transform((v) => (typeof v === "string" ? v : null)),
      depositTxHash: asString("order.depositTxHash"),
      externalOrderId: asOptionalString,
      createdAt: asString("order.createdAt"),
      updatedAt: asString("order.updatedAt"),
      tradeType: asString("order.tradeType"),
      stepsCompleted: asStringArray,
      // transactions: preserved raw record, else {}.
      transactions: z
        .unknown()
        .transform((v) => (isRecordValue(v) ? v : {})),
      timestamps: timestampsSchema,
      providerStatus: providerStatusSchema,
      fromTokenMeta: tokenMetaSchema,
      toTokenMeta: tokenMetaSchema,
    },
    { message: "Invalid Khalani response: order must be an object" },
  )
  .transform((o) => ({
    id: o.id,
    type: o.type,
    quoteId: o.quoteId,
    routeId: o.routeId,
    fromChainId: o.fromChainId,
    fromToken: o.fromToken,
    toChainId: o.toChainId,
    toToken: o.toToken,
    srcAmount: o.srcAmount,
    destAmount: o.destAmount,
    status: o.status as KhalaniOrder["status"],
    author: o.author,
    recipient: o.recipient,
    refundTo: o.refundTo,
    depositTxHash: o.depositTxHash,
    externalOrderId: o.externalOrderId,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
    tradeType: o.tradeType as KhalaniOrder["tradeType"],
    stepsCompleted: o.stepsCompleted,
    transactions: o.transactions as KhalaniOrder["transactions"],
    timestamps: o.timestamps,
    providerStatus: o.providerStatus,
    fromTokenMeta: o.fromTokenMeta,
    toTokenMeta: o.toTokenMeta,
  }));

function parseOrder(raw: unknown): KhalaniOrder {
  return parseOrThrow(orderSchema, raw);
}

// ---------------------------------------------------------------------------
// Error body (lenient: null on bad input)
// ---------------------------------------------------------------------------

export function parseKhalaniErrorBody(raw: unknown): KhalaniErrorBody | null {
  const result = z
    .unknown()
    .transform((v): KhalaniErrorBody | null => {
      if (!isRecordValue(v)) return null;
      if (typeof v.message !== "string" || typeof v.name !== "string") return null;
      return {
        message: v.message,
        name: v.name,
        details:
          Array.isArray(v.details) || isRecordValue(v.details)
            ? (v.details as KhalaniErrorBody["details"])
            : undefined,
      };
    })
    .safeParse(raw);
  // The transform never fails, so success is always true.
  return result.success ? result.data : null;
}

// ---------------------------------------------------------------------------
// Quote route shape (shared between /quotes routes and the NDJSON stream)
// ---------------------------------------------------------------------------

/**
 * Inner `quote` block. `prefix` is "route.quote" or "stream.quote" so the
 * field-path messages exactly match the original.
 */
function quoteBlockSchema(prefix: string) {
  return z.object(
    {
      amountIn: asString(`${prefix}.amountIn`),
      amountOut: asString(`${prefix}.amountOut`),
      expectedDurationSeconds: asNumber(`${prefix}.expectedDurationSeconds`),
      validBefore: asNumber(`${prefix}.validBefore`),
      quoteExpiresAt: z
        .unknown()
        .transform((v) => (typeof v === "number" ? v : undefined)),
      estimatedGas: asOptionalString,
      tags: asStringArray,
    },
    { message: "Invalid Khalani response: route must include quote" },
  );
}

// ---------------------------------------------------------------------------
// Exported validators
// ---------------------------------------------------------------------------

export function validateChainsResponse(raw: unknown): KhalaniChain[] {
  if (!Array.isArray(raw)) {
    throw new VexError(ErrorCodes.KHALANI_API_ERROR, "Invalid Khalani response: expected chains array");
  }
  // Khalani's /v1/chains serves chain families Vex does not support (e.g. tron
  // / flow / hyperevm — the API returns more `type` values than its own schema
  // doc admits). Skip a foreign family instead of throwing, so a single tron
  // entry can't fail the whole periodic balances sync. Only a NON-EMPTY,
  // unsupported STRING type is skipped: missing/empty/non-string `type` still
  // throws "missing chain.type", non-objects still throw "chain must be an
  // object", and malformed eip155/solana entries still throw — all via
  // `parseChain`, which stays strict (it is also used by the autocomplete
  // validator, where an unsupported chain must still be rejected).
  const chains: KhalaniChain[] = [];
  for (const entry of raw) {
    if (isRecordValue(entry)) {
      const type = entry.type;
      if (
        typeof type === "string" &&
        type.length > 0 &&
        type !== "eip155" &&
        type !== "solana"
      ) {
        continue;
      }
    }
    chains.push(parseChain(entry));
  }
  return chains;
}

export function validateTokensResponse(raw: unknown): KhalaniToken[] {
  if (!Array.isArray(raw)) {
    throw new VexError(ErrorCodes.KHALANI_API_ERROR, "Invalid Khalani response: expected token array");
  }
  return raw.map(parseToken);
}

export function validateTokenSearchResponse(raw: unknown): TokenSearchResponse {
  if (!isRecordValue(raw) || !Array.isArray(raw.data)) {
    throw new VexError(ErrorCodes.KHALANI_API_ERROR, "Invalid Khalani response: expected token search wrapper");
  }
  return { data: raw.data.map(parseToken) };
}

export function validateAutocompleteResponse(raw: unknown): AutocompleteResponse {
  if (!isRecordValue(raw) || !Array.isArray(raw.data)) {
    throw new VexError(ErrorCodes.KHALANI_API_ERROR, "Invalid Khalani response: expected autocomplete wrapper");
  }

  return {
    data: raw.data.map((entry) => {
      if (!isRecordValue(entry)) {
        throw new VexError(ErrorCodes.KHALANI_API_ERROR, "Invalid Khalani response: autocomplete entry must be an object");
      }
      return {
        description: parseOrThrow(asString("autocomplete.description"), entry.description),
        chain: parseChain(entry.chain),
        token: parseToken(entry.token),
        amount: parseOrThrow(asOptionalString, entry.amount),
        usdAmount: parseOrThrow(asOptionalString, entry.usdAmount),
      };
    }),
    parsed: isRecordValue(raw.parsed) ? raw.parsed : undefined,
    nextSlots: Array.isArray(raw.nextSlots)
      ? raw.nextSlots.filter((slot): slot is string => typeof slot === "string")
      : undefined,
  };
}

export function validateQuoteResponse(raw: unknown): QuoteResponse {
  if (!isRecordValue(raw) || !Array.isArray(raw.routes)) {
    throw new VexError(ErrorCodes.KHALANI_API_ERROR, "Invalid Khalani response: expected quote routes");
  }

  const quoteId = parseOrThrow(asString("quote.quoteId"), raw.quoteId);

  return {
    quoteId,
    routes: raw.routes.map((entry) => {
      if (!isRecordValue(entry) || !isRecordValue(entry.quote)) {
        throw new VexError(ErrorCodes.KHALANI_API_ERROR, "Invalid Khalani response: route must include quote");
      }
      const route = parseOrThrow(
        z.object({
          routeId: asString("route.routeId"),
          type: asString("route.type"),
          icon: asOptionalString,
          exactOutMethod: asOptionalString,
          depositMethods: asStringArray,
          quote: quoteBlockSchema("route.quote"),
        }),
        entry,
      );
      return {
        routeId: route.routeId,
        type: route.type,
        icon: route.icon,
        exactOutMethod: route.exactOutMethod,
        depositMethods: route.depositMethods as QuoteResponse["routes"][number]["depositMethods"],
        quote: route.quote,
      };
    }),
  };
}

export function validateQuoteStreamRoute(raw: unknown): QuoteStreamRoute {
  if (!isRecordValue(raw) || !isRecordValue(raw.quote)) {
    throw new VexError(ErrorCodes.KHALANI_API_ERROR, "Invalid Khalani stream response: expected route object");
  }

  const parsed = parseOrThrow(
    z.object({
      quoteId: asString("stream.quoteId"),
      routeId: asString("stream.routeId"),
      type: asString("stream.type"),
      icon: asOptionalString,
      exactOutMethod: asOptionalString,
      depositMethods: asStringArray,
      quote: quoteBlockSchema("stream.quote"),
    }),
    raw,
  );

  return {
    quoteId: parsed.quoteId,
    routeId: parsed.routeId,
    type: parsed.type,
    icon: parsed.icon,
    exactOutMethod: parsed.exactOutMethod,
    depositMethods: parsed.depositMethods as QuoteStreamRoute["depositMethods"],
    quote: parsed.quote,
  };
}

// ---------------------------------------------------------------------------
// Deposit plan (discriminated union by `kind`)
// ---------------------------------------------------------------------------

function parseApproval(item: unknown, idx: number): Approval {
  if (!isRecordValue(item)) {
    throw new VexError(ErrorCodes.KHALANI_API_ERROR, `Invalid Khalani response: approval[${idx}] must be an object`);
  }
  const type = parseOrThrow(asString(`approval[${idx}].type`), item.type);
  if (type === "eip1193_request") {
    const request = isRecordValue(item.request) ? item.request : {};
    return {
      type,
      request: {
        method: parseOrThrow(asString(`approval[${idx}].request.method`), request.method),
        params: Array.isArray(request.params) ? request.params : undefined,
      },
      waitForReceipt: item.waitForReceipt === true ? true : undefined,
      deposit: item.deposit === true ? true : undefined,
    };
  }
  if (type === "solana_sendTransaction") {
    return {
      type,
      transaction: parseOrThrow(asString(`approval[${idx}].transaction`), item.transaction),
      deposit: item.deposit === true ? true : undefined,
    };
  }
  throw new VexError(ErrorCodes.KHALANI_API_ERROR, `Invalid Khalani response: unsupported approval type ${type}`);
}

export function validateDepositPlan(raw: unknown): DepositPlan {
  if (!isRecordValue(raw)) {
    throw new VexError(ErrorCodes.KHALANI_API_ERROR, "Invalid Khalani response: expected deposit plan");
  }

  const kind = parseOrThrow(asString("deposit.kind"), raw.kind);
  if (kind === "CONTRACT_CALL") {
    const approvals = Array.isArray(raw.approvals)
      ? raw.approvals.map((item, idx) => parseApproval(item, idx))
      : [];
    return { kind, approvals };
  }
  if (kind === "PERMIT2") {
    if (!isRecordValue(raw.permit) || !isRecordValue(raw.transferDetails)) {
      throw new VexError(ErrorCodes.KHALANI_API_ERROR, "Invalid Khalani response: malformed PERMIT2 plan");
    }
    return {
      kind,
      permit: raw.permit,
      transferDetails: raw.transferDetails,
    };
  }
  if (kind === "TRANSFER") {
    const transfer = parseOrThrow(
      z.object({
        depositAddress: asString("deposit.depositAddress"),
        amount: asString("deposit.amount"),
        token: asString("deposit.token"),
        chainId: asNumber("deposit.chainId"),
        memo: asOptionalString,
        expiresAt: z.unknown().transform((v) => (typeof v === "number" ? v : undefined)),
      }),
      raw,
    );
    return {
      kind,
      depositAddress: transfer.depositAddress,
      amount: transfer.amount,
      token: transfer.token,
      chainId: transfer.chainId,
      memo: transfer.memo,
      expiresAt: transfer.expiresAt,
    };
  }

  throw new VexError(ErrorCodes.KHALANI_API_ERROR, `Invalid Khalani response: unsupported deposit kind ${kind}`);
}

export function validateSubmitResponse(raw: unknown): SubmitResponse {
  if (!isRecordValue(raw)) {
    throw new VexError(ErrorCodes.KHALANI_API_ERROR, "Invalid Khalani response: expected submit response");
  }
  return parseOrThrow(
    z.object({
      orderId: asString("submit.orderId"),
      txHash: asString("submit.txHash"),
    }),
    raw,
  );
}

export function validateOrdersResponse(raw: unknown): OrdersResponse {
  if (!isRecordValue(raw) || !Array.isArray(raw.data)) {
    throw new VexError(ErrorCodes.KHALANI_API_ERROR, "Invalid Khalani response: expected orders wrapper");
  }
  return {
    data: raw.data.map(parseOrder),
    cursor: typeof raw.cursor === "number" ? raw.cursor : undefined,
  };
}

export function validateOrderResponse(raw: unknown): KhalaniOrder {
  return parseOrder(raw);
}

export function isSolanaAddressLike(value: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value);
}
