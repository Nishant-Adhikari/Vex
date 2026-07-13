/**
 * Deadline force-liquidation — sell the positions THAT MISSION opened back to
 * native ETH when a run hits its hard deadline, so the run ends FLAT instead of
 * stranded holding a bag.
 *
 * Context: the hard-deadline enforcer in `turn-loop.ts` sets
 * `stopReason = "deadline_reached"` and stops the run, but the agent can be
 * mid-position (a real run bought REPE and got cut off holding it, down ~29% in
 * ETH). This closes those positions at the deadline. It moves REAL money, so the
 * safety contract below is NON-NEGOTIABLE:
 *
 *   1. Only sell MISSION-ATTRIBUTABLE positions — a token present in the
 *      wallet's CURRENT non-ETH holdings but NOT in the run's start-positions
 *      snapshot (`start_positions_json`, captured at open in the ledger row).
 *      A pre-existing holding is NEVER sold.
 *   2. Never touch native ETH / WETH — those ARE the bankroll.
 *   3. Only the mission's wallet + chain — read from the ledger row, which was
 *      keyed by `mission-results-capture.ts` `resolveWalletChain`.
 *   4. High slippage tolerance — the goal is to EXIT, accept the price.
 *   5. Skip unsellable positions — a sell that reverts / has no route (honeypot,
 *      fee-on-transfer) is logged and skipped; the loop continues.
 *   6. FULLY FAIL-SOFT — the whole body is wrapped so ANY error is logged and
 *      swallowed; liquidation must NEVER prevent the run from finalizing.
 *
 * Deps are injected (mirroring `mission-results-capture.ts`) so tests exercise
 * the attribution + safety logic with no RPC and no real swaps.
 */

import { getResultForRun } from "../../db/repos/mission-results.js";
import { readEthBankroll, type OpenPosition } from "./bankroll.js";
import { buildSessionWalletResolution } from "../core/hydrate.js";
import { NATIVE_TOKEN_ADDRESS } from "../../../tools/kyberswap/constants.js";
import type { EngineContext } from "../types.js";
import type { ProtocolExecutionContext } from "../../tools/protocols/types.js";
import type { ToolResult } from "../../tools/types.js";
import logger from "@utils/logger.js";

/**
 * High slippage tolerance for the exit swap. The goal is to EXIT the position
 * at the deadline, not to get a good fill — 1000 bps (10%) accepts the price.
 */
export const LIQUIDATE_SLIPPAGE_BPS = 1000;

/**
 * Sell fractionally under the projection's (float) balance. That amount round-
 * trips through `parseUnits`; if it landed even 1 wei ABOVE the real balance the
 * sufficient-balance guard would REJECT the exit and strand the bag. A ~1e-6
 * haircut is far larger than any float-precision error yet leaves sub-dust
 * behind — so the exit always lands.
 */
export const LIQUIDATE_BALANCE_MARGIN = 0.999999;

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export interface LiquidateSummary {
  /** Positions whose exit swap succeeded. */
  sold: number;
  /** Positions deliberately NOT attempted (pre-existing / native / WETH). */
  skipped: number;
  /** Positions attempted but which threw or returned an unsuccessful result. */
  failed: number;
}

/** Minimal ledger-row shape the liquidator needs (attribution + wallet/chain). */
interface LiquidationLedgerRow {
  walletAddress: string;
  chainId: number;
  startPositions: unknown;
}

export interface LiquidateDeps {
  /** Ledger row for the run — carries wallet/chain + the start-positions bag. */
  getResult: (runId: string) => Promise<LiquidationLedgerRow | null>;
  /** Current non-ETH holdings on the chain (projection openPositions). */
  readHoldings: (walletAddress: string, chainId: number) => Promise<OpenPosition[]>;
  /** Execute a SELL (token → native ETH). Production wires the uniswap handler. */
  sell: (
    params: Record<string, unknown>,
    context: ProtocolExecutionContext,
  ) => Promise<ToolResult>;
  /** Resolve the chain's WETH address (for the native/WETH exclusion). */
  resolveWethAddress: (chainId: number) => string | null;
}

const EMPTY_SUMMARY: LiquidateSummary = { sold: 0, skipped: 0, failed: 0 };

/**
 * Production deps, built lazily inside the fail-soft guard (mirrors
 * `mission-results-capture.ts` `productionDeps`) so a partially-mocked module
 * graph in tests never touches these bindings at import time, and the heavy
 * uniswap swap handler is only pulled in when a deadline actually fires.
 */
async function productionDeps(): Promise<LiquidateDeps> {
  const { UNISWAP_SWAP_HANDLERS } = await import(
    "../../tools/protocols/uniswap/handlers/swap.js"
  );
  const { resolveUniswapDeployment } = await import(
    "../../../tools/uniswap/chains.js"
  );
  const sellHandler = UNISWAP_SWAP_HANDLERS["uniswap.swap.sell"];
  return {
    getResult: getResultForRun,
    readHoldings: async (wallet, chainId) => {
      const bankroll = await readEthBankroll(wallet, chainId);
      return bankroll?.openPositions ?? [];
    },
    sell: (params, context) => sellHandler(params, context),
    resolveWethAddress: (chainId) =>
      resolveUniswapDeployment(String(chainId))?.weth ?? null,
  };
}

