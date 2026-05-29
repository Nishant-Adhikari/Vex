/**
 * Zod response schemas + validators for the DexScreener REST/WS API
 * (codex-002 Phase 2, full uniformity).
 *
 * These gate the SHAPE of pair/profile/boost/order/ad responses at the HTTP
 * (and WS) boundary before the values feed UI + bot decisions. DexScreener uses
 * the STRICT pattern at the response level: a malformed REQUIRED field, or a
 * wrong-typed root (non-record object / non-array array), throws
 * `VexError(DEXSCREENER_INVALID_RESPONSE)` with a field-path message — exactly
 * the message the hand-written `asString` / `asNumber` / root guards produced.
 *
 * DexScreener-specific note: this module's `asOptionalString` / `asOptionalNumber`
 * return `null` (NOT `undefined`) and the wire types use `string | null` /
 * `number | null`, so the SHARED `zOptionalString` / `zOptionalNumber` helpers
 * (which return `undefined`) are intentionally NOT used — local `null`-returning
 * primitives mirror the original exactly. `zNumberField` IS used for required
 * numbers (accepts ±Infinity, rejects NaN — matching the original `asNumber`).
 *
 * Lenient sub-parsers (txns, volume, liquidity, info, boosts, labels, links,
 * priceChange, quoteToken) never throw — they fall back to the original
 * default/null/[]/{} shapes, with element-wise array filtering.
 *
 * The schemas are intentionally NOT the type source of truth — the wire
 * interfaces in `types.ts` remain canonical, and each exported validator keeps
 * its declared return type so `tsc` verifies the inferred schema output is
 * assignable to that interface. The exported function API (names, signatures,
 * return types) is preserved so `client.ts` / `ws-client.ts` call sites stay
 * unchanged.
 */

import { z } from "zod";
import { VexError, ErrorCodes } from "../../errors.js";
import { isRecord } from "../../utils/validation-helpers.js";
import { zNumberField } from "../../utils/zod-validation-helpers.js";
import type {
  DexAd,
  DexBoost,
  DexBoosts,
  DexCommunityTakeover,
  DexLink,
  DexLiquidity,
  DexOrder,
  DexPair,
  DexPairInfo,
  DexQuoteToken,
  DexToken,
  DexTokenProfile,
  DexTxnCounts,
  PairsResponse,
  SearchResponse,
  TokensPairsResponse,
  TokensResponse,
  WsHandshake,
} from "./types.js";

// ---------------------------------------------------------------------------
// Throw helper — reproduces the original VexError(DEXSCREENER_INVALID_RESPONSE).
// ---------------------------------------------------------------------------

/**
 * Parse `raw` with `schema`, returning the typed value or throwing the SAME
 * `VexError(DEXSCREENER_INVALID_RESPONSE, msg)` the hand-written validator would
 * have. The thrown message is the first Zod issue's message; required-field
 * rules below carry the original `expected <type> for <field>` field-path
 * message in the ORIGINAL declaration order, so the surfaced message matches the
 * original short-circuit throw.
 */
function parseOrThrow<T>(schema: z.ZodType<T>, raw: unknown): T {
  const result = schema.safeParse(raw);
  if (result.success) {
    return result.data;
  }
  const issue = result.error.issues[0];
  throw new VexError(ErrorCodes.DEXSCREENER_INVALID_RESPONSE, issue.message);
}

// ---------------------------------------------------------------------------
// Field primitives — mirror the original DexScreener helpers EXACTLY.
//
// NOTE: the originals throw the SAME message regardless of which check fails,
// and the optional helpers return `null` (not `undefined`).
// ---------------------------------------------------------------------------

/** `asString(value, field)`: non-empty string, else `expected string for <field>`. */
function asString(field: string): z.ZodType<string> {
  const message = `Invalid DexScreener response: expected string for ${field}`;
  return z.string({ error: message }).min(1, { error: message });
}

/** `asNumber(value, field)`: any non-NaN number (incl. ±Infinity), else `expected number for <field>`. */
function asNumber(field: string): z.ZodType<number> {
  // Shared primitive — guards `typeof v === "number" && !Number.isNaN(v)`
  // (accepts Infinity, which Zod 4 `z.number()` would wrongly reject).
  return zNumberField(`Invalid DexScreener response: expected number for ${field}`);
}

