/**
 * Signal ingestion — fetch → parse → upsert, with injected deps (no net, no DB).
 * A parse/version failure must abort BEFORE any upsert (never write a feed we
 * don't understand).
 */

import { describe, it, expect, vi } from "vitest";
import { ingestSignalsFeed } from "@vex-agent/signals/ingest.js";
import { SIGNAL_FEED_VERSION } from "@vex-agent/signals/feed.js";
import type { SignalUpsertInput } from "@vex-agent/db/repos/signals.js";

function validFeed() {
  return {
    version: SIGNAL_FEED_VERSION,
    generated_at: "2026-07-12T04:46:00+00:00",
    window: { start: "2026-07-11T00:00:00+00:00", end: "2026-07-12T23:59:59+00:00" },
    count: 2,
    signals: [
      { symbol: "DATABEAR", contract: "0x9007985723", chain: "robinhood", action: "RESEARCH", score: 71, today_mentions: 3, narratives: [], risk_flags: [] },
      { symbol: "WALLET", contract: "0x0339f5459f", chain: "robinhood", action: "WATCH", score: 60, today_mentions: 0, narratives: [], risk_flags: [] },
    ],
  };
}

describe("ingestSignalsFeed", () => {
  it("fetches, parses, and upserts the feed's signals", async () => {
    let upserted: SignalUpsertInput[] = [];
    const result = await ingestSignalsFeed("http://feed", {
      fetchFeed: async () => validFeed(),
      upsert: async (records) => { upserted = records; return records.length; },
    });

    expect(result.fetched).toBe(2);
    expect(result.written).toBe(2);
    expect(result.generatedAt).toBe("2026-07-12T04:46:00+00:00");
    expect(upserted).toHaveLength(2);
    expect(upserted[0]!.source).toBe("trendradar");
    expect(upserted[0]!.feedGeneratedAt).toBe("2026-07-12T04:46:00+00:00");
    expect(upserted.map((r) => r.symbol)).toEqual(["DATABEAR", "WALLET"]);
  });

  it("aborts on an unsupported feed version WITHOUT upserting", async () => {
    const upsert = vi.fn(async () => 0);
    await expect(
      ingestSignalsFeed("http://feed", {
        fetchFeed: async () => ({ ...validFeed(), version: 999 }),
        upsert,
      }),
    ).rejects.toThrow(/version/i);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("propagates a fetch failure without upserting", async () => {
    const upsert = vi.fn(async () => 0);
    await expect(
      ingestSignalsFeed("http://feed", {
        fetchFeed: async () => { throw new Error("HTTP 404"); },
        upsert,
      }),
    ).rejects.toThrow(/404/);
    expect(upsert).not.toHaveBeenCalled();
  });
});