/** Lowercased set of addresses held at run start (the pre-existing bag). */
function startPositionAddresses(startPositions: unknown): Set<string> {
  const set = new Set<string>();
  if (!Array.isArray(startPositions)) return set;
  for (const entry of startPositions) {
    const address = (entry as { address?: unknown } | null)?.address;
    if (typeof address === "string" && address.length > 0) {
      set.add(address.toLowerCase());
    }
  }
  return set;
}

/**
 * True when a holding is native ETH / WETH — the bankroll, NEVER to be sold.
 * `computeEthBankroll` already excludes these from openPositions, but this is
 * defense-in-depth: the bankroll must survive even a projection quirk.
 */
function isBankrollToken(
  address: string,
  symbol: string | null,
  wethAddress: string | null,
): boolean {
  const a = address.toLowerCase();
  if (a === NATIVE_TOKEN_ADDRESS.toLowerCase()) return true;
  if (a === ZERO_ADDRESS) return true;
  if (wethAddress && a === wethAddress.toLowerCase()) return true;
  const s = (symbol ?? "").toUpperCase();
  return s === "WETH" || s === "ETH";
}

/**
 * Reconstruct the `ProtocolExecutionContext` a Uniswap sell needs from the
 * engine context — the same `walletResolution` + `walletPolicy` a normal
 * mission tool call is dispatched with (see `run-tool.ts` / `protocol-route.ts`
 * / `runtime.ts`). `approved: true` because this is an internal forced exit at
 * the deadline, not the agent's autonomous execution.
 */
function buildLiquidationExecContext(context: EngineContext): ProtocolExecutionContext {
  return {
    sessionPermission: context.sessionPermission,
    approved: true,
    walletResolution: buildSessionWalletResolution(context),
    walletPolicy: context.walletPolicy,
    sessionId: context.sessionId,
    contextUsageBand: "normal",
  };
}

/** Format a human token amount as a plain decimal string (no scientific notation). */
function formatAmount(amount: number): string {
  if (!Number.isFinite(amount) || amount <= 0) return "0";
  const s = String(amount);
  if (!s.includes("e") && !s.includes("E")) return s;
  // Expand exponential notation (e.g. 1e-7) to a fixed decimal.
  return amount.toFixed(18).replace(/0+$/, "").replace(/\.$/, "");
}

/**
 * Sell the positions this mission opened back to native ETH. Fail-soft: returns
 * a `{ sold, skipped, failed }` summary and NEVER throws.
 */
export async function liquidateMissionPositions(
  args: {
    missionId: string;
    runId: string;
    sessionId: string;
    context: EngineContext;
  },
  injected?: LiquidateDeps,
): Promise<LiquidateSummary> {
  try {
    const deps = injected ?? (await productionDeps());

    const row = await deps.getResult(args.runId);
    if (!row) {
      // No ledger row → no start-positions baseline → we cannot safely tell a
      // mission-opened bag from a pre-existing one. SKIP entirely (never risk
      // selling a pre-existing holding).
      logger.warn("mission.liquidate.no_ledger_row", { runId: args.runId });
      return { ...EMPTY_SUMMARY };
    }

    const preExisting = startPositionAddresses(row.startPositions);
    const wethAddress = deps.resolveWethAddress(row.chainId);
    const holdings = await deps.readHoldings(row.walletAddress, row.chainId);
    const execContext = buildLiquidationExecContext(args.context);

    let sold = 0;
    let skipped = 0;
    let failed = 0;

    for (const holding of holdings) {
      const address = holding.address;
      // #2 — never touch the bankroll (native ETH / WETH).
      if (isBankrollToken(address, holding.symbol, wethAddress)) {
        skipped++;
        continue;
      }
      // #1 — only sell MISSION-ATTRIBUTABLE positions (not held at start).
      if (preExisting.has(address.toLowerCase())) {
        skipped++;
        continue;
      }

      // #4/#5 — high-slippage exit; per-position errors are skipped, not thrown.
      try {
        const result = await deps.sell(
          {
            chain: String(row.chainId),
            tokenIn: address,
            tokenOut: "native",
            amountIn: formatAmount(holding.amount * LIQUIDATE_BALANCE_MARGIN),
            slippageBps: LIQUIDATE_SLIPPAGE_BPS,
            dryRun: false,
          },
          execContext,
        );
        if (result.success) {
          sold++;
        } else {
          failed++;
          logger.warn("mission.liquidate.position_unsellable", {
            runId: args.runId,
            token: address,
            reason: result.output?.slice(0, 200),
          });
        }
      } catch (err) {
        failed++;
        logger.warn("mission.liquidate.position_failed", {
          runId: args.runId,
          token: address,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const summary: LiquidateSummary = { sold, skipped, failed };
    logger.info("mission.liquidate.completed", {
      runId: args.runId,
      missionId: args.missionId,
      ...summary,
    });
    return summary;
  } catch (err) {
    // #6 — fully fail-soft: liquidation must NEVER block finalization.
    logger.warn("mission.liquidate.failed", {
      runId: args.runId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { ...EMPTY_SUMMARY };
  }
}
