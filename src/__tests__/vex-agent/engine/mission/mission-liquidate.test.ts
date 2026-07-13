/**
 * Force-liquidate on deadline — when a mission run hits its hard deadline the
 * enforcer stops it possibly mid-position; this module sells the tokens THAT
 * MISSION opened back to ETH so the run ends flat. It moves REAL money, so the
 * pins below are the safety contract:
 *   - only MISSION-ATTRIBUTABLE positions are sold (current non-ETH holdings
 *     MINUS the run's start-positions); a pre-existing holding is NEVER sold,
 *   - native ETH / WETH (the bankroll) are NEVER sold,
 *   - a position whose sell throws / reverts is skipped (loop continues),
 *   - the whole thing is fail-soft — a thrown dep resolves to a zero summary,
 *   - sells use a high slippage tolerance (goal is to EXIT, accept the price).
 *
 * Deps are injected so this runs with no RPC / no real swaps.
 */

import { describe, it, expect, vi } from "vitest";
import {
  liquidateMissionPositions,
  LIQUIDATE_SLIPPAGE_BPS,
  type LiquidateDeps,
} from "@vex-agent/engine/mission/mission-liquidate.js";
import type { OpenPosition } from "@vex-agent/engine/mission/bankroll.js";
import type { EngineContext } from "@vex-agent/engine/types.js";
import type { ToolResult } from "@vex-agent/tools/types.js";

const WALLET = "0x9ed25bdedceB28Adf9E3C7fCa34511e78e47C77f";
const CHAIN_ID = 4663;
const WETH = "0x4200000000000000000000000000000000000006";

// Addresses (lowercased in attribution; mixed-case here on purpose).
const PREEXISTING = "0xaaaAAAaaAAaaAaaAaaAAAAaAaAAaaAAaAAaAaAaA";
const MISSION_TOKEN_A = "0xbBbBBbbBbBBbbBBbbbbbBBbBBbBbBbbBBbBbBbBb";
const MISSION_TOKEN_B = "0xCcCccCCCcCcCCCCcCCcCCCCcccccCcCcCcCCcccC";

function pos(address: string, over: Partial<OpenPosition> = {}): OpenPosition {
  return { symbol: "TKN", address, amount: 1.5, valueUsd: 100, ...over };
}

const CONTEXT: EngineContext = {
  sessionId: "s-1",
  sessionKind: "mission",
  sessionPermission: "autonomous",
  missionId: "mission-1",
  missionRunId: "run-1",
  isSubagent: false,
  selectedEvmWallet: { id: "w-evm", address: WALLET },
  selectedSolanaWallet: null,
  walletPolicy: { kind: "mission_allowed", allowedWallets: [WALLET] },
  loadedDocuments: new Map(),
} as unknown as EngineContext;

function okResult(): ToolResult {
  return { success: true, output: "sold" };
}

function deps(over: Partial<LiquidateDeps> = {}): LiquidateDeps {
  return {
    getResult: vi.fn(async () => ({
      walletAddress: WALLET,
      chainId: CHAIN_ID,
      // Pre-existing bag held at open — must never be sold.
      startPositions: [pos(PREEXISTING)],
    })) as unknown as LiquidateDeps["getResult"],
    readHoldings: vi.fn(async () => [
      pos(PREEXISTING),
      pos(MISSION_TOKEN_A),
      pos(MISSION_TOKEN_B),
    ]),
    sell: vi.fn(async () => okResult()),
    resolveWethAddress: vi.fn(() => WETH),
    ...over,
  };
}

function args(over: Partial<Parameters<typeof liquidateMissionPositions>[0]> = {}) {
  return {
    missionId: "mission-1",
    runId: "run-1",
    sessionId: "s-1",
    context: CONTEXT,
    ...over,
  };
}

