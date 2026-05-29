/**
 * codex-002 Phase 2 — behavior-preservation (equivalence) tests for the Zod
 * rewrite of `src/tools/polymarket/gamma/validation.ts`.
 *
 * Gamma validators are MIXED:
 *   - Object/array validators throw a PLAIN `Error("...")` on a root-type
 *     mismatch, then field-default (never reject a field).
 *   - `parseTag` (via validateTagsResponse element default) and
 *     `validateRelatedTagsResponse` NEVER throw (default record / []).
 *   - series / comments / sports / teams throw a plain `Error` per non-record
 *     ELEMENT inside `.map`.
 *
 * This file pins the NEW implementation against an inline ORACLE that
 * reproduces the ORIGINAL hand-written logic verbatim, over a battery of:
 * fully-valid, partial/missing (each default asserted), wrong-typed, arrays
 * with bad elements, non-record/non-array roots, and the two distinct numeric
 * semantics (asOptionalNumber rejects NaN/accepts Infinity; raw typeof accepts
 * both).
 */

import { describe, it, expect } from "vitest";
import {
  validateEventsResponse, validateEventResponse,
  validateMarketsResponse, validateMarketResponse,
  validateTagsResponse, validateRelatedTagsResponse,
  validateSeriesResponse, validateCommentsResponse,
  validateProfileResponse, validateSearchResponse,
  validateSportsMetadataResponse, validateTeamsResponse,
  parseEvent,
} from "@tools/polymarket/gamma/validation.js";

// ── ORACLE: verbatim reproduction of the ORIGINAL hand-written logic ───

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function oAsOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
function oAsOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && !Number.isNaN(value) ? value : undefined;
}

