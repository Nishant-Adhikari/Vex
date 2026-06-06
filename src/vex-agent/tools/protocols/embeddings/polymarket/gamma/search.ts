/**
 * Retrieval metadata for the Polymarket gamma search tool.
 *
 * Source-of-truth for both the lexical scorer (`discovery.ts`) and the
 * future dense-retrieval pipeline (EmbeddingGemma 300M → pgvector). Manifest
 * at `polymarket/manifests/gamma.ts` references entries by `toolId`.
 */

import type { ToolDiscoveryMetadata } from "../../../types.js";
import { embeddingText } from "../../../_embedding-text.js";
import { POLYMARKET_CHAINS } from "../../../polymarket/discovery-text.js";

export const POLYMARKET_GAMMA_SEARCH_DISCOVERY = {
  // ── Search (1) ────────────────────────────────────────────────

  "polymarket.gamma.search": {
    canonicalSummary:
      "Search events, tags, and profiles on a Polymarket prediction market on Polygon by free-text query — cross-entity, with status, tag, recurrence filters.",
    embeddingText: embeddingText(
      `Cross-entity full-text search on Polymarket — a prediction market on Polygon — across events, tags, and user profiles in one call. ` +
      `Use this when the user types a free-text query like "bitcoin" or "trump" or someone's pseudonym and wants matching events, tags, and profiles back without knowing which entity to look in. Best for natural-language lookups before drilling into a specific event or market. ` +
      `Example queries: search bitcoin market on polymarket, find trump prediction events, look up this user on polymarket, search election markets, find polymarket events about ethereum. ` +
      `Read-only.`,
    ),
    aliases: [
      "prediction market", "polymarket",
      "polymarket search", "search events",
      "find market", "search profiles",
      "free text search", "lookup",
    ],
    exampleIntents: [
      "search bitcoin market on polymarket",
      "find trump prediction events",
      "look up this user on polymarket",
      "search polymarket for election markets",
    ],
    preferredFor: ["search polymarket", "find market by name", "free-text lookup"],
    chains: POLYMARKET_CHAINS,
  },
} satisfies Record<string, ToolDiscoveryMetadata>;
