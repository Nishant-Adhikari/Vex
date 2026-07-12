/**
 * Pure derivation tests for the Mission History ledger. Locks the ETH/duration
 * formatting, the null-aware win-rate denominator, the oldest→newest cumulative
 * series, and the sparkline geometry.
 */

import { describe, expect, it } from "vitest";
import type { MissionResultDto } from "@shared/schemas/mission.js";
import {
  EM_DASH,
  computeWinRate,
  cumulativePnlSeries,
  formatDurationS,
  formatEth,
  pnlUsd,
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
