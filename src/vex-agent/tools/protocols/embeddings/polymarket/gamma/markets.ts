/**
 * Retrieval metadata for Polymarket gamma market tools.
 *
 * Source-of-truth for both the lexical scorer (`discovery.ts`) and the
 * future dense-retrieval pipeline (EmbeddingGemma 300M → pgvector). Manifest
 * at `polymarket/manifests/gamma.ts` references entries by `toolId`.
 */

import type { ToolDiscoveryMetadata } from "../../../types.js";
import { embeddingText } from "../../../_embedding-text.js";
import { POLYMARKET_CHAINS } from "../../../polymarket/discovery-text.js";

export const POLYMARKET_GAMMA_MARKETS_DISCOVERY = {
  // ── Markets (4) ───────────────────────────────────────────────

  "polymarket.gamma.markets": {
    canonicalSummary:
      "Browse markets within a Polymarket prediction market on Polygon — paginated, filterable by status, liquidity, volume, date range, sports, tag, with prices and CLOB token IDs.",
    embeddingText: embeddingText(
      `Browse markets on Polymarket, a prediction market on Polygon, paginated and filterable by status, liquidity, volume, date range, sports game, market type, condition ID, question ID, and tag. Rows include YES/NO prices, clobTokenIds, condition IDs, and tag metadata needed before placing an order. ` +
      `Use this when the user wants to screen prediction markets, find liquid markets to bet on, list markets by sport or category, look up markets by condition id, or pull token IDs for order placement. ` +
      `Example queries: browse polymarket markets, screen markets with 50k liquidity, list NBA moneyline markets, sports markets ending today. ` +
      `Read-only.`,
    ),
    aliases: [
      "prediction market", "polymarket",
      "browse markets", "polymarket markets",
      "market listing", "by condition id",
      "clob token id", "tag id",
      "screen markets", "parlay", "parlays",
    ],
    exampleIntents: [
      "browse polymarket markets",
      "screen prediction markets with high liquidity",
      "find markets by condition id",
      "list NBA moneyline markets on polymarket",
    ],
    preferredFor: ["browse markets", "screen markets", "list markets by tag"],
    avoidFor: ["my positions", "open positions"],
    chains: POLYMARKET_CHAINS,
  },

  "polymarket.gamma.market": {
    embeddingText: embeddingText(
      `Get a single market by condition ID (or numeric ID) on Polymarket — a prediction market on Polygon — returning question, outcomes, current YES/NO prices, clobTokenIds, neg risk flag, and tags. ` +
      `Use this when the user already has a condition id, hex market id, or numeric id and wants the full market payload, or when expanding a market reference returned by another tool. Pick the by-id variant over the by-slug sibling when the input looks like a hex condition id or numeric id. ` +
      `Example queries: get polymarket market by condition id, expand this 0xabc... market, fetch market details by id, look up clobTokenIds for this condition. ` +
      `Read-only.`,
    ),
    aliases: [
      "prediction market", "polymarket",
      "polymarket market", "get market",
      "by condition id", "condition id",
      "market details", "clob token id",
    ],
    exampleIntents: [
      "get polymarket market by condition id",
      "expand this 0xabc market",
      "fetch market details by id",
    ],
    chains: POLYMARKET_CHAINS,
  },

  "polymarket.gamma.marketBySlug": {
    embeddingText: embeddingText(
      `Get a single market by URL slug on Polymarket — a prediction market on Polygon — returning question, outcomes, current YES/NO prices, clobTokenIds, neg risk flag, and tags. ` +
      `Use this when the user pastes or references a polymarket market URL slug like "will-eth-hit-5000" rather than a hex condition id or numeric id — slug-shaped inputs route here over the by-id sibling. ` +
      `Example queries: get polymarket market by slug, look up will-eth-hit-5000, fetch this market url, resolve market slug to clobTokenIds. ` +
      `Read-only.`,
    ),
    aliases: [
      "prediction market", "polymarket",
      "polymarket market", "market by slug",
      "by slug", "url slug", "market url",
    ],
    exampleIntents: [
      "get polymarket market by slug",
      "look up market will-eth-hit-5000",
      "resolve market slug to clobTokenIds",
    ],
    chains: POLYMARKET_CHAINS,
  },

  "polymarket.gamma.marketTags": {
    embeddingText: embeddingText(
      `Get the tags attached to a single market on Polymarket — a prediction market on Polygon — by condition ID. Tags categorize the market (crypto, sports, politics, carousel, etc.). ` +
      `Use this when the user wants to know what categories a market belongs to, find similar markets by category, or build a tag-based filter from a known condition id. ` +
      `Example queries: tags for this polymarket market, what categories does this market belong to, list market tags, get market tag ids. ` +
      `Read-only.`,
    ),
    aliases: [
      "prediction market", "polymarket",
      "market tags", "market categories",
      "tag id", "by condition id",
    ],
    exampleIntents: [
      "tags for this polymarket market",
      "what categories does this market belong to",
      "list market tags",
    ],
    chains: POLYMARKET_CHAINS,
  },
} satisfies Record<string, ToolDiscoveryMetadata>;
