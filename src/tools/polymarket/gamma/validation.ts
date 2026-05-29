/**
 * Zod response schemas + validators for the Polymarket Gamma API
 * (codex-002 Phase 2, full uniformity).
 *
 * Gamma serves market-discovery / event / search responses that feed UI and
 * (via market metadata such as conditionId / clobTokenIds / prices) downstream
 * trade decisions. The hand-written validators were MIXED:
 *
 *   - Most array/object validators throw a PLAIN `Error("...")` on a root-type
 *     mismatch (e.g. "Expected events array", "market must be an object"), then
 *     map/coerce every field with safe defaults (never rejecting a field).
 *   - `parseTag` and `validateRelatedTagsResponse` NEVER throw: a non-record /
 *     non-array input yields a default record / `[]`.
 *   - `validateSeriesResponse`, `validateCommentsResponse`,
 *     `validateSportsMetadataResponse`, `validateTeamsResponse` throw a plain
 *     `Error` per non-record ELEMENT (inside `.map`), matching the original.
 *
 * NOTE on error type: these validators threw plain `new Error(...)`, NOT
 * `VexError(POLYMARKET_API_ERROR)`. The conversion preserves the plain-Error
 * throw type + exact message for every failure mode. (`createFieldValidators`
 * was only used for its lenient `asOptionalString` / `asOptionalNumber`, which
 * never throw, so no VexError was ever produced here.)
 *
 * NOTE on numeric semantics — two DISTINCT checks are preserved:
 *   - `asOptionalNumber(x) ?? null` (from createFieldValidators): non-NaN number
 *     (incl. ±Infinity) → value; NaN / non-number → null. Mirrored by
 *     `zOptionalNumber` (which REJECTS NaN, ACCEPTS Infinity).
 *   - raw `typeof x === "number" ? x : <default>`: accepts ANY number including
 *     NaN and ±Infinity. Mirrored by a local `numOrDefault` transform. These are
 *     NOT interchangeable and NEITHER uses `z.number()` (which rejects Infinity).
 *
 * The schemas are intentionally NOT the type source of truth — the wire
 * interfaces in `types.ts` remain canonical, and each exported validator keeps
 * its declared return type so `tsc` verifies the inferred schema output is
 * assignable to that interface. The exported function API (names, signatures,
 * return types) is preserved so `client.ts` call sites stay unchanged.
 */

import { z } from "zod";
import {
  zOptionalString,
  zOptionalNumber,
} from "../../../utils/zod-validation-helpers.js";
import type {
  GammaEvent, GammaMarket, GammaTag, GammaRelatedTag,
  GammaSeries, GammaComment, GammaProfile, GammaSportsMetadata,
  GammaTeam, GammaSearchResult, GammaCommentProfile,
} from "./types.js";

// ── Local lenient primitives ───────────────────────────────────────────

