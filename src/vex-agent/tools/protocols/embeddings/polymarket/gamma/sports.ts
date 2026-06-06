/**
 * Retrieval metadata for Polymarket gamma sports tools.
 *
 * Source-of-truth for both the lexical scorer (`discovery.ts`) and the
 * future dense-retrieval pipeline (EmbeddingGemma 300M → pgvector). Manifest
 * at `polymarket/manifests/gamma.ts` references entries by `toolId`.
 */

import type { ToolDiscoveryMetadata } from "../../../types.js";
import { embeddingText } from "../../../_embedding-text.js";
import { POLYMARKET_CHAINS } from "../../../polymarket/discovery-text.js";

export const POLYMARKET_GAMMA_SPORTS_DISCOVERY = {
  // ── Sports (3) ────────────────────────────────────────────────

  "polymarket.gamma.sportsMetadata": {
    embeddingText: embeddingText(
      `Get sports category metadata on Polymarket — a prediction market on Polygon — listing each sport with its display name, image / logo, and image resolution variants. ` +
      `Use this when the user wants to render a sports category picker, list which sports polymarket covers, or pull sport logos for a UI. ` +
      `Example queries: sports categories on polymarket, list sport leagues, get sport logos, what sports does polymarket cover. ` +
      `Read-only.`,
    ),
    aliases: [
      "prediction market", "polymarket",
      "sports metadata", "sport league",
      "sport categories", "sport logos",
    ],
    exampleIntents: [
      "sports categories on polymarket",
      "list sport leagues on polymarket",
      "what sports does polymarket cover",
    ],
    chains: POLYMARKET_CHAINS,
  },

  "polymarket.gamma.sportsMarketTypes": {
    embeddingText: embeddingText(
      `Get the list of sports market types available on Polymarket — a prediction market on Polygon — covering moneyline, spread, total / over-under, and other game-line shapes. ` +
      `Use this when the user wants to know which bet types polymarket supports for sports, build a market-type filter, or map a user's sportsbook vocabulary onto the polymarket schema. ` +
      `Example queries: sports market types on polymarket, list moneyline spread total, what sports bet types are supported, polymarket sportsbook market shapes. ` +
      `Read-only.`,
    ),
    aliases: [
      "prediction market", "polymarket",
      "sports market types", "moneyline",
      "spread", "total", "over under",
      "sport league",
    ],
    exampleIntents: [
      "sports market types on polymarket",
      "what sports bet types are supported",
      "list moneyline spread total",
    ],
    chains: POLYMARKET_CHAINS,
  },

  "polymarket.gamma.teams": {
    embeddingText: embeddingText(
      `List sports teams on Polymarket — a prediction market on Polygon — with league, win/loss record, and team logo. Filter by league, full name, or abbreviation. ` +
      `Use this when the user wants to find a specific team to filter sports markets by, render a team logo, or build a team picker by league (NBA, NFL, MLB, etc.). ` +
      `Example queries: list NBA teams on polymarket, get team logo for lakers, find team by abbreviation lal, polymarket NFL teams, sport league teams. ` +
      `Read-only.`,
    ),
    aliases: [
      "prediction market", "polymarket",
      "sports teams", "team logo",
      "sport league", "team abbreviation",
      "team record",
    ],
    exampleIntents: [
      "list NBA teams on polymarket",
      "get team logo for lakers",
      "find team by abbreviation lal",
    ],
    chains: POLYMARKET_CHAINS,
  },
} satisfies Record<string, ToolDiscoveryMetadata>;
