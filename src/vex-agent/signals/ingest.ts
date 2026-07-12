/**
 * Signal ingestion — fetch TrendRadar's published feed, parse/validate it, and
 * upsert into Vex's own `signals` table. Dependencies (fetch + upsert) are
 * injected so the logic is unit-tested with no network and no DB.
 */

import { parseSignalsFeed, type ParsedSignal } from "./feed.js";
import { upsertSignals, type SignalUpsertInput } from "@vex-agent/db/repos/signals.js";
import logger from "@utils/logger.js";

const SOURCE = "trendradar";

/** TrendRadar publishes its feed to this branch/path hourly (see trendradar CI). */
export const DEFAULT_SIGNALS_FEED_URL =
  "https://raw.githubusercontent.com/Nishant-Adhikari/trendradar/signals-feed/data/signals.json";

export interface IngestSignalsDeps {
  fetchFeed(url: string): Promise<unknown>;
  upsert(records: SignalUpsertInput[]): Promise<number>;
}

export interface IngestSignalsResult {
  readonly fetched: number;
  readonly written: number;
  readonly generatedAt: string;
}

function toUpsert(s: ParsedSignal, feedGeneratedAt: string): SignalUpsertInput {
  return {
    source: SOURCE, chain: s.chain, contract: s.contract, symbol: s.symbol,
    action: s.action, score: s.score, todayMentions: s.todayMentions,
    yesterdayMentions: s.yesterdayMentions, velocityPct: s.velocityPct,
    liquidityUsd: s.liquidityUsd, volume24hUsd: s.volume24hUsd, priceUsd: s.priceUsd,
    narratives: s.narratives, riskFlags: s.riskFlags, raw: s.raw,
    firstSeenAt: s.firstSeenAt, lastSeenAt: s.lastSeenAt, feedGeneratedAt,
  };
}

function productionDeps(): IngestSignalsDeps {
  return {
    fetchFeed: async (url) => {
      const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new Error(`signal feed fetch failed: HTTP ${res.status}`);
      return res.json();
    },
    upsert: (records) => upsertSignals(records),
  };
}

/**
 * Fetch → parse → upsert. Throws on fetch/parse failure (nothing is written on a
 * bad or unsupported-version feed); the caller (executor) logs and retries next tick.
 */
export async function ingestSignalsFeed(
  url: string = DEFAULT_SIGNALS_FEED_URL,
  deps: IngestSignalsDeps = productionDeps(),
): Promise<IngestSignalsResult> {
  const raw = await deps.fetchFeed(url);
  const feed = parseSignalsFeed(raw);
  const written = await deps.upsert(feed.signals.map((s) => toUpsert(s, feed.generatedAt)));
  logger.info("signals.ingest.completed", {
    fetched: feed.signals.length, written, generatedAt: feed.generatedAt,
  });
  return { fetched: feed.signals.length, written, generatedAt: feed.generatedAt };
}
