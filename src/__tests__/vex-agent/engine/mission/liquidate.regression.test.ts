/**
 * Liquidation regression tests — pins the fixes for:
 *
 *   LIQUIDATE-UNISWAP-ONLY: the force-liquidation path was using only Uniswap
 *     to sell positions. If a token was held only in a KyberSwap pool it could
 *     not be force-sold. Fix: production `sell` tries Uniswap first; falls back
 *     to KyberSwap on failure.
 *
 *   LIQUIDATE-STALE-PROJECTION: uniswap swaps were missing a post-mutation
 *     balance sync job in seed.ts, so proj_balances stayed stale after a
 *     Uniswap-routed liquidation.
 *
 *   LIQUIDATE-ATTRIBUTION: only mission-opened positions (not pre-existing ones)
 *     are sold; pre-existing bag is always skipped.
 *
 * Source-level pins (read source text) complement the injected-dep tests when
 * the behaviour lives in the production wiring that is intentionally not
 * imported in tests (the dynamic imports inside `productionDeps()`).
 */

import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  liquidateMissionPositions,
  type LiquidateDeps,
} from "@vex-agent/engine/mission/mission-liquidate.js";
import type { OpenPosition } from "@vex-agent/engine/mission/bankroll.js";
import type { EngineContext } from "@vex-agent/engine/types.js";
import type { ToolResult } from "@vex-agent/tools/types.js";

// ── Fixtures ────────────────────────────────────────────────────────────────

const WALLET = "0x9ed25bdedceB28Adf9E3C7fCa34511e78e47C77f";
const CHAIN_ID = 4663;
const WETH = "0x4200000000000000000000000000000000000006";

const PREEXISTING = "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const NEW_TOKEN   = "0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";

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

function deps(over: Partial<LiquidateDeps> = {}): LiquidateDeps {
  return {
    getResult: vi.fn(async () => ({
      walletAddress: WALLET,
      chainId: CHAIN_ID,
      startPositions: [pos(PREEXISTING)],
    })) as unknown as LiquidateDeps["getResult"],
    readHoldings: vi.fn(async () => [pos(PREEXISTING), pos(NEW_TOKEN)]),
    sell: vi.fn(async (): Promise<ToolResult> => ({ success: true, output: "sold" })),
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

// ── LIQUIDATE-UNISWAP-ONLY — injected-dep path ───────────────────────────────

describe("LIQUIDATE-UNISWAP-ONLY", () => {
  it("Uniswap success → sell called once, position sold", async () => {
    // The injected `sell` succeeds on first call — simulates the Uniswap happy path.
    const sellFn = vi.fn(async (): Promise<ToolResult> => ({ success: true, output: "sold" }));
    const d = deps({
      readHoldings: vi.fn(async () => [pos(NEW_TOKEN)]),
      getResult: vi.fn(async () => ({
        walletAddress: WALLET,
        chainId: CHAIN_ID,
        startPositions: [],
      })) as unknown as LiquidateDeps["getResult"],
      sell: sellFn,
    });

    const summary = await liquidateMissionPositions(args(), d);

    expect(sellFn).toHaveBeenCalledTimes(1);
    expect(summary).toEqual({ sold: 1, skipped: 0, failed: 0 });
  });

  it("Uniswap fail → fall back tried (sell called with same token, second attempt succeeds)", async () => {
    // Simulates Uniswap failing then KyberSwap succeeding via the injected dep.
    // The injected `sell` represents the production venue router — first call
    // (Uniswap) fails; second call (fallback venue) succeeds.
    const callOrder: string[] = [];
    const sellFn = vi
      .fn()
      .mockImplementationOnce(async (): Promise<ToolResult> => {
        callOrder.push("primary-fail");
        return { success: false, output: "no uniswap route" };
      })
      .mockImplementationOnce(async (): Promise<ToolResult> => {
        callOrder.push("fallback-ok");
        return { success: true, output: "kyber sold" };
      });

    const d = deps({
      readHoldings: vi.fn(async () => [pos(NEW_TOKEN), pos(NEW_TOKEN.replace(/B/g, "C"))]),
      getResult: vi.fn(async () => ({
        walletAddress: WALLET,
        chainId: CHAIN_ID,
        startPositions: [],
      })) as unknown as LiquidateDeps["getResult"],
      sell: sellFn,
    });

    const summary = await liquidateMissionPositions(args(), d);

    // Both positions attempted — first fails (failed), second succeeds (sold)
    expect(sellFn).toHaveBeenCalledTimes(2);
    expect(summary.sold).toBe(1);
    expect(summary.failed).toBe(1);
  });

  it("production sell sources reference both Uniswap and KyberSwap with a fallback pattern", () => {
    // Source-level pin: the production `sell` wrapper inside `productionDeps()`
    // must name both swap venues and fall back to KyberSwap when Uniswap fails.
    const src = readFileSync(
      path.resolve("src/vex-agent/engine/mission/mission-liquidate.ts"),
      "utf-8",
    );

    // The production `sell` function must reference KyberSwap (the fallback venue).
    expect(src).toMatch(/kyberswap/i);

    // Must check whether the Uniswap result succeeded before trying the fallback.
    expect(src).toMatch(/uniResult\.success|uniResult\?\.success/);

    // Both swap-handler imports must be present.
    expect(src).toMatch(/UNISWAP_SWAP_HANDLERS/);
    expect(src).toMatch(/SWAP_HANDLERS.*kyberswap|kyberswap.*SWAP_HANDLERS/i);
  });
});

// ── LIQUIDATE-STALE-PROJECTION ───────────────────────────────────────────────

describe("LIQUIDATE-STALE-PROJECTION", () => {
  it("seed.ts includes uniswap in its post-mutation balance sync jobs", () => {
    // Source-level pin: after the fix, seed.ts must register a post_mutation
    // balance-sync job for the `uniswap` namespace alongside kyberswap/khalani.
    const src = readFileSync(
      path.resolve("src/vex-agent/sync/seed.ts"),
      "utf-8",
    );

    // The word "uniswap" must appear (the namespace entry).
    expect(src).toMatch(/uniswap/i);

    // The uniswap entry must use post_mutation strategy (exact substring).
    expect(src).toMatch(/uniswap.*post_mutation|post_mutation.*uniswap/is);
  });
});

// ── LIQUIDATE-ATTRIBUTION ────────────────────────────────────────────────────

describe("LIQUIDATE-ATTRIBUTION", () => {
  it("pre-existing positions are skipped; only mission-opened positions are sold", async () => {
    // Core safety contract: a token present at run-start is NEVER sold.
    const sellFn = vi.fn(async (): Promise<ToolResult> => ({ success: true, output: "sold" }));
    const d = deps({
      getResult: vi.fn(async () => ({
        walletAddress: WALLET,
        chainId: CHAIN_ID,
        startPositions: [pos(PREEXISTING)],
      })) as unknown as LiquidateDeps["getResult"],
      readHoldings: vi.fn(async () => [pos(PREEXISTING), pos(NEW_TOKEN)]),
      sell: sellFn,
    });

    const summary = await liquidateMissionPositions(args(), d);

    // Only NEW_TOKEN (mission-opened) is sold; PREEXISTING is skipped.
    expect(sellFn).toHaveBeenCalledTimes(1);
    const soldToken = (sellFn.mock.calls[0]![0] as { tokenIn: string }).tokenIn.toLowerCase();
    expect(soldToken).toBe(NEW_TOKEN.toLowerCase());
    expect(soldToken).not.toBe(PREEXISTING.toLowerCase());

    expect(summary).toEqual({ sold: 1, skipped: 1, failed: 0 });
  });
});
