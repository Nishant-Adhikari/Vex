/**
 * Runtime validators for Polymarket Gamma API responses.
 */

import { ErrorCodes } from "../../errors.js";
import { isRecord, createFieldValidators } from "../../utils/validation-helpers.js";
import type {
  GammaEvent, GammaMarket, GammaTag, GammaRelatedTag,
  GammaSeries, GammaComment, GammaProfile, GammaSportsMetadata,
  GammaTeam, GammaSearchResult, GammaCommentProfile,
} from "./types.js";

const { asString, asOptionalString, asOptionalNumber } = createFieldValidators(
  ErrorCodes.POLYMARKET_API_ERROR, "Polymarket Gamma",
);

function parseTag(raw: unknown): GammaTag {
  if (!isRecord(raw)) return { id: "", label: null, slug: null, forceShow: null, forceHide: null, isCarousel: null };
  return {
    id: typeof raw.id === "string" ? raw.id : String(raw.id ?? ""),
    label: asOptionalString(raw.label) ?? null,
    slug: asOptionalString(raw.slug) ?? null,
    forceShow: typeof raw.forceShow === "boolean" ? raw.forceShow : null,
    forceHide: typeof raw.forceHide === "boolean" ? raw.forceHide : null,
    isCarousel: typeof raw.isCarousel === "boolean" ? raw.isCarousel : null,
  };
}

function parseMarket(raw: unknown): GammaMarket {
  if (!isRecord(raw)) throw new Error("market must be an object");
  return {
    id: typeof raw.id === "string" ? raw.id : String(raw.id ?? ""),
    question: asOptionalString(raw.question) ?? null,
    conditionId: typeof raw.conditionId === "string" ? raw.conditionId : "",
    slug: asOptionalString(raw.slug) ?? null,
    description: asOptionalString(raw.description) ?? null,
    image: asOptionalString(raw.image) ?? null,
    outcomes: asOptionalString(raw.outcomes) ?? null,
    outcomePrices: asOptionalString(raw.outcomePrices) ?? null,
    volume: asOptionalString(raw.volume) ?? null,
    volumeNum: asOptionalNumber(raw.volumeNum) ?? null,
    liquidity: asOptionalString(raw.liquidity) ?? null,
    liquidityNum: asOptionalNumber(raw.liquidityNum) ?? null,
    active: typeof raw.active === "boolean" ? raw.active : null,
    closed: typeof raw.closed === "boolean" ? raw.closed : null,
    endDate: asOptionalString(raw.endDate) ?? null,
    clobTokenIds: asOptionalString(raw.clobTokenIds) ?? null,
    bestBid: asOptionalNumber(raw.bestBid) ?? null,
    bestAsk: asOptionalNumber(raw.bestAsk) ?? null,
    lastTradePrice: asOptionalNumber(raw.lastTradePrice) ?? null,
    oneDayPriceChange: asOptionalNumber(raw.oneDayPriceChange) ?? null,
    spread: asOptionalNumber(raw.spread) ?? null,
    orderPriceMinTickSize: asOptionalNumber(raw.orderPriceMinTickSize) ?? null,
    orderMinSize: asOptionalNumber(raw.orderMinSize) ?? null,
    acceptingOrders: typeof raw.acceptingOrders === "boolean" ? raw.acceptingOrders : null,
    negRisk: typeof raw.negRisk === "boolean" ? raw.negRisk : null,
    volume24hr: asOptionalNumber(raw.volume24hr) ?? null,
    category: asOptionalString(raw.category) ?? null,
    marketMakerAddress: typeof raw.marketMakerAddress === "string" ? raw.marketMakerAddress : "",
  };
}

export function parseEvent(raw: unknown): GammaEvent {
  if (!isRecord(raw)) throw new Error("event must be an object");
  return {
    id: typeof raw.id === "string" ? raw.id : String(raw.id ?? ""),
    ticker: asOptionalString(raw.ticker) ?? null,
    slug: asOptionalString(raw.slug) ?? null,
    title: asOptionalString(raw.title) ?? null,
    subtitle: asOptionalString(raw.subtitle) ?? null,
    description: asOptionalString(raw.description) ?? null,
    image: asOptionalString(raw.image) ?? null,
    icon: asOptionalString(raw.icon) ?? null,
    active: typeof raw.active === "boolean" ? raw.active : null,
    closed: typeof raw.closed === "boolean" ? raw.closed : null,
    featured: typeof raw.featured === "boolean" ? raw.featured : null,
    restricted: typeof raw.restricted === "boolean" ? raw.restricted : null,
    liquidity: asOptionalNumber(raw.liquidity) ?? null,
    volume: asOptionalNumber(raw.volume) ?? null,
    openInterest: asOptionalNumber(raw.openInterest) ?? null,
    category: asOptionalString(raw.category) ?? null,
    subcategory: asOptionalString(raw.subcategory) ?? null,
    startDate: asOptionalString(raw.startDate) ?? null,
    endDate: asOptionalString(raw.endDate) ?? null,
    negRisk: typeof raw.negRisk === "boolean" ? raw.negRisk : null,
    negRiskMarketID: asOptionalString(raw.negRiskMarketID) ?? null,
    commentCount: typeof raw.commentCount === "number" ? raw.commentCount : null,
    volume24hr: asOptionalNumber(raw.volume24hr) ?? null,
    markets: Array.isArray(raw.markets) ? raw.markets.map(parseMarket) : [],
    tags: Array.isArray(raw.tags) ? raw.tags.map(parseTag) : [],
  };
}

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

