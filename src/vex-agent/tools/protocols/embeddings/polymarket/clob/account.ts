/**
 * Retrieval metadata for Polymarket CLOB authenticated-account tools.
 *
 * Mirrors the CLOB manifest grouping (`polymarket/handlers-clob/account.ts`):
 * trades, rebates, heartbeat, order scoring — keyed to the selected wallet.
 *
 * Split into three segments so the façade can re-assemble the EXACT original
 * key order: in the source object these account entries are interleaved with
 * `simplifiedMarkets` (markets) and `cancelOrders` (orders) in the tail —
 * `trades` (head), then `rebates`/`heartbeat`, then `orderScoring`.
 */

import type { ToolDiscoveryMetadata } from "../../../types.js";
import { embeddingText } from "../../../_embedding-text.js";
import { POLYMARKET_CHAINS } from "../../../polymarket/discovery-text.js";

export const ACCOUNT_TRADES_DISCOVERY = {
  "polymarket.clob.trades": {
    canonicalSummary:
      "List your filled trades on a Polymarket prediction-market outcome on Polygon, with optional market or time filter.",
    embeddingText: embeddingText(
      `List the user's executed trades (fills) on Polymarket prediction markets on Polygon, with optional filter by trade id, market condition id, asset id, or before/after unix timestamps. Paginated. ` +
      `Use this when the user wants their trade history, fill history on a yes share or no share, an audit trail of bets they took, time-sliced trades for a tax export, or to reconcile a position. ` +
      `Example queries: my polymarket trade history, fills on this prediction market, polymarket trades since last week, csv of my polymarket fills, audit trail of my bets. ` +
      `Read-only — does not place a bet.`,
    ),
    aliases: [
      "prediction market", "polymarket",
      "trade history", "fills", "my trades",
      "polymarket fills", "executed trades", "tax export",
    ],
    exampleIntents: [
      "my polymarket trade history",
      "fills on this prediction market",
      "polymarket trades since last week",
      "audit trail of my bets",
    ],
    preferredFor: ["trade history", "my fills", "polymarket trades"],
    chains: POLYMARKET_CHAINS,
  },
} satisfies Record<string, ToolDiscoveryMetadata>;

export const ACCOUNT_REBATES_HEARTBEAT_DISCOVERY = {
  "polymarket.clob.rebates": {
    embeddingText: embeddingText(
      `Get the rebated maker fees for one wallet address on a Polymarket prediction market on Polygon for a specific date. ` +
      `Use this when the user wants to check how much maker rebate they earned on a given day, audit their LP-style rebate history, or reconcile rebates against on-book maker activity. ` +
      `Example queries: my polymarket maker rebates today, rebated fees for this address, how much did I make from rebates yesterday, polymarket maker rebate history. ` +
      `Read-only — does not place a bet.`,
    ),
    aliases: [
      "prediction market", "polymarket",
      "maker rebate", "taker rebate", "rebated fees", "rebates",
    ],
    exampleIntents: [
      "my polymarket maker rebates today",
      "rebated fees for this address",
      "polymarket rebate history",
    ],
    chains: POLYMARKET_CHAINS,
  },

  "polymarket.clob.heartbeat": {
    embeddingText: embeddingText(
      `Send a keep-alive heartbeat to the Polymarket CLOB on Polygon to prevent automated orders from auto-cancelling. The CLOB cancels orders when heartbeats stop arriving. ` +
      `Use this when the user is running a market-making bot, keeping resting limits alive across a session, or implementing a watchdog for an automated prediction-market strategy. ` +
      `Example queries: keep my polymarket orders alive, send heartbeat, ping clob, watchdog for prediction market bot. ` +
      `Cost is gas-free off-chain; emits a single ping to the CLOB.`,
    ),
    aliases: [
      "prediction market", "polymarket",
      "heartbeat", "keep alive", "watchdog", "ping clob",
    ],
    exampleIntents: [
      "send polymarket heartbeat",
      "keep my prediction market orders alive",
      "watchdog ping for clob",
    ],
    chains: POLYMARKET_CHAINS,
  },
} satisfies Record<string, ToolDiscoveryMetadata>;

export const ACCOUNT_ORDER_SCORING_DISCOVERY = {
  "polymarket.clob.orderScoring": {
    embeddingText: embeddingText(
      `Check whether one specific open order on a Polymarket prediction market on Polygon is currently being scored for maker rewards. ` +
      `Use this when the user wants to verify a resting order qualifies for maker incentives, debug why an order is or isn't earning rewards, or check competitiveness against the min-spread / size requirements. ` +
      `Example queries: is this polymarket order earning rewards, am I being scored, reward eligibility on this order, check maker reward status. ` +
      `Read-only — does not modify the order.`,
    ),
    aliases: [
      "prediction market", "polymarket",
      "order scoring", "maker rewards", "reward eligibility", "competitiveness",
    ],
    exampleIntents: [
      "is this polymarket order earning rewards",
      "am I being scored on this prediction order",
      "maker reward eligibility on polymarket",
    ],
    chains: POLYMARKET_CHAINS,
  },
} satisfies Record<string, ToolDiscoveryMetadata>;
