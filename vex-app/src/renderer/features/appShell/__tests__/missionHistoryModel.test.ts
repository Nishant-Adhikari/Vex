/**
 * Pure derivation tests for the Mission History ledger. Locks the ETH/duration
 * formatting, the null-aware win-rate denominator, the oldest→newest cumulative
 * series, and the sparkline geometry.
 */

import { describe, expect, it } from "vitest";
import type { MissionResultDto } from "@shared/schemas/mission.js";
import {
  EM_DASH,
  bestWorst,
  computeWinRate,
  cumulativePnlSeries,
  dailyBuckets,
  filterByRange,
  formatDurationS,
  formatEth,
  pnlUsd,
  returnPct,
  seedEth,
  sparklinePoints,
  sumPnlEth,
} from "../missionHistoryModel.js";

/** Minimal result row with only the fields a given assertion cares about. */
function result(p: Partial<MissionResultDto>): MissionResultDto {
  return {
    missionRunId: "run-1",
    seqNo: 1,
    goalSnippet: null,
    walletAddress: "0xabc",
    chainId: 1,
    startedAt: "2026-07-11T10:00:00.000Z",
    endedAt: "2026-07-11T10:12:03.000Z",
    durationS: 723,
    bankrollStartEth: 1,
    bankrollEndEth: 1,
    pnlEth: 0,
    pnlPct: 0,
    ethPriceUsdStart: 3000,
    ethPriceUsdEnd: 3000,
    trades: 0,
    outcome: "completed",
    openPositionsCount: 0,
    ...p,
  };
}

describe("formatEth", () => {
  it("trims to a 4-decimal floor", () => {
    expect(formatEth(0.0012)).toBe("0.0012");
  });

  it("keeps up to 6 decimals for larger precision", () => {
    expect(formatEth(1.23456789)).toBe("1.234568");
  });

  it("prefixes a + on non-negative values when signed", () => {
    expect(formatEth(0.0012, { signed: true })).toBe("+0.0012");
    expect(formatEth(0, { signed: true })).toBe("+0.0000");
  });

  it("keeps the native minus sign for negatives", () => {
    expect(formatEth(-0.0034, { signed: true })).toBe("-0.0034");
  });

  it("renders an em dash for null / non-finite", () => {
    expect(formatEth(null)).toBe(EM_DASH);
    expect(formatEth(Number.NaN)).toBe(EM_DASH);
  });
});

describe("formatDurationS", () => {
  it("formats minutes and zero-padded seconds", () => {
    expect(formatDurationS(723)).toBe("12m 03s");
  });

  it("promotes to hours past an hour", () => {
    expect(formatDurationS(3723)).toBe("1h 02m 03s");
  });

  it("renders an em dash for null / negative", () => {
    expect(formatDurationS(null)).toBe(EM_DASH);
    expect(formatDurationS(-5)).toBe(EM_DASH);
  });
});

describe("computeWinRate", () => {
  it("ignores null-pnl rows in the denominator", () => {
    const rows = [
      result({ pnlEth: 0.5 }),
      result({ pnlEth: -0.2 }),
      result({ pnlEth: null }),
    ];
    // 1 win out of 2 computable rows.
    expect(computeWinRate(rows)).toBe(50);
  });

  it("returns null when no row has a computable pnl", () => {
    expect(computeWinRate([result({ pnlEth: null })])).toBeNull();
    expect(computeWinRate([])).toBeNull();
  });
});

describe("sumPnlEth", () => {
  it("sums computable pnl and skips nulls", () => {
    const rows = [
      result({ pnlEth: 0.5 }),
      result({ pnlEth: -0.2 }),
      result({ pnlEth: null }),
    ];
    expect(sumPnlEth(rows)).toBeCloseTo(0.3, 10);
  });
});

describe("cumulativePnlSeries", () => {
  it("runs oldest→newest from a newest-first input", () => {
    // newest-first: [+0.3 (newest), -0.2, +0.5 (oldest)]
    const rows = [
      result({ pnlEth: 0.3 }),
      result({ pnlEth: -0.2 }),
      result({ pnlEth: 0.5 }),
    ];
    const series = cumulativePnlSeries(rows);
    expect(series.map((v) => Number(v.toFixed(2)))).toEqual([0.5, 0.3, 0.6]);
  });

  it("carries the running total flat across a null-pnl row", () => {
    const rows = [
      result({ pnlEth: 0.4 }), // newest
      result({ pnlEth: null }),
      result({ pnlEth: 0.1 }), // oldest
    ];
    const series = cumulativePnlSeries(rows);
    expect(series.map((v) => Number(v.toFixed(2)))).toEqual([0.1, 0.1, 0.5]);
  });
});

describe("sparklinePoints", () => {
  it("maps a rising series with min at the bottom and max at the top", () => {
    // Two points, height 100, pad 0: min→y=100, max→y=0, x spans full width.
    expect(sparklinePoints([0, 1], 100, 100, 0)).toBe("0,100 100,0");
  });

  it("pins a flat series to the vertical middle", () => {
    expect(sparklinePoints([2, 2, 2], 100, 100, 0)).toBe("0,50 50,50 100,50");
  });

  it("returns an empty string for no points", () => {
    expect(sparklinePoints([], 100, 100)).toBe("");
  });
});

