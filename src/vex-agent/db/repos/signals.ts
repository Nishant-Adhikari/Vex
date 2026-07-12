/**
 * Signals repo — TrendRadar alpha signals persisted in Vex's own Postgres.
 *
 * `upsertSignals` keeps the LATEST row per (source, chain, contract); the
 * `signals-ingest` worker calls it each hour with the parsed feed.
 * `listRecentSignals` is the rolling-window read — "overall alpha over the last
 * N hours" — used by the mission-time signal-radar block (which then runs the
 * exit-safety scan on top). Signals are DISCOVERY only; they never authorise a
 * trade.
 */

import { query, execute } from "../client.js";
import { jsonb, nullableJsonb } from "../params.js";

export interface SignalUpsertInput {
  readonly source: string;
  readonly chain: string;
  readonly contract: string;
  readonly symbol: string | null;
  readonly action: string | null;
  readonly score: number | null;
  readonly todayMentions: number | null;
  readonly yesterdayMentions: number | null;
  readonly velocityPct: number | null;
  readonly liquidityUsd: number | null;
  readonly volume24hUsd: number | null;
  readonly priceUsd: number | null;
  readonly narratives: string[];
  readonly riskFlags: string[];
  readonly raw: unknown;
  readonly firstSeenAt: string | null;
  readonly lastSeenAt: string | null;
  readonly feedGeneratedAt: string | null;
}

export interface SignalRow {
  readonly source: string;
  readonly chain: string;
  readonly contract: string;
  readonly symbol: string | null;
  readonly action: string | null;
  readonly score: number | null;
  readonly todayMentions: number | null;
  readonly yesterdayMentions: number | null;
  readonly velocityPct: number | null;
  readonly liquidityUsd: number | null;
  readonly volume24hUsd: number | null;
  readonly priceUsd: number | null;
  readonly narratives: string[];
  readonly riskFlags: string[];
  readonly ingestedAt: string;
}

const UPSERT_SQL = `
  INSERT INTO signals (
    source, chain, contract, symbol, action, score,
    today_mentions, yesterday_mentions, velocity_pct,
    liquidity_usd, volume_24h_usd, price_usd,
    narratives, risk_flags, raw, first_seen_at, last_seen_at, feed_generated_at, ingested_at
  ) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
    $13::jsonb, $14::jsonb, $15::jsonb, $16, $17, $18, NOW()
  )
  ON CONFLICT (source, chain, LOWER(contract)) DO UPDATE SET
    symbol             = EXCLUDED.symbol,
    action             = EXCLUDED.action,
    score              = EXCLUDED.score,
    today_mentions     = EXCLUDED.today_mentions,
    yesterday_mentions = EXCLUDED.yesterday_mentions,
    velocity_pct       = EXCLUDED.velocity_pct,
    liquidity_usd      = EXCLUDED.liquidity_usd,
    volume_24h_usd     = EXCLUDED.volume_24h_usd,
    price_usd          = EXCLUDED.price_usd,
    narratives         = EXCLUDED.narratives,
    risk_flags         = EXCLUDED.risk_flags,
    raw                = EXCLUDED.raw,
    first_seen_at      = EXCLUDED.first_seen_at,
    last_seen_at       = EXCLUDED.last_seen_at,
    feed_generated_at  = EXCLUDED.feed_generated_at,
    ingested_at        = NOW()
`;

/** Upsert the latest signal per (source, chain, contract). Returns rows written. */
export async function upsertSignals(records: readonly SignalUpsertInput[]): Promise<number> {
  let written = 0;
  for (const r of records) {
    written += await execute(UPSERT_SQL, [
      r.source, r.chain, r.contract, r.symbol, r.action, r.score,
      r.todayMentions, r.yesterdayMentions, r.velocityPct,
      r.liquidityUsd, r.volume24hUsd, r.priceUsd,
      jsonb(r.narratives ?? []), jsonb(r.riskFlags ?? []),
      nullableJsonb(r.raw ?? null), r.firstSeenAt, r.lastSeenAt, r.feedGeneratedAt,
    ]);
  }
  return written;
}

export interface ListRecentSignalsOptions {
  /** Rolling window in hours (e.g. 48 for "today + yesterday"). */
  readonly withinHours: number;
  readonly chain?: string;
  readonly minScore?: number;
  readonly limit?: number;
}

/** The rolling-window read: freshest, highest-scored signals first. */
export async function listRecentSignals(opts: ListRecentSignalsOptions): Promise<SignalRow[]> {
  const params: unknown[] = [opts.withinHours];
  let where = "ingested_at > NOW() - make_interval(hours => $1::int)";
  if (opts.chain) { params.push(opts.chain); where += ` AND chain = $${params.length}`; }
  if (opts.minScore !== undefined) { params.push(opts.minScore); where += ` AND score >= $${params.length}`; }
  params.push(opts.limit ?? 50);
  const limitIdx = params.length;

  const rows = await query<{
    source: string; chain: string; contract: string; symbol: string | null;
    action: string | null; score: number | null; today_mentions: number | null;
    yesterday_mentions: number | null; velocity_pct: number | null;
    liquidity_usd: number | null; volume_24h_usd: number | null; price_usd: number | null;
    narratives: string[]; risk_flags: string[]; ingested_at: Date;
  }>(
    `SELECT source, chain, contract, symbol, action, score, today_mentions,
            yesterday_mentions, velocity_pct, liquidity_usd, volume_24h_usd, price_usd,
            narratives, risk_flags, ingested_at
       FROM signals
      WHERE ${where}
      ORDER BY score DESC NULLS LAST, ingested_at DESC
      LIMIT $${limitIdx}`,
    params,
  );

  return rows.map((r) => ({
    source: r.source, chain: r.chain, contract: r.contract, symbol: r.symbol,
    action: r.action, score: r.score, todayMentions: r.today_mentions,
    yesterdayMentions: r.yesterday_mentions, velocityPct: r.velocity_pct,
    liquidityUsd: r.liquidity_usd, volume24hUsd: r.volume_24h_usd, priceUsd: r.price_usd,
    narratives: r.narratives ?? [], riskFlags: r.risk_flags ?? [],
    ingestedAt: r.ingested_at instanceof Date ? r.ingested_at.toISOString() : String(r.ingested_at),
  }));
}