function oParseTag(raw: unknown) {
  if (!isRecord(raw)) return { id: "", label: null, slug: null, forceShow: null, forceHide: null, isCarousel: null };
  return {
    id: typeof raw.id === "string" ? raw.id : String(raw.id ?? ""),
    label: oAsOptionalString(raw.label) ?? null,
    slug: oAsOptionalString(raw.slug) ?? null,
    forceShow: typeof raw.forceShow === "boolean" ? raw.forceShow : null,
    forceHide: typeof raw.forceHide === "boolean" ? raw.forceHide : null,
    isCarousel: typeof raw.isCarousel === "boolean" ? raw.isCarousel : null,
  };
}
function oParseMarket(raw: unknown) {
  if (!isRecord(raw)) throw new Error("market must be an object");
  return {
    id: typeof raw.id === "string" ? raw.id : String(raw.id ?? ""),
    question: oAsOptionalString(raw.question) ?? null,
    conditionId: typeof raw.conditionId === "string" ? raw.conditionId : "",
    slug: oAsOptionalString(raw.slug) ?? null,
    description: oAsOptionalString(raw.description) ?? null,
    image: oAsOptionalString(raw.image) ?? null,
    outcomes: oAsOptionalString(raw.outcomes) ?? null,
    outcomePrices: oAsOptionalString(raw.outcomePrices) ?? null,
    volume: oAsOptionalString(raw.volume) ?? null,
    volumeNum: oAsOptionalNumber(raw.volumeNum) ?? null,
    liquidity: oAsOptionalString(raw.liquidity) ?? null,
    liquidityNum: oAsOptionalNumber(raw.liquidityNum) ?? null,
    active: typeof raw.active === "boolean" ? raw.active : null,
    closed: typeof raw.closed === "boolean" ? raw.closed : null,
    endDate: oAsOptionalString(raw.endDate) ?? null,
    clobTokenIds: oAsOptionalString(raw.clobTokenIds) ?? null,
    bestBid: oAsOptionalNumber(raw.bestBid) ?? null,
    bestAsk: oAsOptionalNumber(raw.bestAsk) ?? null,
    lastTradePrice: oAsOptionalNumber(raw.lastTradePrice) ?? null,
    oneDayPriceChange: oAsOptionalNumber(raw.oneDayPriceChange) ?? null,
    spread: oAsOptionalNumber(raw.spread) ?? null,
    orderPriceMinTickSize: oAsOptionalNumber(raw.orderPriceMinTickSize) ?? null,
    orderMinSize: oAsOptionalNumber(raw.orderMinSize) ?? null,
    acceptingOrders: typeof raw.acceptingOrders === "boolean" ? raw.acceptingOrders : null,
    negRisk: typeof raw.negRisk === "boolean" ? raw.negRisk : null,
    volume24hr: oAsOptionalNumber(raw.volume24hr) ?? null,
    category: oAsOptionalString(raw.category) ?? null,
    marketMakerAddress: typeof raw.marketMakerAddress === "string" ? raw.marketMakerAddress : "",
  };
}
function oParseEvent(raw: unknown) {
  if (!isRecord(raw)) throw new Error("event must be an object");
  return {
    id: typeof raw.id === "string" ? raw.id : String(raw.id ?? ""),
    ticker: oAsOptionalString(raw.ticker) ?? null,
    slug: oAsOptionalString(raw.slug) ?? null,
    title: oAsOptionalString(raw.title) ?? null,
    subtitle: oAsOptionalString(raw.subtitle) ?? null,
    description: oAsOptionalString(raw.description) ?? null,
    image: oAsOptionalString(raw.image) ?? null,
    icon: oAsOptionalString(raw.icon) ?? null,
    active: typeof raw.active === "boolean" ? raw.active : null,
    closed: typeof raw.closed === "boolean" ? raw.closed : null,
    featured: typeof raw.featured === "boolean" ? raw.featured : null,
    restricted: typeof raw.restricted === "boolean" ? raw.restricted : null,
    liquidity: oAsOptionalNumber(raw.liquidity) ?? null,
    volume: oAsOptionalNumber(raw.volume) ?? null,
    openInterest: oAsOptionalNumber(raw.openInterest) ?? null,
    category: oAsOptionalString(raw.category) ?? null,
    subcategory: oAsOptionalString(raw.subcategory) ?? null,
    startDate: oAsOptionalString(raw.startDate) ?? null,
    endDate: oAsOptionalString(raw.endDate) ?? null,
    negRisk: typeof raw.negRisk === "boolean" ? raw.negRisk : null,
    negRiskMarketID: oAsOptionalString(raw.negRiskMarketID) ?? null,
    commentCount: typeof raw.commentCount === "number" ? raw.commentCount : null,
    volume24hr: oAsOptionalNumber(raw.volume24hr) ?? null,
    markets: Array.isArray(raw.markets) ? raw.markets.map(oParseMarket) : [],
    tags: Array.isArray(raw.tags) ? raw.tags.map(oParseTag) : [],
  };
}
function oRelatedTags(raw: unknown) {
  if (!Array.isArray(raw)) return [];
  return raw.map((r) => {
    if (!isRecord(r)) return { id: "", tagID: null, relatedTagID: null, rank: null };
    return {
      id: typeof r.id === "string" ? r.id : "",
      tagID: typeof r.tagID === "number" ? r.tagID : null,
      relatedTagID: typeof r.relatedTagID === "number" ? r.relatedTagID : null,
      rank: typeof r.rank === "number" ? r.rank : null,
    };
  });
}
function oSeries(raw: unknown) {
  if (!Array.isArray(raw)) throw new Error("Expected series array");
  return raw.map((r) => {
    if (!isRecord(r)) throw new Error("series entry must be an object");
    return {
      id: typeof r.id === "string" ? r.id : String(r.id ?? ""),
      slug: oAsOptionalString(r.slug) ?? null,
      title: oAsOptionalString(r.title) ?? null,
      description: oAsOptionalString(r.description) ?? null,
      image: oAsOptionalString(r.image) ?? null,
      active: typeof r.active === "boolean" ? r.active : null,
      closed: typeof r.closed === "boolean" ? r.closed : null,
      volume: oAsOptionalNumber(r.volume) ?? null,
      liquidity: oAsOptionalNumber(r.liquidity) ?? null,
      events: Array.isArray(r.events) ? r.events.map(oParseEvent) : [],
    };
  });
}
function oComments(raw: unknown) {
  if (!Array.isArray(raw)) throw new Error("Expected comments array");
  return raw.map((r) => {
    if (!isRecord(r)) throw new Error("comment must be an object");
    let profile: unknown = null;
    if (isRecord(r.profile)) {
      profile = {
        name: oAsOptionalString(r.profile.name) ?? null,
        pseudonym: oAsOptionalString(r.profile.pseudonym) ?? null,
        bio: oAsOptionalString(r.profile.bio) ?? null,
        proxyWallet: oAsOptionalString(r.profile.proxyWallet) ?? null,
        profileImage: oAsOptionalString(r.profile.profileImage) ?? null,
      };
    }
    return {
      id: typeof r.id === "string" ? r.id : String(r.id ?? ""),
      body: oAsOptionalString(r.body) ?? null,
      parentEntityType: oAsOptionalString(r.parentEntityType) ?? null,
      parentEntityID: typeof r.parentEntityID === "number" ? r.parentEntityID : null,
      userAddress: oAsOptionalString(r.userAddress) ?? null,
      createdAt: oAsOptionalString(r.createdAt) ?? null,
      profile,
      reactionCount: typeof r.reactionCount === "number" ? r.reactionCount : null,
    };
  });
}
function oProfile(raw: unknown) {
  if (!isRecord(raw)) throw new Error("Expected profile object");
  return {
    proxyWallet: oAsOptionalString(raw.proxyWallet) ?? null,
    name: oAsOptionalString(raw.name) ?? null,
    pseudonym: oAsOptionalString(raw.pseudonym) ?? null,
    bio: oAsOptionalString(raw.bio) ?? null,
    profileImage: oAsOptionalString(raw.profileImage) ?? null,
    displayUsernamePublic: typeof raw.displayUsernamePublic === "boolean" ? raw.displayUsernamePublic : null,
    xUsername: oAsOptionalString(raw.xUsername) ?? null,
    verifiedBadge: typeof raw.verifiedBadge === "boolean" ? raw.verifiedBadge : null,
  };
}
function oSearch(raw: unknown) {
  if (!isRecord(raw)) throw new Error("Expected search result object");
  return {
    events: Array.isArray(raw.events) ? raw.events.map(oParseEvent) : null,
    tags: Array.isArray(raw.tags) ? raw.tags.map((t: unknown) => {
      if (!isRecord(t)) return { id: "", label: "", slug: "", event_count: 0 };
      return {
        id: typeof t.id === "string" ? t.id : "",
        label: typeof t.label === "string" ? t.label : "",
        slug: typeof t.slug === "string" ? t.slug : "",
        event_count: typeof t.event_count === "number" ? t.event_count : 0,
      };
    }) : null,
    profiles: Array.isArray(raw.profiles) ? raw.profiles.map((p: unknown) => {
      if (!isRecord(p)) return { id: "", name: null, pseudonym: null, proxyWallet: null, profileImage: null };
      return {
        id: typeof p.id === "string" ? p.id : "",
        name: oAsOptionalString(p.name) ?? null,
        pseudonym: oAsOptionalString(p.pseudonym) ?? null,
        proxyWallet: oAsOptionalString(p.proxyWallet) ?? null,
        profileImage: oAsOptionalString(p.profileImage) ?? null,
      };
    }) : null,
    pagination: isRecord(raw.pagination) ? {
      hasMore: typeof raw.pagination.hasMore === "boolean" ? raw.pagination.hasMore : false,
      totalResults: typeof raw.pagination.totalResults === "number" ? raw.pagination.totalResults : 0,
    } : null,
  };
}
function oSports(raw: unknown) {
  if (!Array.isArray(raw)) throw new Error("Expected sports metadata array");
  return raw.map((r) => {
    if (!isRecord(r)) throw new Error("sport must be an object");
    return {
      sport: typeof r.sport === "string" ? r.sport : "",
      image: oAsOptionalString(r.image) ?? null,
      resolution: oAsOptionalString(r.resolution) ?? null,
      ordering: oAsOptionalString(r.ordering) ?? null,
      tags: oAsOptionalString(r.tags) ?? null,
      series: oAsOptionalString(r.series) ?? null,
    };
  });
}
function oTeams(raw: unknown) {
  if (!Array.isArray(raw)) throw new Error("Expected teams array");
  return raw.map((r) => {
    if (!isRecord(r)) throw new Error("team must be an object");
    return {
      id: typeof r.id === "number" ? r.id : 0,
      name: oAsOptionalString(r.name) ?? null,
      league: oAsOptionalString(r.league) ?? null,
      record: oAsOptionalString(r.record) ?? null,
      logo: oAsOptionalString(r.logo) ?? null,
      abbreviation: oAsOptionalString(r.abbreviation) ?? null,
    };
  });
}

