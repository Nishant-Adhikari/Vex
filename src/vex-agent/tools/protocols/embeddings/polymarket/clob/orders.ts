/**
 * Retrieval metadata for Polymarket CLOB order/trading tools (authenticated).
 *
 * Mirrors the CLOB manifest grouping (`polymarket/handlers-clob/orders.ts`):
 * buy/sell place EIP-712-signed orders; cancel variants and order lookups.
 *
 * `ORDERS_HEAD_DISCOVERY` is the contiguous head block (buy…order).
 * `ORDERS_CANCEL_ORDERS_DISCOVERY` (cancelOrders) is split out so the façade can
 * re-assemble the EXACT original key order — in the source object `cancelOrders`
 * sits in the interleaved tail (between `heartbeat` and `orderScoring`), not next
 * to the other cancel variants.
 */

import type { ToolDiscoveryMetadata } from "../../../types.js";
import { embeddingText } from "../../../_embedding-text.js";
import { POLYMARKET_CHAINS } from "../../../polymarket/discovery-text.js";

// ── Trading (authenticated) ───────────────────────────────────

export const ORDERS_HEAD_DISCOVERY = {
  "polymarket.clob.buy": {
    canonicalSummary:
      "Place a YES/NO buy order on a Polymarket prediction-market outcome — Polygon CLOB, EIP-712 signed in pUSD.",
    embeddingText: embeddingText(
      `Buy YES or NO outcome shares on Polymarket, a prediction market on Polygon, using a gasless CLOB order paid in pUSD. ` +
      `Use this when the user wants to bet yes or no, place a prediction trade, take a position, ape into a market, or open a YES/NO position with a limit or market price. ` +
      `Example queries: bet yes on the election, buy yes shares at 0.65, place a no bet, ape into trump 2028, take the yes side on bitcoin 100k. ` +
      `pUSD is the collateral.`,
    ),
    aliases: [
      "prediction market", "polymarket",
      "buy yes", "buy no", "buy shares", "buy outcome shares",
      "place bet", "yes share", "no share",
      "EIP-712 order", "EIP-712 signed order",
      "GTC", "FOK", "GTD", "FAK", "post-only", "marketable limit order",
      "pUSD", "USDC.e", "bridged USDC",
    ],
    exampleIntents: [
      "bet yes on bitcoin hitting 100k",
      "buy no shares on polymarket",
      "place a prediction trade at 0.65",
      "ape into this polymarket market",
    ],
    preferredFor: ["place bet", "buy yes shares", "buy no shares"],
    chains: POLYMARKET_CHAINS,
  },

  "polymarket.clob.sell": {
    canonicalSummary:
      "Place a YES/NO sell order on a Polymarket prediction-market outcome — Polygon CLOB, EIP-712 signed.",
    embeddingText: embeddingText(
      `Sell YES or NO outcome shares on Polymarket, a prediction market on Polygon, using a gasless CLOB order that pays out in pUSD when filled. ` +
      `Use this when the user wants to exit a position, take profit, dump a bet before resolution, sell shares at a limit or market price, or close a prediction trade. ` +
      `Example queries: sell my yes shares, exit this polymarket position, take profit on this prediction trade, dump no shares at 0.4, close my polymarket bet. ` +
      `Settles in pUSD.`,
    ),
    aliases: [
      "prediction market", "polymarket",
      "sell yes", "sell no", "sell shares", "sell outcome shares",
      "exit position", "take profit", "close bet",
      "yes share", "no share",
      "EIP-712 order", "EIP-712 signed order",
      "GTC", "FOK", "GTD", "FAK",
      "pUSD", "USDC.e", "bridged USDC",
    ],
    exampleIntents: [
      "sell my yes shares on polymarket",
      "exit this prediction market position",
      "take profit on this polymarket bet",
      "dump no shares at 0.4",
    ],
    preferredFor: ["sell shares", "exit position", "close bet"],
    chains: POLYMARKET_CHAINS,
  },

  "polymarket.clob.cancel": {
    canonicalSummary:
      "Cancel a single open order on a Polymarket prediction-market outcome on Polygon by order ID.",
    embeddingText: embeddingText(
      `Cancel one specific open order on a Polymarket prediction market on Polygon by its order ID. ` +
      `Use this when the user wants to pull a single resting bid or ask, kill one limit order before it fills, or cancel a specific yes/no bet they placed earlier. ` +
      `Example queries: cancel this polymarket order, kill order abc-123, pull my limit on yes shares, cancel my pending bet. ` +
      `Cost is gas-free off-chain — the CLOB removes the order from the book on receipt.`,
    ),
    aliases: [
      "prediction market", "polymarket",
      "cancel order", "kill order", "pull order",
      "open order", "limit order",
    ],
    exampleIntents: [
      "cancel polymarket order",
      "kill this order on prediction market",
      "pull my limit order",
    ],
    preferredFor: ["cancel order", "kill order", "pull limit"],
    chains: POLYMARKET_CHAINS,
  },

  "polymarket.clob.cancelAll": {
    canonicalSummary:
      "Cancel every open order across all your Polymarket prediction-market outcomes on Polygon.",
    embeddingText: embeddingText(
      `Cancel every open order this account has across every Polymarket prediction market on Polygon in one shot. ` +
      `Use this when the user wants a panic-cancel, to flatten all resting bids and asks before stepping away, to kill every open bet on the book, or to clean up after a strategy run. ` +
      `Example queries: cancel all my polymarket orders, kill everything, panic cancel, pull all my limits, cancel all open bets, flatten polymarket book. ` +
      `Cost is gas-free off-chain; affects every order regardless of market.`,
    ),
    aliases: [
      "prediction market", "polymarket",
      "cancel all", "kill all orders", "panic cancel",
      "flatten book", "pull all limits",
    ],
    exampleIntents: [
      "cancel all my polymarket orders",
      "panic cancel everything",
      "kill all open bets on polymarket",
    ],
    preferredFor: ["cancel all", "panic cancel", "flatten orders"],
    chains: POLYMARKET_CHAINS,
  },

  "polymarket.clob.cancelMarket": {
    canonicalSummary:
      "Cancel all your open orders scoped to one Polymarket prediction-market outcome on Polygon (single condition id).",
    embeddingText: embeddingText(
      `Cancel every open order this account has in one specific Polymarket prediction market on Polygon, scoped by condition id and asset id. ` +
      `Use this when the user wants to clear all their bids and asks on a single market while leaving other markets untouched, pull all limits on one outcome, or reset a position before re-entering. ` +
      `Example queries: cancel all my orders on this polymarket market, pull all my limits on this prediction market, kill all bets on this outcome, clear my orders for this condition id. ` +
      `Cost is gas-free off-chain; scoped to the supplied market only.`,
    ),
    aliases: [
      "prediction market", "polymarket",
      "cancel market orders", "cancel all in market",
      "kill orders on this market", "condition id", "clob token id",
    ],
    exampleIntents: [
      "cancel all my orders on this polymarket market",
      "pull all limits on this prediction market",
      "kill all my bets on this outcome",
    ],
    preferredFor: ["cancel market orders", "kill market orders"],
    chains: POLYMARKET_CHAINS,
  },

  "polymarket.clob.orders": {
    canonicalSummary:
      "List your open orders on a Polymarket prediction-market outcome on Polygon, with optional market or asset filter.",
    embeddingText: embeddingText(
      `List the user's open (resting, not yet filled) orders on Polymarket prediction markets on Polygon, with optional filter by order id, market condition id, or asset id. Paginated. ` +
      `Use this when the user wants to see their open orders, check what limits are still working on the book, look up an order by id before cancelling, or audit pending bets per market. ` +
      `Example queries: my open polymarket orders, what limits do I have working, show me my pending bets on this market, look up this order id, list resting orders. ` +
      `Read-only — does not place or cancel orders.`,
    ),
    aliases: [
      "prediction market", "polymarket",
      "open orders", "my orders", "resting orders",
      "order status", "pending bets",
    ],
    exampleIntents: [
      "my open polymarket orders",
      "show my pending bets on this prediction market",
      "list resting orders on polymarket",
      "look up this order id",
    ],
    preferredFor: ["order status", "my orders", "open orders", "cancel order"],
    avoidFor: ["orderbook", "market depth"],
    chains: POLYMARKET_CHAINS,
  },

  "polymarket.clob.order": {
    embeddingText: embeddingText(
      `Get the full state of one specific order on a Polymarket prediction market on Polygon by order id — side, price, size, fill status, market, asset. ` +
      `Use this when the user wants to inspect a single order they placed earlier, check whether it filled or is still resting, debug a stuck order, or look up the exact terms of one yes/no bet. ` +
      `Example queries: status of this polymarket order, look up order abc-123, did my order fill, details on this prediction bet. ` +
      `Read-only — does not modify the order.`,
    ),
    aliases: [
      "prediction market", "polymarket",
      "order details", "order status", "single order", "look up order",
    ],
    exampleIntents: [
      "status of this polymarket order",
      "look up this order id",
      "did my prediction order fill",
    ],
    chains: POLYMARKET_CHAINS,
  },
} satisfies Record<string, ToolDiscoveryMetadata>;

export const ORDERS_CANCEL_ORDERS_DISCOVERY = {
  "polymarket.clob.cancelOrders": {
    canonicalSummary:
      "Cancel multiple specific orders on a Polymarket prediction-market outcome on Polygon by ID list (max 3000).",
    embeddingText: embeddingText(
      `Cancel a specific list of open orders on Polymarket prediction markets on Polygon in one batched call (up to 3000 ids). ` +
      `Use this when the user wants to cancel a curated subset of resting orders without nuking everything via cancel-all, kill a strategy's set of limits in one shot, or pull a hand-picked list of bids and asks. ` +
      `Example queries: cancel these polymarket orders, kill this list of order ids, batch cancel my prediction orders, pull these specific limits. ` +
      `Cost is gas-free off-chain; affects only the listed order ids.`,
    ),
    aliases: [
      "prediction market", "polymarket",
      "cancel orders", "batch cancel", "kill order list",
    ],
    exampleIntents: [
      "cancel these polymarket orders",
      "batch cancel prediction orders",
      "kill this list of order ids",
    ],
    preferredFor: ["batch cancel", "cancel orders list", "kill many orders"],
    chains: POLYMARKET_CHAINS,
  },
} satisfies Record<string, ToolDiscoveryMetadata>;
