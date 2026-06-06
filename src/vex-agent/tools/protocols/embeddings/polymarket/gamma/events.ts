/**
 * Retrieval metadata for Polymarket gamma event tools.
 *
 * Source-of-truth for both the lexical scorer (`discovery.ts`) and the
 * future dense-retrieval pipeline (EmbeddingGemma 300M → pgvector). Manifest
 * at `polymarket/manifests/gamma.ts` references entries by `toolId`.
 */

import type { ToolDiscoveryMetadata } from "../../../types.js";
import { embeddingText } from "../../../_embedding-text.js";
import { POLYMARKET_CHAINS } from "../../../polymarket/discovery-text.js";

export const POLYMARKET_GAMMA_EVENTS_DISCOVERY = {
  // ── Events (4) ────────────────────────────────────────────────

  "polymarket.gamma.events": {
    canonicalSummary:
      "Browse events on a Polymarket prediction market on Polygon — paginated, filterable by tag, status, liquidity, volume, date range.",
    embeddingText: embeddingText(
      `Browse events on Polymarket, a prediction market on Polygon, paginated and filterable by tag, status, liquidity, volume, date range, featured or archived flags, and recurrence. Each event includes nested markets with current YES/NO prices, volume, and liquidity. ` +
      `Use this when the user wants to discover trending prediction markets, scan events by category, list elections, sports, or crypto events, or screen by liquidity and volume. ` +
      `Example queries: browse trending polymarket events, what prediction markets are hot, list election markets, top crypto prediction events, sports events ending this week. ` +
      `Read-only.`,
    ),
    aliases: [
      "prediction market", "polymarket",
      "polymarket events", "browse events",
      "trending markets", "featured events",
      "carousel tag", "tag id", "tag slug",
      "event listing",
    ],
    exampleIntents: [
      "browse trending polymarket events",
      "list election prediction markets",
      "polymarket events with at least 100k liquidity",
      "what crypto prediction markets are hot",
    ],
    preferredFor: ["browse events", "trending events", "filter events by tag"],
    chains: POLYMARKET_CHAINS,
  },

  "polymarket.gamma.event": {
    embeddingText: embeddingText(
      `Get a single event by numeric ID on Polymarket — a prediction market on Polygon — returning title, description, volume, liquidity, nested markets, and tags. ` +
      `Use this when the user already has the polymarket event ID and wants the full event payload, or when an upstream tool surfaced an event ID and you need to expand it. Pick the by-id variant over the by-slug sibling when the input is a numeric event ID. ` +
      `Example queries: get polymarket event 12345, fetch this prediction event by id, expand event id, look up event details by id. ` +
      `Read-only.`,
    ),
    aliases: [
      "prediction market", "polymarket",
      "polymarket event", "get event",
      "event by id", "event details",
    ],
    exampleIntents: [
      "get polymarket event by id",
      "fetch this prediction event by id",
      "expand event id 12345",
    ],
    chains: POLYMARKET_CHAINS,
  },

  "polymarket.gamma.eventBySlug": {
    embeddingText: embeddingText(
      `Get a single event by URL slug on Polymarket — a prediction market on Polygon — returning title, description, volume, liquidity, nested markets, and tags. ` +
      `Use this when the user pastes or references a polymarket event URL slug like "will-bitcoin-hit-100k" rather than a numeric ID — slug-shaped inputs route here over the by-id sibling. ` +
      `Example queries: get polymarket event by slug, look up will-bitcoin-hit-100k, fetch this event url, resolve event slug to details. ` +
      `Read-only.`,
    ),
    aliases: [
      "prediction market", "polymarket",
      "polymarket event", "event by slug",
      "by slug", "url slug", "event url",
    ],
    exampleIntents: [
      "get polymarket event by slug",
      "look up event will-bitcoin-hit-100k",
      "resolve event slug to details",
    ],
    chains: POLYMARKET_CHAINS,
  },

  "polymarket.gamma.eventTags": {
    embeddingText: embeddingText(
      `Get the tags attached to a single event on Polymarket — a prediction market on Polygon — by event ID. Tags categorize the event (crypto, sports, politics, carousel, etc.). ` +
      `Use this when the user wants to know what categories an event belongs to, find similar events by category, or build a tag-based filter from a known event. ` +
      `Example queries: tags for this polymarket event, what categories does this event belong to, list event tags, get event tag ids. ` +
      `Read-only.`,
    ),
    aliases: [
      "prediction market", "polymarket",
      "event tags", "event categories",
      "tag id", "carousel tag",
    ],
    exampleIntents: [
      "tags for this polymarket event",
      "what categories does this event belong to",
      "list polymarket event tags",
    ],
    chains: POLYMARKET_CHAINS,
  },
} satisfies Record<string, ToolDiscoveryMetadata>;
