/**
 * Mission STATS aggregation tests — the seed-reuse-safe, capital-weighted
 * rollups for the Dashboard "Mission performance"/"Mission stats" panel.
 *
 * Anchored to the real 4-mission ledger that exposed the bug: the same ~0.11
 * ETH was redeployed across missions 3 & 4, so summing seeds double-counted
 * capital and dividing cumulative PnL by the OLDEST (tiniest) seed produced a
 * bogus -32.77%. The correct model treats each mission as self-contained.
 */

import { describe, expect, it } from "vitest";
import type { MissionResultDto } from "@shared/schemas/mission.js";
import {
  bestWorstEth,
  capitalWeightedReturn,
  cumulativeMissionPnlEth,
  currentStakeEth,
  winRate,
} from "../missionStatsModel.js";

/** Minimal row with only the fields these aggregations read. */
function result(p: Partial<MissionResultDto>): MissionResultDto {
  return {
    missionRunId: "run",
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
    ethPriceUsdStart: null,
    ethPriceUsdEnd: null,
    trades: 0,
    outcome: "completed",
    openPositionsCount: 0,
    stopSummary: null,
    ...p,
  };
}

/**
 * The real 4-mission fixture (from `mission_results`), NEWEST-FIRST — the
 * order the `mission.listResults` query returns. Missions 3 & 4 reuse the same
 * ~0.11 ETH seed; only mission 1 carries an ETH price.
 */
const MISSIONS: readonly MissionResultDto[] = [
  result({
    seqNo: 4,
    bankrollStartEth: 0.1096,
    bankrollEndEth: 0.10913,
    pnlEth: -0.000473,
    trades: 6,
  }),
  result({
    seqNo: 3,
    bankrollStartEth: 0.1096,
    bankrollEndEth: 0.1096,
    pnlEth: 0,
    trades: 0,
  }),
  result({
    seqNo: 2,
    bankrollStartEth: 0.01361,
    bankrollEndEth: 0.0096,
    pnlEth: -0.004008,
    trades: 1,
  }),
  result({
    seqNo: 1,
    bankrollStartEth: 0.01368,
    bankrollEndEth: 0.01368,
    pnlEth: 0,
    trades: 2,
    ethPriceUsdStart: 1801,
  }),
];

describe("cumulativeMissionPnlEth", () => {
  it("sums each mission's own ETH PnL (source of truth)", () => {
    expect(cumulativeMissionPnlEth(MISSIONS)).toBeCloseTo(-0.004481, 9);
  });

  it("skips null-pnl rows rather than poisoning the sum", () => {
    expect(
      cumulativeMissionPnlEth([result({ pnlEth: 0.5 }), result({ pnlEth: null })]),
    ).toBeCloseTo(0.5, 9);
  });
});

describe("capitalWeightedReturn", () => {
  it("is Σ pnl_eth / Σ seed_eth as a percentage — NOT divided by the oldest seed", () => {
    const pct = capitalWeightedReturn(MISSIONS);
    // -0.004481 / 0.24649 = -1.818%. The old bug reported -32.77% (dividing by
    // the tiniest/oldest 0.01368 seed).
    expect(pct).toBeCloseTo(-1.818, 3);
    expect(pct).toBeGreaterThan(-3);
    expect(pct).toBeLessThan(0);
  });

  it("does NOT double-count reused capital in the denominator via a stake sum", () => {
    // Two missions reusing the SAME 0.1 ETH, each -0.01 pnl. Capital-weighted
    // return is -0.02 / 0.2 = -10% (Σ seed, even though only 0.1 was ever at
    // risk at once) — the point is it never divides by a single seed.
    const rows = [
      result({ bankrollStartEth: 0.1, pnlEth: -0.01 }),
      result({ bankrollStartEth: 0.1, pnlEth: -0.01 }),
    ];
    expect(capitalWeightedReturn(rows)).toBeCloseTo(-10, 9);
  });

  it("excludes rows missing a pnl or a seed from BOTH sides of the ratio", () => {
    const rows = [
      result({ bankrollStartEth: 1, pnlEth: 0.1 }),
      result({ bankrollStartEth: null, pnlEth: 0.5 }), // no seed → excluded
      result({ bankrollStartEth: 2, pnlEth: null }), // no pnl → excluded
    ];
    // Only the first row qualifies: 0.1 / 1 = +10%.
    expect(capitalWeightedReturn(rows)).toBeCloseTo(10, 9);
  });

  it("returns null when no mission carries both a pnl and a seed", () => {
    expect(capitalWeightedReturn([result({ pnlEth: null })])).toBeNull();
    expect(capitalWeightedReturn([])).toBeNull();
  });

  it("returns null when the summed seed is zero (no meaningful denominator)", () => {
    expect(
      capitalWeightedReturn([result({ bankrollStartEth: 0, pnlEth: 0.1 })]),
    ).toBeNull();
  });
});

describe("currentStakeEth", () => {
  it("is the LATEST mission's starting bankroll (current deployed capital)", () => {
    // Newest-first input → mission 4's 0.1096 seed, NOT the 0.24649 seed sum.
    expect(currentStakeEth(MISSIONS)).toBe(0.1096);
  });

  it("skips a newest row without a bankroll snapshot for the next newest", () => {
    const rows = [
      result({ bankrollStartEth: null }), // newest, no snapshot
      result({ bankrollStartEth: 0.5 }), // next newest with a snapshot
      result({ bankrollStartEth: 0.9 }),
    ];
    expect(currentStakeEth(rows)).toBe(0.5);
  });

  it("returns null when no mission carries a bankroll snapshot", () => {
    expect(currentStakeEth([result({ bankrollStartEth: null })])).toBeNull();
    expect(currentStakeEth([])).toBeNull();
  });
});

describe("winRate", () => {
  it("is the share of missions with pnl > 0 — 0% for the all-flat/loss fixture", () => {
    expect(winRate(MISSIONS)).toBe(0);
  });
});

describe("bestWorstEth", () => {
  it("returns the best and worst single-mission ETH pnl", () => {
    // best is a flat 0 mission; worst is mission 2's -0.004008.
    const bw = bestWorstEth(MISSIONS);
    expect(bw).not.toBeNull();
    expect(bw!.best).toBeCloseTo(0, 9);
    expect(bw!.worst).toBeCloseTo(-0.004008, 9);
  });
});
