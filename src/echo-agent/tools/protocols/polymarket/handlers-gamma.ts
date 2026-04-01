/**
 * Polymarket Gamma API handlers — market discovery, events, search.
 * All public, no auth. 25 methods on PolyGammaClient fully covered.
 */

import { getPolyGammaClient } from "@tools/polymarket/gamma/client.js";
import type { ProtocolHandler } from "../types.js";
import { str, num, bool, ok, fail } from "../handler-helpers.js";

export const GAMMA_HANDLERS: Record<string, ProtocolHandler> = {
  // ── Events ────────────────────────────────────────────────────

  "polymarket.gamma.events": async (p) => {
    const events = await getPolyGammaClient().listEvents({
      limit: num(p, "limit"),
      offset: num(p, "offset"),
      order: str(p, "order") || undefined,
      ascending: bool(p, "ascending"),
      tag_slug: str(p, "tagSlug") || undefined,
      tag_id: num(p, "tagId"),
      active: bool(p, "active"),
      closed: bool(p, "closed"),
      featured: bool(p, "featured"),
      liquidity_min: num(p, "liquidityMin"),
      volume_min: num(p, "volumeMin"),
    });
    return ok({ count: events.length, events });
  },

  "polymarket.gamma.event": async (p) => {
    const id = str(p, "id");
    if (!id) return fail("Missing required: id");
    return ok(await getPolyGammaClient().getEvent(id));
  },

  "polymarket.gamma.eventBySlug": async (p) => {
    const slug = str(p, "slug");
    if (!slug) return fail("Missing required: slug");
    return ok(await getPolyGammaClient().getEventBySlug(slug));
  },

  "polymarket.gamma.eventTags": async (p) => {
    const id = str(p, "id");
    if (!id) return fail("Missing required: id");
    const tags = await getPolyGammaClient().getEventTags(id);
    return ok({ count: tags.length, tags });
  },

  // ── Markets ───────────────────────────────────────────────────

  "polymarket.gamma.markets": async (p) => {
    const markets = await getPolyGammaClient().listMarkets({
      limit: num(p, "limit"),
      offset: num(p, "offset"),
      order: str(p, "order") || undefined,
      ascending: bool(p, "ascending"),
      closed: bool(p, "closed"),
      tag_id: num(p, "tagId"),
    });
    return ok({ count: markets.length, markets });
  },

  "polymarket.gamma.market": async (p) => {
    const id = str(p, "id");
    if (!id) return fail("Missing required: id");
    return ok(await getPolyGammaClient().getMarket(id));
  },

  "polymarket.gamma.marketBySlug": async (p) => {
    const slug = str(p, "slug");
    if (!slug) return fail("Missing required: slug");
    return ok(await getPolyGammaClient().getMarketBySlug(slug));
  },

  "polymarket.gamma.marketTags": async (p) => {
    const id = str(p, "id");
    if (!id) return fail("Missing required: id");
    const tags = await getPolyGammaClient().getMarketTags(id);
    return ok({ count: tags.length, tags });
  },

  // ── Search ────────────────────────────────────────────────────

  "polymarket.gamma.search": async (p) => {
    const query = str(p, "query");
    if (!query) return fail("Missing required: query");
    return ok(await getPolyGammaClient().search(query, {
      limit_per_type: num(p, "limitPerType"),
      page: num(p, "page"),
      events_status: str(p, "eventsStatus") || undefined,
    }));
  },

  // ── Tags ──────────────────────────────────────────────────────

  "polymarket.gamma.tags": async (p) => {
    const tags = await getPolyGammaClient().listTags({ is_carousel: bool(p, "isCarousel") });
    return ok({ count: tags.length, tags });
  },

  "polymarket.gamma.tag": async (p) => {
    const id = str(p, "id");
    if (!id) return fail("Missing required: id");
    return ok(await getPolyGammaClient().getTag(id));
  },

  "polymarket.gamma.tagBySlug": async (p) => {
    const slug = str(p, "slug");
    if (!slug) return fail("Missing required: slug");
    return ok(await getPolyGammaClient().getTagBySlug(slug));
  },

  "polymarket.gamma.relatedTags": async (p) => {
    const id = str(p, "id");
    if (!id) return fail("Missing required: id");
    const tags = await getPolyGammaClient().getRelatedTags(id, { status: str(p, "status") || undefined });
    return ok({ count: tags.length, tags });
  },

  "polymarket.gamma.relatedTagsBySlug": async (p) => {
    const slug = str(p, "slug");
    if (!slug) return fail("Missing required: slug");
    const tags = await getPolyGammaClient().getRelatedTagsBySlug(slug, { status: str(p, "status") || undefined });
    return ok({ count: tags.length, tags });
  },

  "polymarket.gamma.tagsRelatedToTag": async (p) => {
    const id = str(p, "id");
    if (!id) return fail("Missing required: id");
    const tags = await getPolyGammaClient().getTagsRelatedToTag(id, { status: str(p, "status") || undefined });
    return ok({ count: tags.length, tags });
  },

  "polymarket.gamma.tagsRelatedToTagBySlug": async (p) => {
    const slug = str(p, "slug");
    if (!slug) return fail("Missing required: slug");
    const tags = await getPolyGammaClient().getTagsRelatedToTagBySlug(slug, { status: str(p, "status") || undefined });
    return ok({ count: tags.length, tags });
  },

  // ── Series ────────────────────────────────────────────────────

  "polymarket.gamma.series": async (p) => {
    const series = await getPolyGammaClient().listSeries({ closed: bool(p, "closed") });
    return ok({ count: series.length, series });
  },

  "polymarket.gamma.seriesById": async (p) => {
    const id = str(p, "id");
    if (!id) return fail("Missing required: id");
    return ok(await getPolyGammaClient().getSeries(id));
  },

  // ── Comments ──────────────────────────────────────────────────

  "polymarket.gamma.comments": async (p) => {
    const comments = await getPolyGammaClient().listComments({
      parent_entity_type: str(p, "parentEntityType") || undefined,
      parent_entity_id: num(p, "parentEntityId"),
      holders_only: bool(p, "holdersOnly"),
      limit: num(p, "limit"),
    });
    return ok({ count: comments.length, comments });
  },

  "polymarket.gamma.comment": async (p) => {
    const id = str(p, "id");
    if (!id) return fail("Missing required: id");
    return ok(await getPolyGammaClient().getComment(id));
  },

  "polymarket.gamma.commentsByUser": async (p) => {
    const address = str(p, "address");
    if (!address) return fail("Missing required: address");
    const comments = await getPolyGammaClient().getCommentsByUser(address, {
      limit: num(p, "limit"),
      offset: num(p, "offset"),
    });
    return ok({ count: comments.length, comments });
  },

  // ── Profiles ──────────────────────────────────────────────────

  "polymarket.gamma.profile": async (p) => {
    const address = str(p, "address");
    if (!address) return fail("Missing required: address");
    return ok(await getPolyGammaClient().getPublicProfile(address));
  },

  // ── Sports ────────────────────────────────────────────────────

  "polymarket.gamma.sportsMetadata": async () => {
    const sports = await getPolyGammaClient().getSportsMetadata();
    return ok({ count: sports.length, sports });
  },

  "polymarket.gamma.sportsMarketTypes": async () => {
    return ok(await getPolyGammaClient().getSportsMarketTypes());
  },

  "polymarket.gamma.teams": async (p) => {
    const league = str(p, "league");
    const teams = await getPolyGammaClient().listTeams({
      league: league ? league.split(",").map(s => s.trim()) : undefined,
      limit: num(p, "limit"),
    });
    return ok({ count: teams.length, teams });
  },
};
