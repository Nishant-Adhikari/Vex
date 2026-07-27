/**
 * Mission results capture — orchestration that opens the ledger row at run
 * start and closes it at finalize. Deps are injected so this runs with no
 * DB/network. Pins: wallet/chain resolution from the mission, PNL math, and
 * fail-soft (a throwing dep never propagates — mission finalization must
 * not break).
 */

import { describe, it, expect, vi } from "vitest";
import {
  computePnl,
  computeMissionOpenPositions,
  captureMissionStart,
  captureMissionFinal,
  type CaptureDeps,
} from "../../../../vex-agent/engine/mission/mission-results-capture.js";

const MISSION = {
  id: "mission-1",
  goal: "grow ETH +8% in 60 min",
  allowedChains: ["robinhood"],
  allowedWallets: ["0x9ed25bdedceB28Adf9E3C7fCa34511e78e47C77f"],
  capitalSourceJson: { amount: "$20 (paper)" },
};

function deps(over: Partial<CaptureDeps> = {}): CaptureDeps {
  return {
    getMission: vi.fn(async () => MISSION as never),
    // Default: RPC unavailable → capture falls back to the projection read below.
    readBankrollOnChain: vi.fn(async () => null),
    readBankroll: vi.fn(async () => ({ bankrollEth: 0.01, ethPriceUsd: 3000, openPositions: [] })),
    openResult: vi.fn(async () => {}),
    closeResult: vi.fn(async () => {}),
    getResult: vi.fn(async () => null),
    countTrades: vi.fn(async () => 3),
    // Default: a live run (mode 'live') → the ledger row is not badged simulator.
    getRun: vi.fn(async () => ({ mode: "live" }) as never),
    listSimPositionsForRun: vi.fn(async () => []),
    sumRealizedPnlForRun: vi.fn(async () => 0),
    ...over,
  };
}

describe("computePnl", () => {
  it("computes ETH delta and percent vs start", () => {
    const result = computePnl(0.01, 0.011);
    expect(result.pnlEth).toBeCloseTo(0.001, 9);
    expect(result.pnlPct).toBeCloseTo(10, 6);
  });
  it("is null when either bankroll is unknown", () => {
    expect(computePnl(null, 0.01)).toEqual({ pnlEth: null, pnlPct: null });
    expect(computePnl(0.01, null)).toEqual({ pnlEth: null, pnlPct: null });
  });
  it("guards divide-by-zero when start is zero", () => {
    expect(computePnl(0, 0.01).pnlPct).toBeNull();
  });
});

