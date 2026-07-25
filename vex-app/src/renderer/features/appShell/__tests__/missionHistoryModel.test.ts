/**
 * Mission History display model — pure functions. The key invariant under
 * test: `missionDisplayOutcome` maps a deadline-reached run to the neutral
 * "timeBoxed" outcome (never "failed"), and that outcome counts as a
 * completion for win-rate purposes — deadline semantics stay out of SQL and
 * UI components, living ONLY in this one pure mapper.
 */

import { describe, it, expect } from "vitest";
import type { MissionResultDto } from "@shared/schemas/mission.js";
import {
  computeWinRate,
  formatCumulativePnl,
  formatDurationS,
  formatEth,
  formatPnl,
  isCompletionLike,
  isUsdFallback,
  missionDisplayOutcome,
  pnlUsd,
  sumPnlEth,
  sumPnlUsd,
} from "../missionHistoryModel.js";

function result(over: Partial<MissionResultDto> = {}): MissionResultDto {
  return {
    missionRunId: "run-1",
    sessionId: "session-1",
    seqNo: 1,
    goalSnippet: "grow ETH",
    startedAt: "2026-07-12T18:00:00.000Z",
    endedAt: "2026-07-12T19:00:00.000Z",
    durationS: 3600,
    bankrollStartEth: 0.01,
    bankrollEndEth: 0.011,
    pnlEth: 0.001,
    pnlPct: 10,
    ethPriceUsdEnd: 3000,
    trades: 2,
    outcome: "completed",
    stopReason: "goal_reached",
    summary: null,
    openPositionsCount: 0,
    simulated: false,
    ...over,
  };
}

describe("missionDisplayOutcome", () => {
  it("maps a deadline-reached, non-completed run to the neutral timeBoxed outcome", () => {
    expect(
      missionDisplayOutcome({ outcome: "failed", stopReason: "deadline_reached" }),
    ).toBe("timeBoxed");
  });

  it("does not remap deadline_reached when the outcome is already completed", () => {
    expect(
      missionDisplayOutcome({ outcome: "completed", stopReason: "deadline_reached" }),
    ).toBe("completed");
  });

  it("passes through every other (outcome, stopReason) pair unchanged", () => {
    expect(missionDisplayOutcome({ outcome: "completed", stopReason: "goal_reached" })).toBe("completed");
    expect(missionDisplayOutcome({ outcome: "cancelled", stopReason: "user_stopped" })).toBe("cancelled");
    expect(missionDisplayOutcome({ outcome: "failed", stopReason: "system_error" })).toBe("failed");
    expect(missionDisplayOutcome({ outcome: "stopped", stopReason: "user_stopped" })).toBe("stopped");
    expect(missionDisplayOutcome({ outcome: "running", stopReason: null })).toBe("running");
    expect(missionDisplayOutcome({ outcome: "failed", stopReason: null })).toBe("failed");
  });
});

describe("isCompletionLike", () => {
  it("is true for completed and timeBoxed only", () => {
    expect(isCompletionLike("completed")).toBe(true);
    expect(isCompletionLike("timeBoxed")).toBe(true);
    expect(isCompletionLike("cancelled")).toBe(false);
    expect(isCompletionLike("failed")).toBe(false);
    expect(isCompletionLike("stopped")).toBe(false);
    expect(isCompletionLike("running")).toBe(false);
  });
});

describe("computeWinRate", () => {
  it("counts a deadline_reached (timeBoxed) run as a completion in the win-rate population", () => {
    const results = [
      result({ missionRunId: "a", outcome: "completed", stopReason: "goal_reached", pnlEth: 0.002 }),
      result({ missionRunId: "b", outcome: "failed", stopReason: "deadline_reached", pnlEth: -0.001 }),
    ];
    // Both are completion-like (timeBoxed counts) -> population of 2, 1 win.
    expect(computeWinRate(results)).toBe(50);
  });

  it("excludes cancelled/stopped/running/failed(non-deadline) runs from the population", () => {
    const results = [
      result({ missionRunId: "a", outcome: "completed", pnlEth: 0.001 }),
      result({ missionRunId: "b", outcome: "cancelled", pnlEth: null }),
      result({ missionRunId: "c", outcome: "stopped", pnlEth: null }),
      result({ missionRunId: "d", outcome: "running", pnlEth: null }),
      result({ missionRunId: "e", outcome: "failed", stopReason: "system_error", pnlEth: -0.005 }),
    ];
    expect(computeWinRate(results)).toBe(100); // only "a" is eligible
  });

  it("is null when no run is eligible", () => {
    expect(computeWinRate([result({ outcome: "running", pnlEth: null })])).toBeNull();
    expect(computeWinRate([])).toBeNull();
  });

  it("excludes a completion-like run with unknown (null) PnL from the population", () => {
    const results = [result({ outcome: "completed", pnlEth: null })];
    expect(computeWinRate(results)).toBeNull();
  });
});

describe("sumPnlEth", () => {
  it("sums known PnL and ignores nulls", () => {
    const results = [
      result({ pnlEth: 0.002 }),
      result({ pnlEth: -0.001 }),
      result({ pnlEth: null }),
    ];
    expect(sumPnlEth(results)).toBeCloseTo(0.001, 9);
  });

  it("is zero for an empty list", () => {
    expect(sumPnlEth([])).toBe(0);
  });
});