/** `asOptionalString`: non-empty string else `null` (never throws). DexScreener returns null. */
const asOptionalString: z.ZodType<string | null> = z
  .unknown()
  .transform((v) => (typeof v === "string" && v.length > 0 ? v : null));

/** `asOptionalNumber`: non-NaN number else `null` (never throws). DexScreener returns null. */
const asOptionalNumber: z.ZodType<number | null> = z
  .unknown()
  .transform((v) => (typeof v === "number" && !Number.isNaN(v) ? v : null));

/** `typeof v === "string" ? v : def` (note: accepts empty string, unlike asString). */
const strDefault = (def: string): z.ZodType<string> =>
  z.unknown().transform((v) => (typeof v === "string" ? v : def));

// ---------------------------------------------------------------------------
// Token parsers (strict root, then field rules).
// ---------------------------------------------------------------------------

const baseTokenObjectSchema = z.object({
  address: asString("baseToken.address"),
  name: asString("baseToken.name"),
  symbol: asString("baseToken.symbol"),
});

function parseBaseToken(raw: unknown): DexToken {
  if (!isRecord(raw)) {
    throw new VexError(ErrorCodes.DEXSCREENER_INVALID_RESPONSE, "Invalid DexScreener response: baseToken must be an object");
  }
  return parseOrThrow(baseTokenObjectSchema, raw);
}

/** quoteToken: non-record → throws; all fields optional-string (null fallback). */
const quoteTokenObjectSchema: z.ZodType<DexQuoteToken> = z.object({
  address: asOptionalString,
  name: asOptionalString,
  symbol: asOptionalString,
});

function parseQuoteToken(raw: unknown): DexQuoteToken {
  if (!isRecord(raw)) {
    throw new VexError(ErrorCodes.DEXSCREENER_INVALID_RESPONSE, "Invalid DexScreener response: quoteToken must be an object");
  }
  return parseOrThrow(quoteTokenObjectSchema, raw);
}

// ---------------------------------------------------------------------------
// Nested object parsers (LENIENT — never throw; default/null on bad input).
// ---------------------------------------------------------------------------

/**
 * `parseTxnCounts`: non-record root → {}. Per entry: only record values are
 * kept; buys/sells fall back to 0 when not a number (typeof check accepts
 * NaN/Infinity). Non-record entries are SKIPPED (not added).
 */
const txnCountsSchema: z.ZodType<Record<string, DexTxnCounts>> = z.unknown().transform((raw) => {
  if (!isRecord(raw)) return {};
  const result: Record<string, DexTxnCounts> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (isRecord(value)) {
      result[key] = {
        buys: typeof value.buys === "number" ? value.buys : 0,
        sells: typeof value.sells === "number" ? value.sells : 0,
      };
    }
  }
  return result;
});

/**
 * `parseNumberRecord`: non-record root → {}. Keeps only `typeof === "number"`
 * values (accepts NaN/Infinity). Non-number values skipped.
 */
const numberRecordSchema: z.ZodType<Record<string, number>> = z.unknown().transform((raw) => {
  if (!isRecord(raw)) return {};
  const result: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "number") {
      result[key] = value;
    }
  }
  return result;
});

/**
 * `parsePair.priceChange`: `isRecord(raw.priceChange) ? parseNumberRecord(...)
 * : null`. Differs from `numberRecordSchema` which returns {} on non-record;
 * here a non-record root → null.
 */
const priceChangeSchema: z.ZodType<Record<string, number> | null> = z.unknown().transform((raw) => {
  if (!isRecord(raw)) return null;
  const result: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "number") {
      result[key] = value;
    }
  }
  return result;
});

/** `parseLiquidity`: non-record → null; usd optional-number; base/quote → 0 default. */
const liquiditySchema: z.ZodType<DexLiquidity | null> = z.unknown().transform((raw) => {
  if (!isRecord(raw)) return null;
  return {
    usd: typeof raw.usd === "number" && !Number.isNaN(raw.usd) ? raw.usd : null,
    base: typeof raw.base === "number" ? raw.base : 0,
    quote: typeof raw.quote === "number" ? raw.quote : 0,
  };
});