describe("computeMissionOpenPositions", () => {
  it("excludes pre-existing wallet dust from the final open-position bag", () => {
    expect(computeMissionOpenPositions(
      [{ symbol: "WALLET", address: "0xaaa", amount: 10, valueUsd: 50 }],
      [{ symbol: "WALLET", address: "0xaaa", amount: 10, valueUsd: 50 }],
    )).toEqual([]);
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

  it("badges the ledger row simulated:true for a simulator run", async () => {
    const d = deps({
      getRun: vi.fn(async () => ({ mode: "simulator" }) as never),
      readBankroll: vi.fn(async () => ({ bankrollEth: 999, ethPriceUsd: 2500, openPositions: [] })),
    });
    await captureMissionStart({ missionId: "mission-1", runId: "run-1", sessionId: "s-1" }, d);
    expect(d.openResult).toHaveBeenCalledTimes(1);
    const arg = (d.openResult as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg).toMatchObject({ simulated: true, bankrollStartEth: 20 / 2500 });
  });

  it("no-ops when the mission is missing (nothing to open)", async () => {
    const d = deps({ getMission: vi.fn(async () => null) });
    await captureMissionStart({ missionId: "x", runId: "r", sessionId: "s" }, d);
    expect(d.openResult).not.toHaveBeenCalled();
  });

  it("no-ops when the mission has no resolvable wallet/chain", async () => {
    const d = deps({
      getMission: vi.fn(async () => ({ ...MISSION, allowedWallets: [], allowedChains: [] } as never)),
    });
    await captureMissionStart({ missionId: "mission-1", runId: "r", sessionId: "s" }, d);
    expect(d.openResult).not.toHaveBeenCalled();
  });

  it("is fail-soft — a throwing bankroll read never propagates", async () => {
    const d = deps({ readBankroll: vi.fn(async () => { throw new Error("db down"); }) });
    await expect(
      captureMissionStart({ missionId: "mission-1", runId: "r", sessionId: "s" }, d),
    ).resolves.toBeUndefined();
  });

  it("is fail-soft — a throwing getMission never propagates", async () => {
    const d = deps({ getMission: vi.fn(async () => { throw new Error("db down"); }) });
    await expect(
      captureMissionStart({ missionId: "mission-1", runId: "r", sessionId: "s" }, d),
    ).resolves.toBeUndefined();
    expect(d.openResult).not.toHaveBeenCalled();
  });
});

describe("captureMissionFinal", () => {
  it("closes with PnL vs the opened start bankroll, the trade count, and the raw stop_reason", async () => {
    const d = deps({
      getResult: vi.fn(async () => ({
        startedAt: "2026-07-12T18:00:00Z",
        bankrollStartEth: 0.01,
        startPositions: [{ symbol: "WALLET", address: "0xdust", amount: 10, valueUsd: 5 }],
      } as never)),
      readBankroll: vi.fn(async () => ({
        bankrollEth: 0.011,
        ethPriceUsd: 3100,
        openPositions: [
          { symbol: "WALLET", address: "0xdust", amount: 10, valueUsd: 5 },
          { symbol: "NOXA", address: "0x", amount: 1, valueUsd: 5 },
        ],
      })),
    });
    await captureMissionFinal(
      { missionId: "mission-1", runId: "run-1", sessionId: "s-1", outcome: "completed", stopReason: "goal_reached" },
      d,
    );
    const arg = (d.closeResult as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg).toMatchObject({
      missionRunId: "run-1",
      outcome: "completed",
      stopReason: "goal_reached",
      bankrollEndEth: 0.011,
      trades: 3,
    });
    expect(arg.pnlEth).toBeCloseTo(0.001, 9);
    expect(arg.openPositions).toHaveLength(1);
    expect(arg.openPositions).toEqual([{ symbol: "NOXA", address: "0x", amount: 1, valueUsd: 5 }]);
  });

  it("closes a deadline_reached run with its raw stop_reason (presentation stays out of this module)", async () => {
    const d = deps({
      getResult: vi.fn(async () => ({ startedAt: "2026-07-12T18:00:00Z", bankrollStartEth: 0.01 } as never)),
    });
    await captureMissionFinal(
      { missionId: "mission-1", runId: "run-1", sessionId: "s-1", outcome: "failed", stopReason: "deadline_reached" },
      d,
    );
    const arg = (d.closeResult as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.outcome).toBe("failed");
    expect(arg.stopReason).toBe("deadline_reached");
  });

  it("computes simulator PnL from the shadow ledger instead of the live wallet", async () => {
    const d = deps({
      getRun: vi.fn(async () => ({ mode: "simulator" }) as never),
      getResult: vi.fn(async () => ({
        startedAt: "2026-07-12T18:00:00Z",
        bankrollStartEth: 0.01,
        startPositions: [],
      } as never)),
      listSimPositionsForRun: vi.fn(async () => ([
        {
          id: "pos-1",
          missionRunId: "run-1",
          sessionId: "s-1",
          chain: "robinhood",
          tokenAddress: "0xabc",
          tokenSymbol: "ROAR",
          qty: 1234,
          costNative: 0.004,
          realizedPnlNative: 0.002,
          status: "open",
        },
      ])),
      sumRealizedPnlForRun: vi.fn(async () => 0.002),
      readBankrollOnChain: vi.fn(async () => ({ bankrollEth: 999, ethPriceUsd: 3100, openPositions: [] })),
      readBankroll: vi.fn(async () => ({ bankrollEth: 999, ethPriceUsd: 3100, openPositions: [] })),
    });
    await captureMissionFinal(
      { missionId: "mission-1", runId: "run-1", sessionId: "s-1", outcome: "completed", stopReason: "goal_reached" },
      d,
    );
    const arg = (d.closeResult as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.bankrollEndEth).toBeCloseTo(0.012, 9);
    expect(arg.pnlEth).toBeCloseTo(0.002, 9);
    expect(arg.openPositions).toEqual([
      { symbol: "ROAR", address: "0xabc", amount: 1234, valueUsd: null },
    ]);
  });

  it("no-ops when no ledger row was opened for the run", async () => {
    const d = deps({ getResult: vi.fn(async () => null) });
    await captureMissionFinal(
      { missionId: "m", runId: "r", sessionId: "s", outcome: "failed", stopReason: "system_error" },
      d,
    );
    expect(d.closeResult).not.toHaveBeenCalled();
  });

  it("is fail-soft — a throwing dependency never propagates", async () => {
    const d = deps({
      getResult: vi.fn(async () => { throw new Error("db down"); }),
    });
    await expect(
      captureMissionFinal(
        { missionId: "m", runId: "r", sessionId: "s", outcome: "failed", stopReason: "system_error" },
        d,
      ),
    ).resolves.toBeUndefined();
  });
});