describe("formatEth", () => {
  it("formats unsigned by default", () => {
    expect(formatEth(0.0012)).toBe("0.0012");
    expect(formatEth(-0.0012)).toBe("0.0012");
  });
  it("signs positive/negative/zero when requested", () => {
    expect(formatEth(0.001, { signed: true })).toBe("+0.0010");
    expect(formatEth(-0.001, { signed: true })).toBe("-0.0010");
    expect(formatEth(0, { signed: true })).toBe("0.0000");
  });
  it("renders an em dash for null/non-finite", () => {
    expect(formatEth(null)).toBe("—");
    expect(formatEth(Number.NaN)).toBe("—");
  });
});

describe("pnlUsd", () => {
  it("multiplies pnlEth by the close price", () => {
    expect(pnlUsd(0.001, 3000)).toBeCloseTo(3, 9);
  });
  it("is null when either input is unknown", () => {
    expect(pnlUsd(null, 3000)).toBeNull();
    expect(pnlUsd(0.001, null)).toBeNull();
  });
});

describe("formatPnl", () => {
  it("renders signed ETH in eth mode (price ignored)", () => {
    expect(formatPnl(0.0279, "eth", 3000)).toBe("+0.0279 ETH");
    expect(formatPnl(-0.0279, "eth", null)).toBe("-0.0279 ETH");
    expect(formatPnl(0, "eth", 3000)).toBe("0.0000 ETH");
  });

  it("renders compact signed USD in usd mode when a price is known", () => {
    expect(formatPnl(0.001, "usd", 3000)).toBe("+$3.00");
    expect(formatPnl(-0.002, "usd", 3000)).toBe("-$6.00");
  });

  it("FAILS SOFT to ETH in usd mode when the price is null/non-finite", () => {
    expect(formatPnl(0.0279, "usd", null)).toBe("+0.0279 ETH");
    expect(formatPnl(0.0279, "usd", Number.NaN)).toBe("+0.0279 ETH");
  });

  it("renders an em dash for a null/non-finite ETH amount in either mode", () => {
    expect(formatPnl(null, "usd", 3000)).toBe("—");
    expect(formatPnl(Number.NaN, "eth", 3000)).toBe("—");
  });
});

describe("sumPnlUsd", () => {
  it("sums each run at its OWN close price", () => {
    const results = [
      result({ pnlEth: 0.001, ethPriceUsdEnd: 3000 }), // +$3
      result({ pnlEth: 0.002, ethPriceUsdEnd: 2000 }), // +$4
    ];
    expect(sumPnlUsd(results)).toBeCloseTo(7, 9);
  });

  it("ignores runs with no known PnL (they contribute nothing to either total)", () => {
    const results = [
      result({ pnlEth: 0.001, ethPriceUsdEnd: 3000 }),
      result({ pnlEth: null, ethPriceUsdEnd: null }),
    ];
    expect(sumPnlUsd(results)).toBeCloseTo(3, 9);
  });

  it("is null when a PnL-bearing run lacks a close price (no faithful total)", () => {
    const results = [
      result({ pnlEth: 0.001, ethPriceUsdEnd: 3000 }),
      result({ pnlEth: 0.002, ethPriceUsdEnd: null }),
    ];
    expect(sumPnlUsd(results)).toBeNull();
  });

  it("is null when no run has a known PnL", () => {
    expect(sumPnlUsd([result({ pnlEth: null })])).toBeNull();
    expect(sumPnlUsd([])).toBeNull();
  });
});

describe("formatCumulativePnl", () => {
  const priced = [
    result({ pnlEth: 0.001, ethPriceUsdEnd: 3000 }),
    result({ pnlEth: 0.002, ethPriceUsdEnd: 2000 }),
  ];

  it("shows summed USD in usd mode when every run is priced", () => {
    expect(formatCumulativePnl(priced, "usd")).toBe("+$7.00");
  });

  it("shows the signed ETH total in eth mode", () => {
    expect(formatCumulativePnl(priced, "eth")).toBe("+0.0030 ETH");
  });

  it("FAILS SOFT to the ETH total in usd mode when a run lacks a price", () => {
    const mixed = [
      result({ pnlEth: 0.001, ethPriceUsdEnd: 3000 }),
      result({ pnlEth: 0.002, ethPriceUsdEnd: null }),
    ];
    expect(formatCumulativePnl(mixed, "usd")).toBe("+0.0030 ETH");
  });
});

describe("isUsdFallback", () => {
  it("is true only when usd is selected AND a real ETH amount has no usable price", () => {
    expect(isUsdFallback("usd", 0.0279, null)).toBe(true);
    expect(isUsdFallback("usd", 0.0279, Number.NaN)).toBe(true);
  });
  it("is false in eth mode, with a known price, or with no ETH amount", () => {
    expect(isUsdFallback("eth", 0.0279, null)).toBe(false);
    expect(isUsdFallback("usd", 0.0279, 3000)).toBe(false);
    expect(isUsdFallback("usd", null, null)).toBe(false);
  });
});

describe("formatDurationS", () => {
  it("formats seconds/minutes/hours", () => {
    expect(formatDurationS(42)).toBe("42s");
    expect(formatDurationS(125)).toBe("2m");
    expect(formatDurationS(3725)).toBe("1h 02m");
  });
  it("renders an em dash for null/negative/non-finite", () => {
    expect(formatDurationS(null)).toBe("—");
    expect(formatDurationS(-5)).toBe("—");
  });
});