export function validateRelatedTagsResponse(raw: unknown): GammaRelatedTag[] {
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

export function validateSeriesResponse(raw: unknown): GammaSeries[] {
  if (!Array.isArray(raw)) throw new Error("Expected series array");
  return raw.map((r) => {
    if (!isRecord(r)) throw new Error("series entry must be an object");
    return {
      id: typeof r.id === "string" ? r.id : String(r.id ?? ""),
      slug: asOptionalString(r.slug) ?? null,
      title: asOptionalString(r.title) ?? null,
      description: asOptionalString(r.description) ?? null,
      image: asOptionalString(r.image) ?? null,
      active: typeof r.active === "boolean" ? r.active : null,
      closed: typeof r.closed === "boolean" ? r.closed : null,
      volume: asOptionalNumber(r.volume) ?? null,
      liquidity: asOptionalNumber(r.liquidity) ?? null,
      events: Array.isArray(r.events) ? r.events.map(parseEvent) : [],
    };
  });
}

export function validateCommentsResponse(raw: unknown): GammaComment[] {
  if (!Array.isArray(raw)) throw new Error("Expected comments array");
  return raw.map((r) => {
    if (!isRecord(r)) throw new Error("comment must be an object");
    let profile: GammaCommentProfile | null = null;
    if (isRecord(r.profile)) {
      profile = {
        name: asOptionalString(r.profile.name) ?? null,
        pseudonym: asOptionalString(r.profile.pseudonym) ?? null,
        bio: asOptionalString(r.profile.bio) ?? null,
        proxyWallet: asOptionalString(r.profile.proxyWallet) ?? null,
        profileImage: asOptionalString(r.profile.profileImage) ?? null,
      };
    }
    return {
      id: typeof r.id === "string" ? r.id : String(r.id ?? ""),
      body: asOptionalString(r.body) ?? null,
      parentEntityType: asOptionalString(r.parentEntityType) ?? null,
      parentEntityID: typeof r.parentEntityID === "number" ? r.parentEntityID : null,
      userAddress: asOptionalString(r.userAddress) ?? null,
      createdAt: asOptionalString(r.createdAt) ?? null,
      profile,
      reactionCount: typeof r.reactionCount === "number" ? r.reactionCount : null,
    };
  });
}

export function validateProfileResponse(raw: unknown): GammaProfile {
  if (!isRecord(raw)) throw new Error("Expected profile object");
  return {
    proxyWallet: asOptionalString(raw.proxyWallet) ?? null,
    name: asOptionalString(raw.name) ?? null,
    pseudonym: asOptionalString(raw.pseudonym) ?? null,
    bio: asOptionalString(raw.bio) ?? null,
    profileImage: asOptionalString(raw.profileImage) ?? null,
    displayUsernamePublic: typeof raw.displayUsernamePublic === "boolean" ? raw.displayUsernamePublic : null,
    xUsername: asOptionalString(raw.xUsername) ?? null,
    verifiedBadge: typeof raw.verifiedBadge === "boolean" ? raw.verifiedBadge : null,
  };
}

export function validateSearchResponse(raw: unknown): GammaSearchResult {
  if (!isRecord(raw)) throw new Error("Expected search result object");
  return {
    events: Array.isArray(raw.events) ? raw.events.map(parseEvent) : null,
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
        name: asOptionalString(p.name) ?? null,
        pseudonym: asOptionalString(p.pseudonym) ?? null,
        proxyWallet: asOptionalString(p.proxyWallet) ?? null,
        profileImage: asOptionalString(p.profileImage) ?? null,
      };
    }) : null,
    pagination: isRecord(raw.pagination) ? {
      hasMore: typeof raw.pagination.hasMore === "boolean" ? raw.pagination.hasMore : false,
      totalResults: typeof raw.pagination.totalResults === "number" ? raw.pagination.totalResults : 0,
    } : null,
  };
}

export function validateSportsMetadataResponse(raw: unknown): GammaSportsMetadata[] {
  if (!Array.isArray(raw)) throw new Error("Expected sports metadata array");
  return raw.map((r) => {
    if (!isRecord(r)) throw new Error("sport must be an object");
    return {
      sport: typeof r.sport === "string" ? r.sport : "",
      image: asOptionalString(r.image) ?? null,
      resolution: asOptionalString(r.resolution) ?? null,
      ordering: asOptionalString(r.ordering) ?? null,
      tags: asOptionalString(r.tags) ?? null,
      series: asOptionalString(r.series) ?? null,
    };
  });
}

export function validateTeamsResponse(raw: unknown): GammaTeam[] {
  if (!Array.isArray(raw)) throw new Error("Expected teams array");
  return raw.map((r) => {
    if (!isRecord(r)) throw new Error("team must be an object");
    return {
      id: typeof r.id === "number" ? r.id : 0,
      name: asOptionalString(r.name) ?? null,
      league: asOptionalString(r.league) ?? null,
      record: asOptionalString(r.record) ?? null,
      logo: asOptionalString(r.logo) ?? null,
      abbreviation: asOptionalString(r.abbreviation) ?? null,
    };
  });
}
