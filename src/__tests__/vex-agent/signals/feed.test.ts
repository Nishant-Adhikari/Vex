/**
 * TrendRadar signal-feed parser — validates the published JSON contract and
 * normalizes it into records Vex persists. The feed is UNTRUSTED input (fetched
 * over HTTP), so parsing must be defensive: reject a wrong version, drop signals
 * with no contract (the dedup key), and coerce loose numbers/nulls.
 */

import { describe, it, expect } from "vitest";
import { parseSignalsFeed, SIGNAL_FEED_VERSION } from "@vex-agent/signals/feed.js";

function feed(overrides: Record<string, unknown> = {}) {
  return {
    version: SIGNAL_FEED_VERSION,
    generated_at: "2026-07-12T04:46:00+00:00",
    window: { start: "2026-07-11T00:00:00+00:00", end: "2026-07-12T23:59:59+00:00" },
    count: 1,
    signals: [
      {
        symbol: "DATABEAR", contract: "0x90079857237dA767c38D1d261a39848ea424319E",
        chain: "robinhood", action: "RESEARCH", score: 71,
        today_mentions: 3, yesterday_mentions: 0, velocity_pct: 300,
        liquidity_usd: 228579, volume_24h_usd: 15089843, price_usd: 0.002394,
        first_seen_at: "2026-07-11T22:00:00+00:00", last_seen_at: "2026-07-12T00:00:00+00:00",
        narratives: ["robinhood"], risk_flags: [],
      },
    ],
    ...overrides,
  };
}

describe("parseSignalsFeed", () => {
  it("parses a valid feed into normalized records", () => {
    const parsed = parseSignalsFeed(feed());
    expect(parsed.version).toBe(SIGNAL_FEED_VERSION);
    expect(parsed.generatedAt).toBe("2026-07-12T04:46:00+00:00");
    expect(parsed.window).toEqual({ start: "2026-07-11T00:00:00+00:00", end: "2026-07-12T23:59:59+00:00" });
    expect(parsed.signals).toHaveLength(1);
    const s = parsed.signals[0]!;
    expect(s.contract).toBe("0x90079857237dA767c38D1d261a39848ea424319E");
    expect(s.symbol).toBe("DATABEAR");
    expect(s.chain).toBe("robinhood");
    expect(s.score).toBe(71);
    expect(s.todayMentions).toBe(3);
    expect(s.liquidityUsd).toBe(228579);
    expect(s.narratives).toEqual(["robinhood"]);
  });

  it("rejects a feed whose version does not match the supported contract", () => {
    expect(() => parseSignalsFeed(feed({ version: 999 }))).toThrow(/version/i);
  });

  it("drops signals with no contract (the dedup key) instead of failing the whole feed", () => {
    const parsed = parseSignalsFeed(
      feed({
        signals: [
          { symbol: "NOCA", contract: "", chain: "robinhood", score: 50 },
          { symbol: "OK", contract: "0xabc0000000000000000000000000000000000001", chain: "robinhood", score: 60 },
        ],
      }),
    );
    expect(parsed.signals.map((s) => s.symbol)).toEqual(["OK"]);
  });

  it("coerces missing/null numeric fields to null and defaults arrays", () => {
    const parsed = parseSignalsFeed(
      feed({
        signals: [
          {
            contract: "0xabc0000000000000000000000000000000000002", chain: "robinhood",
            liquidity_usd: null, score: null,
          },
        ],
      }),
    );
    const s = parsed.signals[0]!;
    expect(s.liquidityUsd).toBeNull();
    expect(s.score).toBeNull();
    expect(s.narratives).toEqual([]);
    expect(s.riskFlags).toEqual([]);
    expect(s.symbol).toBeNull();
  });

  it("throws on structurally invalid input (not an object / missing signals)", () => {
    expect(() => parseSignalsFeed(null)).toThrow();
    expect(() => parseSignalsFeed({ version: SIGNAL_FEED_VERSION })).toThrow();
  });
});
