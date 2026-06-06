/**
 * Retrieval metadata for Polymarket gamma tools.
 *
 * Source-of-truth for both the lexical scorer (`discovery.ts`) and the
 * future dense-retrieval pipeline (EmbeddingGemma 300M → pgvector). Manifest
 * at `polymarket/manifests/gamma.ts` references entries by `toolId`.
 *
 * Façade: per-resource discovery chunks live under `gamma/` (events, markets,
 * search, tags, series, comments, profile, sports), mirroring the manifest
 * grouping. The re-assembled object preserves the original key order.
 */

import type { ToolDiscoveryMetadata } from "../../types.js";
import { POLYMARKET_GAMMA_EVENTS_DISCOVERY } from "./gamma/events.js";
import { POLYMARKET_GAMMA_MARKETS_DISCOVERY } from "./gamma/markets.js";
import { POLYMARKET_GAMMA_SEARCH_DISCOVERY } from "./gamma/search.js";
import { POLYMARKET_GAMMA_TAGS_DISCOVERY } from "./gamma/tags.js";
import { POLYMARKET_GAMMA_SERIES_DISCOVERY } from "./gamma/series.js";
import { POLYMARKET_GAMMA_COMMENTS_DISCOVERY } from "./gamma/comments.js";
import { POLYMARKET_GAMMA_PROFILE_DISCOVERY } from "./gamma/profile.js";
import { POLYMARKET_GAMMA_SPORTS_DISCOVERY } from "./gamma/sports.js";

export const POLYMARKET_GAMMA_DISCOVERY = {
  ...POLYMARKET_GAMMA_EVENTS_DISCOVERY,
  ...POLYMARKET_GAMMA_MARKETS_DISCOVERY,
  ...POLYMARKET_GAMMA_SEARCH_DISCOVERY,
  ...POLYMARKET_GAMMA_TAGS_DISCOVERY,
  ...POLYMARKET_GAMMA_SERIES_DISCOVERY,
  ...POLYMARKET_GAMMA_COMMENTS_DISCOVERY,
  ...POLYMARKET_GAMMA_PROFILE_DISCOVERY,
  ...POLYMARKET_GAMMA_SPORTS_DISCOVERY,
} satisfies Record<string, ToolDiscoveryMetadata>;

const EXPECTED_COUNT = 25;
if (Object.keys(POLYMARKET_GAMMA_DISCOVERY).length !== EXPECTED_COUNT) {
  throw new Error(
    `POLYMARKET_GAMMA_DISCOVERY has ${Object.keys(POLYMARKET_GAMMA_DISCOVERY).length} entries, expected ${EXPECTED_COUNT}.`,
  );
}
