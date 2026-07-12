/**
 * TrendRadar signal-feed parser.
 *
 * The feed (published by TrendRadar to a versioned `signals.json`) is UNTRUSTED
 * input fetched over HTTP, so parsing is defensive: validate the envelope with
 * zod, reject a version we don't understand, drop signals with no contract (the
 * dedup key Vex stores on), and coerce loose/null numerics. This module owns the
 * cross-repo contract shape — keep `SIGNAL_FEED_VERSION` in lockstep with
 * TrendRadar's `SIGNAL_FEED_VERSION`.
 */

import { z } from "zod";

/** Must match TrendRadar's `SIGNAL_FEED_VERSION`. Bump together on a breaking change. */
export const SIGNAL_FEED_VERSION = 1;

export interface ParsedSignal {
  readonly contract: string;
  readonly chain: string;
  readonly symbol: string | null;
  readonly action: string | null;
  readonly score: number | null;
  readonly todayMentions: number | null;
  readonly yesterdayMentions: number | null;
  readonly velocityPct: number | null;
  readonly liquidityUsd: number | null;
  readonly volume24hUsd: number | null;
  readonly priceUsd: number | null;
  readonly firstSeenAt: string | null;
  readonly lastSeenAt: string | null;
  readonly narratives: string[];
  readonly riskFlags: string[];
  /** The original feed signal object, preserved verbatim for forward-compat. */
  readonly raw: unknown;
}

export interface ParsedFeed {
  readonly version: number;
  readonly generatedAt: string;
  readonly window: { start: string; end: string };
  readonly signals: ParsedSignal[];
}

const num = z.number().nullable().optional();
const strArr = z
  .array(z.string())
  .optional()
  .transform((v) => v ?? []);

const signalSchema = z.object({
  symbol: z.string().nullable().optional(),
  contract: z.string().optional(),
  chain: z.string().optional(),
  action: z.string().nullable().optional(),
  score: num,
  today_mentions: num,
  yesterday_mentions: num,
  velocity_pct: num,
  liquidity_usd: num,
  volume_24h_usd: num,
  price_usd: num,
  first_seen_at: z.string().nullable().optional(),
  last_seen_at: z.string().nullable().optional(),
  narratives: strArr,
  risk_flags: strArr,
});

const feedSchema = z.object({
  version: z.number(),
  generated_at: z.string(),
  window: z.object({ start: z.string(), end: z.string() }),
  signals: z.array(signalSchema),
});

export function parseSignalsFeed(raw: unknown): ParsedFeed {
  const feed = feedSchema.parse(raw); // throws (ZodError) on a structurally invalid envelope
  if (feed.version !== SIGNAL_FEED_VERSION) {
    throw new Error(
      `Unsupported signal feed version ${feed.version}; this build supports ${SIGNAL_FEED_VERSION}`,
    );
  }

  // Preserve the ORIGINAL signal objects (zod strips unknown keys) for `raw`.
  const originals = (raw as { signals?: unknown[] }).signals ?? [];

  const signals: ParsedSignal[] = [];
  feed.signals.forEach((s, i) => {
    const contract = (s.contract ?? "").trim();
    if (!contract) return; // no dedup key → skip this signal, keep the rest
    signals.push({
      contract,
      chain: (s.chain ?? "").trim() || "unknown",
      symbol: s.symbol ?? null,
      action: s.action ?? null,
      score: s.score ?? null,
      todayMentions: s.today_mentions ?? null,
      yesterdayMentions: s.yesterday_mentions ?? null,
      velocityPct: s.velocity_pct ?? null,
      liquidityUsd: s.liquidity_usd ?? null,
      volume24hUsd: s.volume_24h_usd ?? null,
      priceUsd: s.price_usd ?? null,
      firstSeenAt: s.first_seen_at ?? null,
      lastSeenAt: s.last_seen_at ?? null,
      narratives: s.narratives,
      riskFlags: s.risk_flags,
      raw: originals[i] ?? s,
    });
  });

  return {
    version: feed.version,
    generatedAt: feed.generated_at,
    window: feed.window,
    signals,
  };
}
