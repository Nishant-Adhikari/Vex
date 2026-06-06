/**
 * Retrieval metadata for Polymarket gamma series tools.
 *
 * Source-of-truth for both the lexical scorer (`discovery.ts`) and the
 * future dense-retrieval pipeline (EmbeddingGemma 300M → pgvector). Manifest
 * at `polymarket/manifests/gamma.ts` references entries by `toolId`.
 */

import type { ToolDiscoveryMetadata } from "../../../types.js";
import { embeddingText } from "../../../_embedding-text.js";
import { POLYMARKET_CHAINS } from "../../../polymarket/discovery-text.js";

export const POLYMARKET_GAMMA_SERIES_DISCOVERY = {
  // ── Series (2) ────────────────────────────────────────────────

  "polymarket.gamma.series": {
    embeddingText: embeddingText(
      `List event series on Polymarket — a prediction market on Polygon — where a series is a group of recurring events (weekly NFL games, monthly inflation prints, etc.). Filter by category, slug, recurrence, and open/closed status. ` +
      `Use this when the user wants to browse recurring polymarket events grouped together, find weekly or monthly cohorts of markets, or list series under a category. ` +
      `Example queries: list polymarket event series, browse weekly recurring markets, find monthly inflation series, polymarket sports series. ` +
      `Read-only.`,
    ),
    aliases: [
      "prediction market", "polymarket",
      "event series", "polymarket series",
      "recurring events", "weekly markets",
    ],
    exampleIntents: [
      "list polymarket event series",
      "browse weekly recurring markets",
      "find monthly inflation series",
    ],
    chains: POLYMARKET_CHAINS,
  },

  "polymarket.gamma.seriesById": {
    embeddingText: embeddingText(
      `Get a single event series by ID on Polymarket — a prediction market on Polygon — with all nested events expanded. ` +
      `Use this when the user already has a series id and wants the full series payload with its grouped recurring events. Pick the by-id variant when the input is a numeric series id. ` +
      `Example queries: get polymarket series by id, expand series 123, fetch this series with nested events. ` +
      `Read-only.`,
    ),
    aliases: [
      "prediction market", "polymarket",
      "event series", "series by id",
      "by id", "series id",
    ],
    exampleIntents: [
      "get polymarket series by id",
      "expand series 123",
      "fetch this series with nested events",
    ],
    chains: POLYMARKET_CHAINS,
  },
} satisfies Record<string, ToolDiscoveryMetadata>;