/** `parseInfo`: non-record → null; websites/socials element-wise filtered records, else null. */
const infoSchema: z.ZodType<DexPairInfo | null> = z.unknown().transform((raw) => {
  if (!isRecord(raw)) return null;
  return {
    imageUrl: typeof raw.imageUrl === "string" && raw.imageUrl.length > 0 ? raw.imageUrl : null,
    websites: Array.isArray(raw.websites)
      ? raw.websites.filter(isRecord).map((w) => ({ url: typeof w.url === "string" ? w.url : "" }))
      : null,
    socials: Array.isArray(raw.socials)
      ? raw.socials.filter(isRecord).map((s) => ({
          platform: typeof s.platform === "string" ? s.platform : "",
          handle: typeof s.handle === "string" ? s.handle : "",
        }))
      : null,
  };
});

/** `parseBoosts`: non-record → null; active → 0 default. */
const boostsSchema: z.ZodType<DexBoosts | null> = z.unknown().transform((raw) => {
  if (!isRecord(raw)) return null;
  return { active: typeof raw.active === "number" ? raw.active : 0 };
});

/** `parseLabels`: non-array → null; else element-wise string filter. */
const labelsSchema: z.ZodType<string[] | null> = z.unknown().transform((raw) =>
  Array.isArray(raw) ? raw.filter((item): item is string => typeof item === "string") : null,
);

// ---------------------------------------------------------------------------
// Pair parser (strict root; field order mirrors the original return literal).
// ---------------------------------------------------------------------------

const pairObjectSchema: z.ZodType<DexPair> = z
  .object({
    chainId: asString("pair.chainId"),
    dexId: asString("pair.dexId"),
    url: asString("pair.url"),
    pairAddress: asString("pair.pairAddress"),
    labels: labelsSchema,
    baseToken: z.unknown().transform((v) => parseBaseToken(v)),
    quoteToken: z.unknown().transform((v) => parseQuoteToken(v)),
    priceNative: asString("pair.priceNative"),
    priceUsd: asOptionalString,
    txns: txnCountsSchema,
    volume: numberRecordSchema,
    priceChange: priceChangeSchema,
    liquidity: liquiditySchema,
    fdv: asOptionalNumber,
    marketCap: asOptionalNumber,
    pairCreatedAt: asOptionalNumber,
    info: infoSchema,
    boosts: boostsSchema,
  })
  .transform((p) => ({
    chainId: p.chainId,
    dexId: p.dexId,
    url: p.url,
    pairAddress: p.pairAddress,
    labels: p.labels,
    baseToken: p.baseToken,
    quoteToken: p.quoteToken,
    priceNative: p.priceNative,
    priceUsd: p.priceUsd,
    txns: p.txns,
    volume: p.volume,
    priceChange: p.priceChange,
    liquidity: p.liquidity,
    fdv: p.fdv,
    marketCap: p.marketCap,
    pairCreatedAt: p.pairCreatedAt,
    info: p.info,
    boosts: p.boosts,
  }));

function parsePair(raw: unknown): DexPair {
  if (!isRecord(raw)) {
    throw new VexError(ErrorCodes.DEXSCREENER_INVALID_RESPONSE, "Invalid DexScreener response: pair must be an object");
  }
  return parseOrThrow(pairObjectSchema, raw);
}

// ---------------------------------------------------------------------------
// Response validators
// ---------------------------------------------------------------------------

export function validatePairsResponse(raw: unknown): PairsResponse {
  if (!isRecord(raw)) {
    throw new VexError(ErrorCodes.DEXSCREENER_INVALID_RESPONSE, "Invalid DexScreener response: expected pairs response object");
  }
  return {
    schemaVersion: typeof raw.schemaVersion === "string" ? raw.schemaVersion : "",
    // `.map(parsePair)` throws per-element on a non-record element — preserved.
    pairs: Array.isArray(raw.pairs) ? raw.pairs.map(parsePair) : null,
  };
}

export function validateSearchResponse(raw: unknown): SearchResponse {
  if (!isRecord(raw)) {
    throw new VexError(ErrorCodes.DEXSCREENER_INVALID_RESPONSE, "Invalid DexScreener response: expected search response object");
  }
  return {
    schemaVersion: typeof raw.schemaVersion === "string" ? raw.schemaVersion : "",
    pairs: Array.isArray(raw.pairs) ? raw.pairs.map(parsePair) : [],
  };
}

export function validateTokensResponse(raw: unknown): TokensResponse {
  if (!Array.isArray(raw)) {
    throw new VexError(ErrorCodes.DEXSCREENER_INVALID_RESPONSE, "Invalid DexScreener response: expected tokens array");
  }
  return raw.map(parsePair);
}