// ── Shared root batteries ──────────────────────────────────────────────
const nonRecordRoots: ReadonlyArray<readonly [string, unknown]> = [
  ["null", null], ["undefined", undefined], ["number", 42],
  ["string", "bad"], ["boolean", true], ["array", [1, 2, 3]],
];
const nonArrayRoots: ReadonlyArray<readonly [string, unknown]> = [
  ["null", null], ["undefined", undefined], ["number", 42],
  ["string", "bad"], ["object", { a: 1 }],
];

// ── parseEvent / parseMarket field-default + coercion correctness ──────

describe("parseEvent / parseMarket — field-by-field equivalence", () => {
  const fullEvent = {
    id: "1", ticker: "TKR", slug: "s", title: "T", subtitle: "sub", description: "d",
    image: "img", icon: "ic", active: true, closed: false, featured: true, restricted: false,
    liquidity: 100.5, volume: 200, openInterest: 5, category: "Politics", subcategory: "US",
    startDate: "2024", endDate: "2025", negRisk: true, negRiskMarketID: "nr1",
    commentCount: 7, volume24hr: 9.9,
    markets: [{ id: "m1", conditionId: "0xabc", question: "Q?", marketMakerAddress: "0x1" }],
    tags: [{ id: "t1", label: "L", slug: "sl", forceShow: true, forceHide: false, isCarousel: null }],
  };
  it("full event matches oracle (incl. nested market + tag)", () => {
    expect(parseEvent(fullEvent)).toEqual(oParseEvent(fullEvent));
  });
  it("partial event lands every default exactly", () => {
    const r = parseEvent({ id: "x" });
    expect(r).toEqual(oParseEvent({ id: "x" }));
    expect(r.ticker).toBeNull();
    expect(r.active).toBeNull();
    expect(r.commentCount).toBeNull();
    expect(r.markets).toEqual([]);
    expect(r.tags).toEqual([]);
  });
  it("numeric id coerced via String(x ?? '')", () => {
    expect(parseEvent({ id: 123 }).id).toBe(oParseEvent({ id: 123 }).id);
    expect(parseEvent({ id: 123 }).id).toBe("123");
    expect(parseEvent({}).id).toBe(""); // String(undefined ?? "") === ""
  });
  it("wrong-typed booleans/strings default; empty string -> null", () => {
    const input = { id: "x", active: "yes", title: "", ticker: 5 };
    expect(parseEvent(input)).toEqual(oParseEvent(input));
    expect(parseEvent(input).active).toBeNull();
    expect(parseEvent(input).title).toBeNull(); // empty string -> asOptionalString undefined -> null
  });
  it("market: missing conditionId/marketMakerAddress default to ''", () => {
    const r = validateMarketResponse({ id: "m" });
    expect(r).toEqual(oParseMarket({ id: "m" }));
    expect(r.conditionId).toBe("");
    expect(r.marketMakerAddress).toBe("");
  });

  // numeric semantics: asOptionalNumber fields reject NaN, accept Infinity
  it("asOptionalNumber fields: Infinity ACCEPTED, NaN -> null", () => {
    const inf = { id: "x", liquidity: Infinity, volume: -Infinity };
    expect(parseEvent(inf)).toEqual(oParseEvent(inf));
    expect(parseEvent(inf).liquidity).toBe(Infinity);
    expect(parseEvent(inf).volume).toBe(-Infinity);
    const nan = { id: "x", liquidity: NaN };
    expect(parseEvent(nan).liquidity).toBeNull();
    expect(oParseEvent(nan).liquidity).toBeNull();
  });
  it("market asOptionalNumber fields: Infinity accepted, NaN -> null", () => {
    const m = { id: "m", bestBid: Infinity, bestAsk: NaN, spread: 0.01 };
    expect(validateMarketResponse(m)).toEqual(oParseMarket(m));
    expect(validateMarketResponse(m).bestBid).toBe(Infinity);
    expect(validateMarketResponse(m).bestAsk).toBeNull();
  });
  // raw typeof number field: commentCount ACCEPTS NaN and Infinity
  it("commentCount (raw typeof number) ACCEPTS NaN and Infinity", () => {
    expect(parseEvent({ id: "x", commentCount: NaN }).commentCount).toBeNaN();
    expect(oParseEvent({ id: "x", commentCount: NaN }).commentCount).toBeNaN();
    expect(parseEvent({ id: "x", commentCount: Infinity }).commentCount).toBe(Infinity);
  });
});

