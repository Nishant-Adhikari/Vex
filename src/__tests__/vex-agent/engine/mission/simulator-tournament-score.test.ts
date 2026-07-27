import { describe, expect, it } from "vitest";
import { scoreSimulatorResult } from "@vex-agent/engine/mission/simulator-tournament-score.js";
import type { MissionResultRow } from "@vex-agent/db/repos/mission-results.js";

function row(partial: Partial<MissionResultRow>): MissionResultRow {
  return {
    id: "r1",
    missionId: "m1",
    missionRunId: "run1",
    sessionId: "s1",
    walletAddress: "0x1",
    chainId: 4663,
    seqNo: 1,
    goalSnippet: null,
    startedAt: "2026-07-26T00:00:00.000Z",
    endedAt: "2026-07-26T00:10:00.000Z",
    durationS: 600,
    bankrollStartEth: 1,
    bankrollEndEth: 1.1,
    pnlEth: 0.1,
    pnlPct: 10,
    ethPriceUsdStart: 0,
    ethPriceUsdEnd: 0,
    trades: 1,
    wins: 1,
    losses: 0,
    rotations: 0,
    vetoes: 0,
    outcome: "completed",
    stopReason: "goal_reached",
    simulated: true,
    summary: null,
    openPositions: null,
    startPositions: null,
    ...partial,
  };
}

describe("scoreSimulatorResult", () => {
  it("prefers a profitable completed run over a failed loser", () => {
    const a = scoreSimulatorResult(row({ pnlPct: 50, pnlEth: 0.2, outcome: "completed" }));
    const b = scoreSimulatorResult(
      row({ pnlPct: -8, pnlEth: -0.02, outcome: "failed", stopReason: "max_loss_hit", losses: 1 }),
    );
    expect(a.terminal).toBe(true);
    expect(a.score).toBeGreaterThan(b.score);
  });

  it("treats a running row as non-terminal and ineligible", () => {
    const s = scoreSimulatorResult(row({ outcome: "running", endedAt: null }));
    expect(s.terminal).toBe(false);
    expect(s.score).toBe(Number.NEGATIVE_INFINITY);
  });
});