export function validateTokensPairsResponse(raw: unknown): TokensPairsResponse {
  if (!Array.isArray(raw)) {
    throw new VexError(ErrorCodes.DEXSCREENER_INVALID_RESPONSE, "Invalid DexScreener response: expected token-pairs array");
  }
  return raw.map(parsePair);
}

// ---------------------------------------------------------------------------
// Links parser (shared by profiles + boosts; LENIENT — element-wise filter).
// ---------------------------------------------------------------------------

/** `parseLinks`: non-array → null; else `filter(isRecord).map(...)`. */
const linksSchema: z.ZodType<DexLink[] | null> = z.unknown().transform((raw) => {
  if (!Array.isArray(raw)) return null;
  return raw.filter(isRecord).map((item) => ({
    type: typeof item.type === "string" && item.type.length > 0 ? item.type : null,
    label: typeof item.label === "string" && item.label.length > 0 ? item.label : null,
    url: typeof item.url === "string" ? item.url : "",
  }));
});

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------

const profileObjectSchema: z.ZodType<DexTokenProfile> = z
  .object({
    url: asString("profile.url"),
    chainId: asString("profile.chainId"),
    tokenAddress: asString("profile.tokenAddress"),
    icon: strDefault(""),
    header: asOptionalString,
    description: asOptionalString,
    links: linksSchema,
  })
  .transform((p) => ({
    url: p.url,
    chainId: p.chainId,
    tokenAddress: p.tokenAddress,
    icon: p.icon,
    header: p.header,
    description: p.description,
    links: p.links,
  }));

function parseProfile(raw: unknown): DexTokenProfile {
  if (!isRecord(raw)) {
    throw new VexError(ErrorCodes.DEXSCREENER_INVALID_RESPONSE, "Invalid DexScreener response: profile must be an object");
  }
  return parseOrThrow(profileObjectSchema, raw);
}

export function validateProfilesResponse(raw: unknown): DexTokenProfile[] {
  if (!Array.isArray(raw)) {
    throw new VexError(ErrorCodes.DEXSCREENER_INVALID_RESPONSE, "Invalid DexScreener response: expected profiles array");
  }
  return raw.map(parseProfile);
}

// ---------------------------------------------------------------------------
// Boosts
// ---------------------------------------------------------------------------

const boostObjectSchema: z.ZodType<DexBoost> = z
  .object({
    url: asString("boost.url"),
    chainId: asString("boost.chainId"),
    tokenAddress: asString("boost.tokenAddress"),
    amount: asNumber("boost.amount"),
    totalAmount: asNumber("boost.totalAmount"),
    icon: asOptionalString,
    header: asOptionalString,
    description: asOptionalString,
    links: linksSchema,
  })
  .transform((b) => ({
    url: b.url,
    chainId: b.chainId,
    tokenAddress: b.tokenAddress,
    amount: b.amount,
    totalAmount: b.totalAmount,
    icon: b.icon,
    header: b.header,
    description: b.description,
    links: b.links,
  }));

function parseBoost(raw: unknown): DexBoost {
  if (!isRecord(raw)) {
    throw new VexError(ErrorCodes.DEXSCREENER_INVALID_RESPONSE, "Invalid DexScreener response: boost must be an object");
  }
  return parseOrThrow(boostObjectSchema, raw);
}