describe("validateEventsResponse / validateEventResponse", () => {
  it("maps array of events", () => {
    const input = [{ id: "1", title: "A" }, { id: "2", title: "B" }];
    expect(validateEventsResponse(input)).toEqual(input.map(oParseEvent));
  });
  it("empty array", () => { expect(validateEventsResponse([])).toEqual([]); });
  it.each(nonArrayRoots)("validateEventsResponse throws plain Error on non-array root: %s", (_l, root) => {
    expect(() => validateEventsResponse(root)).toThrowError(new Error("Expected events array"));
  });
  it.each(nonRecordRoots)("validateEventResponse throws plain 'event must be an object' on %s", (_l, root) => {
    expect(() => validateEventResponse(root)).toThrowError(new Error("event must be an object"));
  });
  it("a non-record market element inside an event makes .map throw", () => {
    expect(() => validateEventResponse({ id: "x", markets: [{ id: "m" }, 5] }))
      .toThrowError(new Error("market must be an object"));
    expect(() => oParseEvent({ id: "x", markets: [{ id: "m" }, 5] }))
      .toThrowError(new Error("market must be an object"));
  });
});

describe("validateMarketsResponse / validateMarketResponse", () => {
  it("maps array", () => {
    const input = [{ id: "1", question: "Q?", conditionId: "0x", marketMakerAddress: "0x1" }];
    expect(validateMarketsResponse(input)).toEqual(input.map(oParseMarket));
  });
  it.each(nonArrayRoots)("validateMarketsResponse throws plain Error on non-array root: %s", (_l, root) => {
    expect(() => validateMarketsResponse(root)).toThrowError(new Error("Expected markets array"));
  });
  it.each(nonRecordRoots)("validateMarketResponse throws 'market must be an object' on %s", (_l, root) => {
    expect(() => validateMarketResponse(root)).toThrowError(new Error("market must be an object"));
  });
});

