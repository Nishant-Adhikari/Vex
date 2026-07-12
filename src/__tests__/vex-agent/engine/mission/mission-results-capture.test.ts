/**
 * Mission results capture — orchestration that opens the ledger row at run start
 * and closes it at finalize. Deps are injected so this runs with no DB/network.
 * Pins: wallet/chain resolution from the mission, PNL math, and fail-soft (a
 * throwing dep never propagates — mission finalization must not break).
 */

import { describe, it, expect, vi } from "vitest";
import {
  computePnl,
  captureMissionStart,
  captureMissionFinal,
  type CaptureDeps,
} from "@vex-agent/engine/mission/mission-results-capture.js";

const MISSION = {
  id: "mission-1",
  goal: "grow ETH +8% in 60 min",
  allowedChains: ["robinhood"],
  allowedWallets: ["0x9ed25bdedceB28Adf9E3C7fCa34511e78e47C77f"],
};

function deps(over: Partial<CaptureDeps> = {}): CaptureDeps {
  return {
    getMission: vi.fn(async () => MISSION as never),
    readBankroll: vi.fn(async () => ({ bankrollEth: 0.01, ethPriceUsd: 3000, openPositions: [] })),
    openResult: vi.fn(async () => {}),
    closeResult: vi.fn(async () => {}),
    getResult: vi.fn(async () => null),
    countTrades: vi.fn(async () => 3),
    ...over,
  };
}

describe("computePnl", () => {
  it("computes ETH delta and percent vs start", () => {
    expect(computePnl(0.01, 0.011)).toEqual({ pnlEth: expect.closeTo(0.001, 9), pnlPct: expect.closeTo(10, 6) });
  });
  it("is null when either bankroll is unknown", () => {
    expect(computePnl(null, 0.01)).toEqual({ pnlEth: null, pnlPct: null });
    expect(computePnl(0.01, null)).toEqual({ pnlEth: null, pnlPct: null });
  });
  it("guards divide-by-zero when start is zero", () => {
    expect(computePnl(0, 0.01).pnlPct).toBeNull();
  });
});

describe("captureMissionStart", () => {
  it("opens a ledger row with the mission's wallet, resolved chainId, and start bankroll", async () => {
    const d = deps();
    await captureMissionStart({ missionId: "mission-1", runId: "run-1", sessionId: "s-1" }, d);
    expect(d.openResult).toHaveBeenCalledTimes(1);
    const arg = (d.openResult as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg).toMatchObject({
      missionRunId: "run-1",
      walletAddress: "0x9ed25bdedceB28Adf9E3C7fCa34511e78e47C77f",
      chainId: 4663,
      bankrollStartEth: 0.01,
      ethPriceUsdStart: 3000,
    });
    expect(arg.goalSnippet).toContain("grow ETH");
  });

  it("no-ops when the mission is missing (nothing to open)", async () => {
    const d = deps({ getMission: vi.fn(async () => null) });
    await captureMissionStart({ missionId: "x", runId: "r", sessionId: "s" }, d);
    expect(d.openResult).not.toHaveBeenCalled();
  });

  it("is fail-soft — a throwing bankroll read never propagates", async () => {
    const d = deps({ readBankroll: vi.fn(async () => { throw new Error("db down"); }) });
    await expect(
      captureMissionStart({ missionId: "mission-1", runId: "r", sessionId: "s" }, d),
    ).resolves.toBeUndefined();
  });
});

describe("captureMissionFinal", () => {
  it("closes with PNL vs the opened start bankroll, and the trade count", async () => {
    const d = deps({
      getResult: vi.fn(async () => ({ startedAt: "2026-07-12T18:00:00Z", bankrollStartEth: 0.01 } as never)),
      readBankroll: vi.fn(async () => ({ bankrollEth: 0.011, ethPriceUsd: 3100, openPositions: [{ symbol: "NOXA", address: "0x", amount: 1, valueUsd: 5 }] })),
    });
    await captureMissionFinal({ missionId: "mission-1", runId: "run-1", sessionId: "s-1", outcome: "completed" }, d);
    const arg = (d.closeResult as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg).toMatchObject({ missionRunId: "run-1", outcome: "completed", bankrollEndEth: 0.011, trades: 3 });
    expect(arg.pnlEth).toBeCloseTo(0.001, 9);
    expect(arg.openPositions).toHaveLength(1);
  });

  it("no-ops when no ledger row was opened for the run", async () => {
    const d = deps({ getResult: vi.fn(async () => null) });
    await captureMissionFinal({ missionId: "m", runId: "r", sessionId: "s", outcome: "failed" }, d);
    expect(d.closeResult).not.toHaveBeenCalled();
  });
});
