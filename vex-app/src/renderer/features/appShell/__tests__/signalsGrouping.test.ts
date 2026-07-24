/**
 * signalsGrouping unit tests (Signals section).
 *
 * The grouping helper is pure and presentation-only: it buckets signals into
 * local-hour groups, orders groups newest-first and rows newest-first within a
 * group, and pins undated rows to a bottom "Unknown time" group. Timestamps are
 * built with the LOCAL-time Date constructor so the assertions hold regardless
 * of the machine's timezone (the helper buckets by local hour, round-tripping
 * the same local components back out).
 */

import { describe, expect, it } from "vitest";
import type { SignalListItemDto } from "@shared/schemas/signals.js";
import {
  groupSignalsByHour,
  UNKNOWN_HOUR_KEY,
} from "../signalsGrouping.js";

/** Minimal DTO factory — only `id` + `ingestedAt` matter to the helper. */
function sig(id: number, ingestedAt: string): SignalListItemDto {
  return {
    id,
    source: "trendradar",
    chain: "solana",
    contract: `contract-${id}`,
    symbol: `T${id}`,
    action: null,
    score: null,
    todayMentions: null,
    yesterdayMentions: null,
    velocityPct: null,
    liquidityUsd: null,
    volume24hUsd: null,
    priceUsd: null,
    priceChange24hPct: null,
    marketCapUsd: null,
    dexscreenerUrl: null,
    narratives: [],
    riskFlags: [],
    feedGeneratedAt: null,
    ingestedAt,
  };
}

/** Local-time ISO — round-trips to the same local hour inside the helper. */
function localIso(
  y: number,
  monthIdx: number,
  day: number,
  h: number,
  m: number,
  s = 0,
): string {
  return new Date(y, monthIdx, day, h, m, s).toISOString();
}

describe("groupSignalsByHour", () => {
  it("buckets by local hour and orders groups newest-first", () => {
    const signals = [
      sig(1, localIso(2026, 6, 24, 4, 30)),
      sig(2, localIso(2026, 6, 24, 5, 10)),
      sig(3, localIso(2026, 6, 24, 3, 59)),
    ];
    const groups = groupSignalsByHour(signals);
    expect(groups.map((g) => g.hourLabel)).toEqual(["05:00", "04:00", "03:00"]);
    // One signal per hour here.
    expect(groups.map((g) => g.signals.length)).toEqual([1, 1, 1]);
  });

  it("orders signals within a group newest-first", () => {
    const signals = [
      sig(1, localIso(2026, 6, 24, 5, 5)),
      sig(2, localIso(2026, 6, 24, 5, 40)),
      sig(3, localIso(2026, 6, 24, 5, 20)),
    ];
    const [group] = groupSignalsByHour(signals);
    expect(group?.hourLabel).toBe("05:00");
    expect(group?.signals.map((e) => e.signal.id)).toEqual([2, 3, 1]);
  });

  it("keeps the hour boundary: :00 and :59 share a bucket, next hour splits", () => {
    const signals = [
      sig(1, localIso(2026, 6, 24, 5, 0, 0)),
      sig(2, localIso(2026, 6, 24, 5, 59, 59)),
      sig(3, localIso(2026, 6, 24, 6, 0, 0)),
    ];
    const groups = groupSignalsByHour(signals);
    expect(groups.map((g) => g.hourLabel)).toEqual(["06:00", "05:00"]);
    const fiveOClock = groups.find((g) => g.hourLabel === "05:00");
    expect(fiveOClock?.signals.map((e) => e.signal.id)).toEqual([2, 1]);
  });

  it("labels the day and includes it on each group", () => {
    const [group] = groupSignalsByHour([sig(1, localIso(2026, 6, 24, 5, 12))]);
    expect(group?.dateLabel).toBe("Jul 24");
    expect(group?.signals[0]?.stamp).toBe("Jul 24 · 05:12");
  });

  it("pins undated rows to a bottom 'Unknown time' group, input order kept", () => {
    const signals = [
      sig(1, "not-a-date"),
      sig(2, localIso(2026, 6, 24, 5, 10)),
      sig(3, ""),
    ];
    const groups = groupSignalsByHour(signals);
    const last = groups[groups.length - 1];
    expect(last?.key).toBe(UNKNOWN_HOUR_KEY);
    expect(last?.hourLabel).toBe("Unknown time");
    expect(last?.dateLabel).toBe("");
    expect(last?.signals.map((e) => e.signal.id)).toEqual([1, 3]);
    expect(last?.signals.every((e) => e.stamp === null)).toBe(true);
    // The dated signal still forms its own group above the unknown bucket.
    expect(groups[0]?.hourLabel).toBe("05:00");
  });

  it("returns an empty array for no signals", () => {
    expect(groupSignalsByHour([])).toEqual([]);
  });
});