describe("validateTagsResponse — element default, NEVER throws per element", () => {
  it("maps tags; non-record element -> default tag (no throw)", () => {
    const input = [{ id: "t1", label: "L" }, 5, null, "x"];
    expect(validateTagsResponse(input)).toEqual(input.map(oParseTag));
    expect(validateTagsResponse(input)[1]).toEqual({ id: "", label: null, slug: null, forceShow: null, forceHide: null, isCarousel: null });
  });
  it("numeric id coerced via String(x ?? '')", () => {
    expect(validateTagsResponse([{ id: 9 }])[0].id).toBe("9");
  });
  it.each(nonArrayRoots)("throws plain Error on non-array root: %s", (_l, root) => {
    expect(() => validateTagsResponse(root)).toThrowError(new Error("Expected tags array"));
  });
});

describe("validateRelatedTagsResponse — NEVER throws (default [] / per element)", () => {
  it("maps; non-record element -> default; raw typeof number accepts NaN/Infinity", () => {
    const input = [{ id: "1", tagID: 2, relatedTagID: 3, rank: 1 }, 5, { id: "2", tagID: NaN, rank: Infinity }];
    expect(validateRelatedTagsResponse(input)).toEqual(oRelatedTags(input));
    expect(validateRelatedTagsResponse(input)[2].tagID).toBeNaN();
    expect(validateRelatedTagsResponse(input)[2].rank).toBe(Infinity);
    expect(validateRelatedTagsResponse(input)[1]).toEqual({ id: "", tagID: null, relatedTagID: null, rank: null });
  });
  it("non-array root -> [] (no throw)", () => {
    for (const [, root] of nonRecordRoots) {
      if (Array.isArray(root)) continue;
      expect(validateRelatedTagsResponse(root)).toEqual([]);
    }
  });
  it("string id not coerced (typeof string ? : '') — non-string -> ''", () => {
    expect(validateRelatedTagsResponse([{ id: 9 }])[0].id).toBe("");
  });
});