describe("pnlUsd", () => {
  it("multiplies pnl by the closing eth price", () => {
    expect(pnlUsd(0.01, 3000)).toBeCloseTo(30, 10);
  });

  it("returns null when either input is missing", () => {
    expect(pnlUsd(null, 3000)).toBeNull();
    expect(pnlUsd(0.01, null)).toBeNull();
  });
});

describe("seedEth", () => {
  it("takes the OLDEST mission's starting bankroll (input is newest-first)", () => {
    const rows = [
      result({ bankrollStartEth: 0.9 }), // newest
      result({ bankrollStartEth: 0.95 }),
      result({ bankrollStartEth: 1.2 }), // oldest → the seed
    ];
    expect(seedEth(rows)).toBe(1.2);
  });

  it("skips an oldest row missing its snapshot and takes the next oldest", () => {
    const rows = [
      result({ bankrollStartEth: 0.9 }),
      result({ bankrollStartEth: 1.1 }), // next-oldest with a snapshot
      result({ bankrollStartEth: null }), // oldest, no snapshot
    ];
    expect(seedEth(rows)).toBe(1.1);
  });

  it("returns null when no row carries a bankroll snapshot", () => {
    expect(seedEth([result({ bankrollStartEth: null })])).toBeNull();
    expect(seedEth([])).toBeNull();
  });
});

describe("returnPct", () => {
  it("expresses cumulative pnl as a percentage of the seed", () => {
    expect(returnPct(2, 0.5)).toBeCloseTo(25, 10);
    expect(returnPct(1, -0.3)).toBeCloseTo(-30, 10);
  });

  it("returns null when the seed is null, zero, or non-finite", () => {
    expect(returnPct(null, 0.5)).toBeNull();
    expect(returnPct(0, 0.5)).toBeNull();
    expect(returnPct(Number.NaN, 0.5)).toBeNull();
  });
});

describe("bestWorst", () => {
  it("returns the max and min computable pnl", () => {
    const rows = [
      result({ pnlEth: 0.5 }),
      result({ pnlEth: -0.2 }),
      result({ pnlEth: null }),
      result({ pnlEth: 0.1 }),
    ];
    expect(bestWorst(rows)).toEqual({ best: 0.5, worst: -0.2 });
  });

  it("returns null when no row has a computable pnl", () => {
    expect(bestWorst([result({ pnlEth: null })])).toBeNull();
    expect(bestWorst([])).toBeNull();
  });
});

describe("filterByRange", () => {
  const now = Date.parse("2026-07-30T00:00:00.000Z");
  const rows = [
    result({ missionRunId: "d3", startedAt: "2026-07-29T00:00:00.000Z" }), // 1d ago
    result({ missionRunId: "d20", startedAt: "2026-07-10T00:00:00.000Z" }), // 20d ago
    result({ missionRunId: "d80", startedAt: "2026-05-11T00:00:00.000Z" }), // 80d ago
  ];

  it("keeps only rows inside a 1-week window", () => {
    const kept = filterByRange(rows, "1W", now).map((r) => r.missionRunId);
    expect(kept).toEqual(["d3"]);
  });

  it("widens with the range", () => {
    expect(filterByRange(rows, "1M", now).map((r) => r.missionRunId)).toEqual([
      "d3",
      "d20",
    ]);
    expect(filterByRange(rows, "3M", now).map((r) => r.missionRunId)).toEqual([
      "d3",
      "d20",
      "d80",
    ]);
  });

  it("ALL keeps everything", () => {
    expect(filterByRange(rows, "ALL", now)).toHaveLength(3);
  });
});

describe("dailyBuckets", () => {
  it("consolidates missions on the same UTC day and orders oldest→newest", () => {
    // newest-first input across two days.
    const rows = [
      result({ startedAt: "2026-07-12T20:00:00.000Z", pnlEth: 0.1 }),
      result({ startedAt: "2026-07-12T09:00:00.000Z", pnlEth: -0.3 }),
      result({ startedAt: "2026-07-11T10:00:00.000Z", pnlEth: 0.5 }),
    ];
    const buckets = dailyBuckets(rows);
    expect(buckets.map((b) => b.key)).toEqual(["2026-07-11", "2026-07-12"]);
    expect(buckets.map((b) => Number(b.valueEth.toFixed(2)))).toEqual([0.5, -0.2]);
    expect(buckets.map((b) => b.count)).toEqual([1, 2]);
  });

  it("skips null-pnl rows in the daily sum but still counts the mission", () => {
    const rows = [
      result({ startedAt: "2026-07-11T12:00:00.000Z", pnlEth: null }),
      result({ startedAt: "2026-07-11T10:00:00.000Z", pnlEth: 0.2 }),
    ];
    const buckets = dailyBuckets(rows);
    expect(buckets).toHaveLength(1);
    expect(Number(buckets[0]!.valueEth.toFixed(2))).toBe(0.2);
    expect(buckets[0]!.count).toBe(2);
  });
});