/** Local `isRecord` (non-null, non-array object) used inside transforms. */
function isRecordValue(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * `asOptionalString(x) ?? null`: non-empty string → value, else `null`.
 * (zOptionalString yields `undefined` for bad input; `?? null` normalises it.)
 */
const optStringOrNull: z.ZodType<string | null> = zOptionalString.transform(
  (v) => v ?? null,
);

/**
 * `asOptionalNumber(x) ?? null`: non-NaN number (incl. ±Infinity) → value, else
 * `null`. zOptionalNumber REJECTS NaN / non-number (→ undefined), ACCEPTS
 * Infinity — matching `createFieldValidators.asOptionalNumber`.
 */
const optNumberOrNull: z.ZodType<number | null> = zOptionalNumber.transform(
  (v) => v ?? null,
);

/** `typeof v === "boolean" ? v : null`. */
const boolOrNull: z.ZodType<boolean | null> = z
  .unknown()
  .transform((v) => (typeof v === "boolean" ? v : null));

/**
 * `typeof v === "number" ? v : def` — accepts ANY number incl. NaN/±Infinity
 * (raw typeof check, NOT the asNumber/zNumberField guard). Used for the raw
 * `typeof x === "number"` fields the original did NOT route through
 * `asOptionalNumber`.
 */
const numOrDefault = <D extends number | null>(def: D): z.ZodType<number | D> =>
  z.unknown().transform((v) => (typeof v === "number" ? v : def));

/** `typeof v === "string" ? v : String(v ?? "")` — id coercion. */
const idString: z.ZodType<string> = z
  .unknown()
  .transform((v) => (typeof v === "string" ? v : String(v ?? "")));

/** `typeof v === "string" ? v : def` — plain string-or-default (NOT non-empty). */
const strOrDefault = (def: string): z.ZodType<string> =>
  z.unknown().transform((v) => (typeof v === "string" ? v : def));

// ── Tag (never throws — default record on non-object) ──────────────────

const tagSchema: z.ZodType<GammaTag> = z.unknown().transform((raw) => {
  if (!isRecordValue(raw)) {
    return { id: "", label: null, slug: null, forceShow: null, forceHide: null, isCarousel: null };
  }
  return {
    id: idString.parse(raw.id),
    label: optStringOrNull.parse(raw.label),
    slug: optStringOrNull.parse(raw.slug),
    forceShow: boolOrNull.parse(raw.forceShow),
    forceHide: boolOrNull.parse(raw.forceHide),
    isCarousel: boolOrNull.parse(raw.isCarousel),
  };
});

function parseTag(raw: unknown): GammaTag {
  return tagSchema.parse(raw);
}

// ── Market (throws plain Error on non-record root) ─────────────────────

const marketSchema: z.ZodType<GammaMarket> = z.unknown().transform((raw) => {
  if (!isRecordValue(raw)) throw new Error("market must be an object");
  return {
    id: idString.parse(raw.id),
    question: optStringOrNull.parse(raw.question),
    conditionId: strOrDefault("").parse(raw.conditionId),
    slug: optStringOrNull.parse(raw.slug),
    description: optStringOrNull.parse(raw.description),
    image: optStringOrNull.parse(raw.image),
    outcomes: optStringOrNull.parse(raw.outcomes),
    outcomePrices: optStringOrNull.parse(raw.outcomePrices),
    volume: optStringOrNull.parse(raw.volume),
    volumeNum: optNumberOrNull.parse(raw.volumeNum),
    liquidity: optStringOrNull.parse(raw.liquidity),
    liquidityNum: optNumberOrNull.parse(raw.liquidityNum),
    active: boolOrNull.parse(raw.active),
    closed: boolOrNull.parse(raw.closed),
    endDate: optStringOrNull.parse(raw.endDate),
    clobTokenIds: optStringOrNull.parse(raw.clobTokenIds),
    bestBid: optNumberOrNull.parse(raw.bestBid),
    bestAsk: optNumberOrNull.parse(raw.bestAsk),
    lastTradePrice: optNumberOrNull.parse(raw.lastTradePrice),
    oneDayPriceChange: optNumberOrNull.parse(raw.oneDayPriceChange),
    spread: optNumberOrNull.parse(raw.spread),
    orderPriceMinTickSize: optNumberOrNull.parse(raw.orderPriceMinTickSize),
    orderMinSize: optNumberOrNull.parse(raw.orderMinSize),
    acceptingOrders: boolOrNull.parse(raw.acceptingOrders),
    negRisk: boolOrNull.parse(raw.negRisk),
    volume24hr: optNumberOrNull.parse(raw.volume24hr),
    category: optStringOrNull.parse(raw.category),
    marketMakerAddress: strOrDefault("").parse(raw.marketMakerAddress),
  };
});

function parseMarket(raw: unknown): GammaMarket {
  return marketSchema.parse(raw);
}

// ── Event (throws plain Error on non-record root) ──────────────────────

const eventSchema: z.ZodType<GammaEvent> = z.unknown().transform((raw) => {
  if (!isRecordValue(raw)) throw new Error("event must be an object");
  return {
    id: idString.parse(raw.id),
    ticker: optStringOrNull.parse(raw.ticker),
    slug: optStringOrNull.parse(raw.slug),
    title: optStringOrNull.parse(raw.title),
    subtitle: optStringOrNull.parse(raw.subtitle),
    description: optStringOrNull.parse(raw.description),
    image: optStringOrNull.parse(raw.image),
    icon: optStringOrNull.parse(raw.icon),
    active: boolOrNull.parse(raw.active),
    closed: boolOrNull.parse(raw.closed),
    featured: boolOrNull.parse(raw.featured),
    restricted: boolOrNull.parse(raw.restricted),
    liquidity: optNumberOrNull.parse(raw.liquidity),
    volume: optNumberOrNull.parse(raw.volume),
    openInterest: optNumberOrNull.parse(raw.openInterest),
    category: optStringOrNull.parse(raw.category),
    subcategory: optStringOrNull.parse(raw.subcategory),
    startDate: optStringOrNull.parse(raw.startDate),
    endDate: optStringOrNull.parse(raw.endDate),
    negRisk: boolOrNull.parse(raw.negRisk),
    negRiskMarketID: optStringOrNull.parse(raw.negRiskMarketID),
    // raw typeof number → accepts NaN/Infinity; non-number → null.
    commentCount: numOrDefault<null>(null).parse(raw.commentCount),
    volume24hr: optNumberOrNull.parse(raw.volume24hr),
    // Non-array → []; array → element-mapped (each element throws if non-record).
    markets: Array.isArray(raw.markets) ? raw.markets.map(parseMarket) : [],
    tags: Array.isArray(raw.tags) ? raw.tags.map(parseTag) : [],
  };
});

export function parseEvent(raw: unknown): GammaEvent {
  return eventSchema.parse(raw);
}

// ── Array / object exported validators ─────────────────────────────────

export function validateEventsResponse(raw: unknown): GammaEvent[] {
  if (!Array.isArray(raw)) throw new Error("Expected events array");
  return raw.map(parseEvent);
}

export function validateEventResponse(raw: unknown): GammaEvent {
  return parseEvent(raw);
}

export function validateMarketsResponse(raw: unknown): GammaMarket[] {
  if (!Array.isArray(raw)) throw new Error("Expected markets array");
  return raw.map(parseMarket);
}

export function validateMarketResponse(raw: unknown): GammaMarket {
  return parseMarket(raw);
}

export function validateTagsResponse(raw: unknown): GammaTag[] {
  if (!Array.isArray(raw)) throw new Error("Expected tags array");
  return raw.map(parseTag);
}

// ── Related tags (never throws — [] on non-array; default record per element) ──

const relatedTagSchema: z.ZodType<GammaRelatedTag> = z.unknown().transform((r) => {
  if (!isRecordValue(r)) return { id: "", tagID: null, relatedTagID: null, rank: null };
  return {
    id: strOrDefault("").parse(r.id),
    // raw typeof number → accepts NaN/Infinity; else null.
    tagID: numOrDefault<null>(null).parse(r.tagID),
    relatedTagID: numOrDefault<null>(null).parse(r.relatedTagID),
    rank: numOrDefault<null>(null).parse(r.rank),
  };
});

export function validateRelatedTagsResponse(raw: unknown): GammaRelatedTag[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((r) => relatedTagSchema.parse(r));
}

// ── Series (throws plain Error on non-array root + per non-record element) ──

const seriesSchema: z.ZodType<GammaSeries> = z.unknown().transform((r) => {
  if (!isRecordValue(r)) throw new Error("series entry must be an object");
  return {
    id: idString.parse(r.id),
    slug: optStringOrNull.parse(r.slug),
    title: optStringOrNull.parse(r.title),
    description: optStringOrNull.parse(r.description),
    image: optStringOrNull.parse(r.image),
    active: boolOrNull.parse(r.active),
    closed: boolOrNull.parse(r.closed),
    volume: optNumberOrNull.parse(r.volume),
    liquidity: optNumberOrNull.parse(r.liquidity),
    events: Array.isArray(r.events) ? r.events.map(parseEvent) : [],
  };
});

export function validateSeriesResponse(raw: unknown): GammaSeries[] {
  if (!Array.isArray(raw)) throw new Error("Expected series array");
  return raw.map((r) => seriesSchema.parse(r));
}

// ── Comments (throws plain Error on non-array root + per non-record element) ──

const commentProfileSchema: z.ZodType<GammaCommentProfile> = z.unknown().transform((p) => {
  // Only reached when p is a record (gated by isRecord in the parent).
  const r = p as Record<string, unknown>;
  return {
    name: optStringOrNull.parse(r.name),
    pseudonym: optStringOrNull.parse(r.pseudonym),
    bio: optStringOrNull.parse(r.bio),
    proxyWallet: optStringOrNull.parse(r.proxyWallet),
    profileImage: optStringOrNull.parse(r.profileImage),
  };
});

const commentSchema: z.ZodType<GammaComment> = z.unknown().transform((r) => {
  if (!isRecordValue(r)) throw new Error("comment must be an object");
  const profile: GammaCommentProfile | null = isRecordValue(r.profile)
    ? commentProfileSchema.parse(r.profile)
    : null;
  return {
    id: idString.parse(r.id),
    body: optStringOrNull.parse(r.body),
    parentEntityType: optStringOrNull.parse(r.parentEntityType),
    // raw typeof number → accepts NaN/Infinity; else null.
    parentEntityID: numOrDefault<null>(null).parse(r.parentEntityID),
    userAddress: optStringOrNull.parse(r.userAddress),
    createdAt: optStringOrNull.parse(r.createdAt),
    profile,
    reactionCount: numOrDefault<null>(null).parse(r.reactionCount),
  };
});

export function validateCommentsResponse(raw: unknown): GammaComment[] {
  if (!Array.isArray(raw)) throw new Error("Expected comments array");
  return raw.map((r) => commentSchema.parse(r));
}

// ── Profile (throws plain Error on non-record root) ────────────────────

const profileSchema: z.ZodType<GammaProfile> = z.unknown().transform((raw) => {
  if (!isRecordValue(raw)) throw new Error("Expected profile object");
  return {
    proxyWallet: optStringOrNull.parse(raw.proxyWallet),
    name: optStringOrNull.parse(raw.name),
    pseudonym: optStringOrNull.parse(raw.pseudonym),
    bio: optStringOrNull.parse(raw.bio),
    profileImage: optStringOrNull.parse(raw.profileImage),
    displayUsernamePublic: boolOrNull.parse(raw.displayUsernamePublic),
    xUsername: optStringOrNull.parse(raw.xUsername),
    verifiedBadge: boolOrNull.parse(raw.verifiedBadge),
  };
});

export function validateProfileResponse(raw: unknown): GammaProfile {
  return profileSchema.parse(raw);
}

// ── Search (throws plain Error on non-record root; sections null on non-array) ──

type GammaSearchTag = NonNullable<GammaSearchResult["tags"]>[number];
type GammaSearchProfile = NonNullable<GammaSearchResult["profiles"]>[number];

const searchTagSchema: z.ZodType<GammaSearchTag> = z.unknown().transform((t) => {
  if (!isRecordValue(t)) return { id: "", label: "", slug: "", event_count: 0 };
  return {
    id: strOrDefault("").parse(t.id),
    label: strOrDefault("").parse(t.label),
    slug: strOrDefault("").parse(t.slug),
    // raw typeof number → accepts NaN/Infinity; else 0.
    event_count: numOrDefault(0).parse(t.event_count),
  };
});

const searchProfileSchema: z.ZodType<GammaSearchProfile> = z.unknown().transform((p) => {
  if (!isRecordValue(p)) return { id: "", name: null, pseudonym: null, proxyWallet: null, profileImage: null };
  return {
    id: strOrDefault("").parse(p.id),
    name: optStringOrNull.parse(p.name),
    pseudonym: optStringOrNull.parse(p.pseudonym),
    proxyWallet: optStringOrNull.parse(p.proxyWallet),
    profileImage: optStringOrNull.parse(p.profileImage),
  };
});

export function validateSearchResponse(raw: unknown): GammaSearchResult {
  if (!isRecordValue(raw)) throw new Error("Expected search result object");
  return {
    events: Array.isArray(raw.events) ? raw.events.map(parseEvent) : null,
    tags: Array.isArray(raw.tags) ? raw.tags.map((t: unknown) => searchTagSchema.parse(t)) : null,
    profiles: Array.isArray(raw.profiles) ? raw.profiles.map((p: unknown) => searchProfileSchema.parse(p)) : null,
    pagination: isRecordValue(raw.pagination)
      ? {
          // raw typeof checks: bool → value else false; number → value (incl.
          // NaN/Infinity) else 0.
          hasMore: typeof raw.pagination.hasMore === "boolean" ? raw.pagination.hasMore : false,
          totalResults: typeof raw.pagination.totalResults === "number" ? raw.pagination.totalResults : 0,
        }
      : null,
  };
}

// ── Sports metadata (throws plain Error on non-array root + per element) ──

const sportsMetadataSchema: z.ZodType<GammaSportsMetadata> = z.unknown().transform((r) => {
  if (!isRecordValue(r)) throw new Error("sport must be an object");
  return {
    sport: strOrDefault("").parse(r.sport),
    image: optStringOrNull.parse(r.image),
    resolution: optStringOrNull.parse(r.resolution),
    ordering: optStringOrNull.parse(r.ordering),
    tags: optStringOrNull.parse(r.tags),
    series: optStringOrNull.parse(r.series),
  };
});

export function validateSportsMetadataResponse(raw: unknown): GammaSportsMetadata[] {
  if (!Array.isArray(raw)) throw new Error("Expected sports metadata array");
  return raw.map((r) => sportsMetadataSchema.parse(r));
}

// ── Teams (throws plain Error on non-array root + per element) ─────────

const teamSchema: z.ZodType<GammaTeam> = z.unknown().transform((r) => {
  if (!isRecordValue(r)) throw new Error("team must be an object");
  return {
    // raw typeof number → accepts NaN/Infinity; else 0.
    id: numOrDefault(0).parse(r.id),
    name: optStringOrNull.parse(r.name),
    league: optStringOrNull.parse(r.league),
    record: optStringOrNull.parse(r.record),
    logo: optStringOrNull.parse(r.logo),
    abbreviation: optStringOrNull.parse(r.abbreviation),
  };
});

export function validateTeamsResponse(raw: unknown): GammaTeam[] {
  if (!Array.isArray(raw)) throw new Error("Expected teams array");
  return raw.map((r) => teamSchema.parse(r));
}