describe("validateSeriesResponse — throws on non-array root + non-record element", () => {
  it("maps series incl. nested events", () => {
    const input = [{ id: "s1", title: "T", events: [{ id: "e1", title: "E" }] }];
    expect(validateSeriesResponse(input)).toEqual(oSeries(input));
  });
  it("partial series defaults", () => {
    expect(validateSeriesResponse([{}])).toEqual(oSeries([{}]));
  });
  it.each(nonArrayRoots)("throws 'Expected series array' on non-array root: %s", (_l, root) => {
    expect(() => validateSeriesResponse(root)).toThrowError(new Error("Expected series array"));
  });
  it("non-record element throws 'series entry must be an object'", () => {
    expect(() => validateSeriesResponse([{ id: "s" }, 5])).toThrowError(new Error("series entry must be an object"));
  });
});

describe("validateCommentsResponse — throws on non-array root + non-record element", () => {
  it("maps comments incl. nested profile", () => {
    const input = [{ id: "c1", body: "hi", userAddress: "0x", profile: { name: "Alice", bio: "" }, reactionCount: 3, parentEntityID: 4 }];
    expect(validateCommentsResponse(input)).toEqual(oComments(input));
  });
  it("missing profile -> null; raw typeof number ids accept NaN", () => {
    const input = [{ id: "c1", parentEntityID: NaN, reactionCount: Infinity }];
    expect(validateCommentsResponse(input)).toEqual(oComments(input));
    expect(validateCommentsResponse(input)[0].profile).toBeNull();
    expect(validateCommentsResponse(input)[0].parentEntityID).toBeNaN();
    expect(validateCommentsResponse(input)[0].reactionCount).toBe(Infinity);
  });
  it("non-record profile -> null (not parsed)", () => {
    expect(validateCommentsResponse([{ id: "c", profile: 5 }])[0].profile).toBeNull();
  });
  it.each(nonArrayRoots)("throws 'Expected comments array' on non-array root: %s", (_l, root) => {
    expect(() => validateCommentsResponse(root)).toThrowError(new Error("Expected comments array"));
  });
  it("non-record element throws 'comment must be an object'", () => {
    expect(() => validateCommentsResponse([{ id: "c" }, null])).toThrowError(new Error("comment must be an object"));
  });
});

describe("validateProfileResponse — throws on non-record root", () => {
  it("maps profile", () => {
    const input = { name: "Alice", pseudonym: "anon", verifiedBadge: true, proxyWallet: "0x", displayUsernamePublic: false };
    expect(validateProfileResponse(input)).toEqual(oProfile(input));
  });
  it("partial defaults", () => {
    expect(validateProfileResponse({})).toEqual(oProfile({}));
  });
  it.each(nonRecordRoots)("throws 'Expected profile object' on %s", (_l, root) => {
    expect(() => validateProfileResponse(root)).toThrowError(new Error("Expected profile object"));
  });
});