export function validateBoostsResponse(raw: unknown): DexBoost[] {
  if (!Array.isArray(raw)) {
    throw new VexError(ErrorCodes.DEXSCREENER_INVALID_RESPONSE, "Invalid DexScreener response: expected boosts array");
  }
  return raw.map(parseBoost);
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

const orderObjectSchema: z.ZodType<DexOrder> = z
  .object({
    // The original casts `asString(...)` to the enum types WITHOUT validating
    // membership, so any non-empty string passes. Preserved: required string +
    // local cast (no enum check).
    type: asString("order.type"),
    status: asString("order.status"),
    paymentTimestamp: asNumber("order.paymentTimestamp"),
  })
  .transform((o) => ({
    type: o.type as DexOrder["type"],
    status: o.status as DexOrder["status"],
    paymentTimestamp: o.paymentTimestamp,
  }));

function parseOrder(raw: unknown): DexOrder {
  if (!isRecord(raw)) {
    throw new VexError(ErrorCodes.DEXSCREENER_INVALID_RESPONSE, "Invalid DexScreener response: order must be an object");
  }
  return parseOrThrow(orderObjectSchema, raw);
}

export function validateOrdersResponse(raw: unknown): DexOrder[] {
  if (!Array.isArray(raw)) {
    throw new VexError(ErrorCodes.DEXSCREENER_INVALID_RESPONSE, "Invalid DexScreener response: expected orders array");
  }
  return raw.map(parseOrder);
}

// ---------------------------------------------------------------------------
// WebSocket handshake
// ---------------------------------------------------------------------------

export function validateWsHandshake<T>(
  raw: unknown,
  itemValidator: (item: unknown) => T,
): WsHandshake<T> {
  if (!isRecord(raw)) {
    throw new VexError(ErrorCodes.DEXSCREENER_INVALID_RESPONSE, "Invalid DexScreener WS handshake: expected object");
  }
  return {
    limit: typeof raw.limit === "number" ? raw.limit : 0,
    data: Array.isArray(raw.data) ? raw.data.map(itemValidator) : [],
  };
}

export function validateWsProfile(raw: unknown): DexTokenProfile {
  return parseProfile(raw);
}

export function validateWsBoost(raw: unknown): DexBoost {
  return parseBoost(raw);
}

// ---------------------------------------------------------------------------
// Community Takeovers
// ---------------------------------------------------------------------------

const communityTakeoverObjectSchema: z.ZodType<DexCommunityTakeover> = z
  .object({
    url: asString("cto.url"),
    chainId: asString("cto.chainId"),
    tokenAddress: asString("cto.tokenAddress"),
    icon: strDefault(""),
    header: asOptionalString,
    description: asOptionalString,
    links: linksSchema,
    claimDate: asString("cto.claimDate"),
  })
  .transform((c) => ({
    url: c.url,
    chainId: c.chainId,
    tokenAddress: c.tokenAddress,
    icon: c.icon,
    header: c.header,
    description: c.description,
    links: c.links,
    claimDate: c.claimDate,
  }));

function parseCommunityTakeover(raw: unknown): DexCommunityTakeover {
  if (!isRecord(raw)) {
    throw new VexError(ErrorCodes.DEXSCREENER_INVALID_RESPONSE, "Invalid DexScreener response: community takeover must be an object");
  }
  return parseOrThrow(communityTakeoverObjectSchema, raw);
}

export function validateCommunityTakeoversResponse(raw: unknown): DexCommunityTakeover[] {
  if (!Array.isArray(raw)) {
    throw new VexError(ErrorCodes.DEXSCREENER_INVALID_RESPONSE, "Invalid DexScreener response: expected community takeovers array");
  }
  return raw.map(parseCommunityTakeover);
}

export function validateWsCommunityTakeover(raw: unknown): DexCommunityTakeover {
  return parseCommunityTakeover(raw);
}

// ---------------------------------------------------------------------------
// Ads
// ---------------------------------------------------------------------------

const adObjectSchema: z.ZodType<DexAd> = z
  .object({
    url: asString("ad.url"),
    chainId: asString("ad.chainId"),
    tokenAddress: asString("ad.tokenAddress"),
    date: asString("ad.date"),
    type: asString("ad.type"),
    durationHours: asOptionalNumber,
    impressions: asOptionalNumber,
  })
  .transform((a) => ({
    url: a.url,
    chainId: a.chainId,
    tokenAddress: a.tokenAddress,
    date: a.date,
    type: a.type,
    durationHours: a.durationHours,
    impressions: a.impressions,
  }));

function parseAd(raw: unknown): DexAd {
  if (!isRecord(raw)) {
    throw new VexError(ErrorCodes.DEXSCREENER_INVALID_RESPONSE, "Invalid DexScreener response: ad must be an object");
  }
  return parseOrThrow(adObjectSchema, raw);
}

export function validateAdsResponse(raw: unknown): DexAd[] {
  if (!Array.isArray(raw)) {
    throw new VexError(ErrorCodes.DEXSCREENER_INVALID_RESPONSE, "Invalid DexScreener response: expected ads array");
  }
  return raw.map(parseAd);
}

export function validateWsAd(raw: unknown): DexAd {
  return parseAd(raw);
}
