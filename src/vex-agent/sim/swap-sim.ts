/**
 * Simulator swap paper-fill — the shared bridge between a swap handler running
 * under a `simulator` mission run and the shadow ledger.
 *
 * A swap handler (uniswap / kyberswap) computes its quote exactly as in live
 * mode, then — under simulator mode — calls {@link paperFillSwap} INSTEAD of
 * resolving a signer / building / broadcasting a transaction. This records a
 * shadow trade + updates the shadow position (realizing paper PnL on sells) and
 * returns a `ToolResult` shaped like a real fill (a synthetic tx ref, the
 * quoted amounts, a `simulated: true` marker) so the agent's downstream
 * exit/trailing reasoning proceeds unchanged.
 *
 * Isolation: the result deliberately carries NO `_tradeCapture`, so the real
 * portfolio / PnL projection tables are never touched — only `sim_trades` /
 * `sim_positions`.
 */

import { randomUUID } from "node:crypto";

import type { ToolResult } from "../tools/types.js";
import { recordSimFill } from "../db/repos/sim-ledger.js";
import type { SimSwapFill } from "./paper-fill.js";

/**
 * Swap execute tool ids that the simulator can PAPER-FILL. Any other
 * `user_wallet_broadcast` tool is refused outright under simulator mode (the
 * generic guard in `executeProtocolTool`) because it cannot be modeled safely.
 */
export const PAPER_FILLABLE_SWAP_TOOL_IDS: ReadonlySet<string> = new Set([
  "uniswap.swap.buy",
  "uniswap.swap.sell",
  "kyberswap.swap.buy",
  "kyberswap.swap.sell",
]);

export interface PaperFillArgs {
  readonly missionRunId: string;
  readonly sessionId: string;
  readonly fill: SimSwapFill;
  /** Human input amount (for the result's `amountIn`, display parity). */
  readonly amountInHuman: string;
  /** Human output amount from the quote (for the result's `amountOut`). */
  readonly amountOutHuman: string;
  /** Non-native token symbols on each leg (display parity with a real fill). */
  readonly tokenInSymbol: string;
  readonly tokenOutSymbol: string;
  /** Route descriptor echoed back like a real fill result. */
  readonly route: Record<string, unknown>;
}

/**
 * Record the paper fill + return a real-shaped `ToolResult`. Requires a mission
 * run id — a simulator swap that somehow lacks one throws (fail-closed: we do
 * NOT silently fall through to a live path).
 */
export async function paperFillSwap(args: PaperFillArgs): Promise<ToolResult> {
  if (!args.missionRunId) {
    throw new Error(
      "paperFillSwap: missing missionRunId — refusing to simulate without a run to attribute the shadow trade to.",
    );
  }

  const recorded = await recordSimFill({
    missionRunId: args.missionRunId,
    sessionId: args.sessionId,
    fill: args.fill,
  });

  const simRef = `SIMULATED-${randomUUID()}`;
  const { fill } = args;

  return {
    success: true,
    output: JSON.stringify(
      {
        simulated: true,
        txHash: simRef,
        side: fill.side,
        chain: fill.chain,
        dex: fill.dex,
        tokenIn: args.tokenInSymbol,
        tokenOut: args.tokenOutSymbol,
        amountIn: args.amountInHuman,
        amountOut: args.amountOutHuman,
        priceImpact: fill.priceImpact,
        route: args.route,
        paperPosition: {
          token: fill.tokenSymbol,
          qty: recorded.position.qty,
          costNative: recorded.position.costNative,
          realizedPnlNative: recorded.position.realizedPnlNative,
          ...(fill.side === "sell"
            ? { realizedThisTradeNative: recorded.realizedDelta, closed: recorded.closed }
            : {}),
        },
        note: "SIMULATOR run — paper fill from live quote; no transaction was broadcast.",
      },
      null,
      2,
    ),
    // NO _tradeCapture: the shadow ledger is fully isolated from real PnL.
    data: { simulated: true, simTradeId: recorded.trade.id },
  };
}