describe("validateSearchResponse — throws on non-record root; sections null on non-array", () => {
  it("maps events + tags + profiles + pagination", () => {
    const input = {
      events: [{ id: "e1", title: "E" }],
      tags: [{ id: "t1", label: "Politics", slug: "politics", event_count: 5 }, 5],
      profiles: [{ id: "p1", name: "Trader" }, null],
      pagination: { hasMore: true, totalResults: 9 },
    };
    expect(validateSearchResponse(input)).toEqual(oSearch(input));
  });
  it("missing sections -> null", () => {
    expect(validateSearchResponse({})).toEqual(oSearch({}));
    const r = validateSearchResponse({});
    expect(r.events).toBeNull();
    expect(r.tags).toBeNull();
    expect(r.profiles).toBeNull();
    expect(r.pagination).toBeNull();
  });
  it("search tag: non-string id/label/slug -> '' (plain default), raw event_count accepts NaN", () => {
    const input = { tags: [{ id: 9, label: 1, slug: true, event_count: NaN }] };
    expect(validateSearchResponse(input)).toEqual(oSearch(input));
    expect(validateSearchResponse(input).tags?.[0]).toEqual({ id: "", label: "", slug: "", event_count: NaN });
  });
  it("pagination raw totalResults accepts NaN/Infinity; hasMore non-bool -> false", () => {
    const input = { pagination: { hasMore: "yes", totalResults: Infinity } };
    expect(validateSearchResponse(input)).toEqual(oSearch(input));
    expect(validateSearchResponse(input).pagination).toEqual({ hasMore: false, totalResults: Infinity });
  });
  it.each(nonRecordRoots)("throws 'Expected search result object' on %s", (_l, root) => {
    expect(() => validateSearchResponse(root)).toThrowError(new Error("Expected search result object"));
  });
});

describe("validateSportsMetadataResponse — throws on non-array root + non-record element", () => {
  it("maps sports", () => {
    const input = [{ sport: "NFL", image: "https://x", resolution: "r" }];
    expect(validateSportsMetadataResponse(input)).toEqual(oSports(input));
  });
  it("non-string sport -> '' default", () => {
    expect(validateSportsMetadataResponse([{ image: "i" }])[0].sport).toBe("");
  });
  it.each(nonArrayRoots)("throws 'Expected sports metadata array' on %s", (_l, root) => {
    expect(() => validateSportsMetadataResponse(root)).toThrowError(new Error("Expected sports metadata array"));
  });
  it("non-record element throws 'sport must be an object'", () => {
    expect(() => validateSportsMetadataResponse([{ sport: "NFL" }, 5])).toThrowError(new Error("sport must be an object"));
  });
});

describe("validateTeamsResponse — throws on non-array root + non-record element", () => {
  it("maps teams", () => {
    const input = [{ id: 1, name: "Chiefs", league: "NFL", abbreviation: "KC" }];
    expect(validateTeamsResponse(input)).toEqual(oTeams(input));
  });
  it("raw numeric id accepts NaN/Infinity; non-number -> 0", () => {
    expect(validateTeamsResponse([{ id: NaN }])[0].id).toBeNaN();
    expect(oTeams([{ id: NaN }])[0].id).toBeNaN();
    expect(validateTeamsResponse([{ id: Infinity }])[0].id).toBe(Infinity);
    expect(validateTeamsResponse([{ name: "x" }])[0].id).toBe(0); // missing -> 0
  });
  it.each(nonArrayRoots)("throws 'Expected teams array' on %s", (_l, root) => {
    expect(() => validateTeamsResponse(root)).toThrowError(new Error("Expected teams array"));
  });
  it("non-record element throws 'team must be an object'", () => {
    expect(() => validateTeamsResponse([{ id: 1 }, null])).toThrowError(new Error("team must be an object"));
  });
});