describe("liquidateMissionPositions", () => {
  it("sells ONLY mission-attributable positions, never a pre-existing holding", async () => {
    const d = deps();
    const summary = await liquidateMissionPositions(args(), d);

    const sell = d.sell as ReturnType<typeof vi.fn>;
    expect(sell).toHaveBeenCalledTimes(2);
    const soldTokens = sell.mock.calls.map((c) => (c[0] as { tokenIn: string }).tokenIn.toLowerCase());
    expect(soldTokens).toEqual(
      expect.arrayContaining([MISSION_TOKEN_A.toLowerCase(), MISSION_TOKEN_B.toLowerCase()]),
    );
    // The pre-existing holding is NEVER passed to sell.
    expect(soldTokens).not.toContain(PREEXISTING.toLowerCase());
    expect(summary).toEqual({ sold: 2, skipped: 1, failed: 0 });
  });

  it("never sells native ETH or WETH even if they appear as holdings", async () => {
    const d = deps({
      // startPositions empty → everything is 'attributable', so only the
      // native/WETH exclusion can protect the bankroll here.
      getResult: vi.fn(async () => ({
        walletAddress: WALLET,
        chainId: CHAIN_ID,
        startPositions: [],
      })) as unknown as LiquidateDeps["getResult"],
      readHoldings: vi.fn(async () => [
        pos("0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", { symbol: "ETH" }),
        pos(WETH, { symbol: "WETH" }),
        pos("0x0000000000000000000000000000000000000000", { symbol: "ETH" }),
        pos(MISSION_TOKEN_A),
      ]),
    });
    const summary = await liquidateMissionPositions(args(), d);

    const sell = d.sell as ReturnType<typeof vi.fn>;
    const soldTokens = sell.mock.calls.map((c) => (c[0] as { tokenIn: string }).tokenIn.toLowerCase());
    expect(soldTokens).toEqual([MISSION_TOKEN_A.toLowerCase()]);
    expect(summary.sold).toBe(1);
  });

  it("skips a position whose sell throws and continues to the next (overall resolves)", async () => {
    const sell = vi
      .fn()
      .mockRejectedValueOnce(new Error("swap reverted: honeypot"))
      .mockResolvedValueOnce(okResult());
    const d = deps({ sell });

    const summary = await liquidateMissionPositions(args(), d);

    expect(sell).toHaveBeenCalledTimes(2);
    expect(summary.sold).toBe(1);
    expect(summary.failed).toBe(1);
  });

  it("counts an unsuccessful sell result (no route / revert) as failed, not sold", async () => {
    const d = deps({
      sell: vi.fn(async () => ({ success: false, output: "no route" }) as ToolResult),
    });
    const summary = await liquidateMissionPositions(args(), d);
    expect(summary).toEqual({ sold: 0, skipped: 1, failed: 2 });
  });

  it("is fully fail-soft — a throwing dep resolves to a zero summary, never throws", async () => {
    const d = deps({
      readHoldings: vi.fn(async () => {
        throw new Error("RPC down");
      }),
    });
    const summary = await liquidateMissionPositions(args(), d);
    expect(summary).toEqual({ sold: 0, skipped: 0, failed: 0 });
  });

  it("does nothing when the ledger row was never opened (no attribution baseline)", async () => {
    const d = deps({ getResult: vi.fn(async () => null) as unknown as LiquidateDeps["getResult"] });
    const summary = await liquidateMissionPositions(args(), d);
    expect(d.sell).not.toHaveBeenCalled();
    expect(summary).toEqual({ sold: 0, skipped: 0, failed: 0 });
  });

  it("sells the full balance to native ETH with a high slippage tolerance", async () => {
    const d = deps({
      readHoldings: vi.fn(async () => [pos(MISSION_TOKEN_A, { amount: 42.25 })]),
    });
    await liquidateMissionPositions(args(), d);

    const sell = d.sell as ReturnType<typeof vi.fn>;
    const params = sell.mock.calls[0][0] as Record<string, unknown>;
    expect(LIQUIDATE_SLIPPAGE_BPS).toBeGreaterThanOrEqual(800);
    expect(params).toMatchObject({
      chain: String(CHAIN_ID),
      tokenIn: MISSION_TOKEN_A,
      tokenOut: "native",
      slippageBps: LIQUIDATE_SLIPPAGE_BPS,
      dryRun: false,
    });
    // Sells just UNDER the full balance (safety margin so the float amount never
    // round-trips above the real balance and gets the exit rejected).
    const amt = Number(params.amountIn);
    expect(amt).toBeGreaterThan(42.25 * 0.9999);
    expect(amt).toBeLessThanOrEqual(42.25);
    // Exec context is reconstructed from the engine context (session wallet).
    const ctx = sell.mock.calls[0][1] as {
      walletResolution: { source: string; evm: { address: string } | null };
      walletPolicy: { kind: string };
      sessionPermission: string;
    };
    expect(ctx.walletResolution.source).toBe("session");
    expect(ctx.walletResolution.evm?.address).toBe(WALLET);
    expect(ctx.walletPolicy.kind).toBe("mission_allowed");
  });
});
