/**
 * Retrieval metadata for Polymarket CLOB market-data tools (public).
 *
 * Mirrors the CLOB manifest grouping (`polymarket/handlers-clob/markets.ts`):
 * orderbook, pricing, midpoints, spreads, trades-print, history, tick/fee,
 * server time, and the lightweight simplified-markets enumeration.
 *
 * `MARKETS_HEAD_DISCOVERY` is the contiguous head block (orderbook…feeRate).
 * `MARKETS_SIMPLIFIED_DISCOVERY` (simplifiedMarkets) is split out so the façade
 * can re-assemble the EXACT original key order — in the source object
 * `simplifiedMarkets` sits in the interleaved tail (after `trades`), not next to
 * the other market-data keys.
 */

import type { ToolDiscoveryMetadata } from "../../../types.js";
import { embeddingText } from "../../../_embedding-text.js";
import { POLYMARKET_CHAINS } from "../../../polymarket/discovery-text.js";

// ── Market Data (public) ──────────────────────────────────────

export const MARKETS_HEAD_DISCOVERY = {
  "polymarket.clob.orderbook": {
    canonicalSummary:
      "Full Polymarket prediction market orderbook on Polygon — bids, asks, tick size, last trade price.",
    embeddingText: embeddingText(
      `Get the full CLOB orderbook for one outcome token on Polymarket — a prediction market on Polygon — including the bid stack, ask stack, tick size, last trade price, and neg risk flag. ` +
      `Use this when the user wants to inspect market depth, see the full bid/ask ladder before placing a limit order, gauge how thin or fat the book is, or look up the price of one yes share or one no share. ` +
      `Example queries: orderbook for this polymarket outcome, show me the bids and asks, market depth on this prediction market, full clob book, tick size and last trade. ` +
      `Read-only — does not place a bet.`,
    ),
    aliases: [
      "prediction market", "polymarket",
      "orderbook", "clob book", "bids asks",
      "market depth", "yes share", "no share",
      "outcome token", "tick size", "neg risk",
    ],
    exampleIntents: [
      "orderbook for this polymarket outcome",
      "show bids and asks on this prediction market",
      "polymarket market depth",
      "full clob book for this token",
    ],
    preferredFor: ["orderbook", "bids asks", "clob book", "market depth"],
    chains: POLYMARKET_CHAINS,
  },

  "polymarket.clob.orderbooks": {
    canonicalSummary:
      "Batch full orderbooks for multiple Polymarket prediction-market outcomes on Polygon — one CLOB call across many tokens.",
    embeddingText: embeddingText(
      `Get full CLOB orderbooks for multiple outcome tokens on Polymarket prediction markets on Polygon in one batched call. ` +
      `Use this when the user is screening many markets at once, scanning a watchlist, or comparing depth across outcomes for arbitrage or LP planning. ` +
      `Example queries: orderbooks for these polymarket tokens, batch market depth check, scan many prediction markets at once, compare bids and asks across outcomes. ` +
      `Read-only — does not place a bet.`,
    ),
    aliases: ["prediction market", "polymarket", "orderbooks", "batch orderbooks", "batch market depth"],
    exampleIntents: [
      "orderbooks for these polymarket tokens",
      "batch market depth check across outcomes",
      "scan orderbooks across many prediction markets",
    ],
    chains: POLYMARKET_CHAINS,
  },

  "polymarket.clob.price": {
    embeddingText: embeddingText(
      `Get the best available BUY or SELL price for one outcome token on a Polymarket prediction market on Polygon. ` +
      `Use this when the user wants the current best bid or best ask for a yes share or no share, a quick price check before placing a limit order, or a single-number snapshot of an outcome. ` +
      `Example queries: best bid on this polymarket outcome, best ask for yes shares, current price on this prediction market, what's the buy price right now. ` +
      `Read-only — does not place a bet.`,
    ),
    aliases: [
      "prediction market", "polymarket",
      "best bid", "best ask", "best bid best ask",
      "yes share", "no share", "outcome token",
    ],
    exampleIntents: [
      "best bid on this polymarket outcome",
      "best ask for this prediction market",
      "current price for yes shares",
    ],
    chains: POLYMARKET_CHAINS,
  },

  "polymarket.clob.prices": {
    canonicalSummary:
      "Batch best BUY/SELL prices for multiple Polymarket prediction-market outcomes on Polygon — one CLOB call across many tokens.",
    embeddingText: embeddingText(
      `Get best BUY or SELL prices for multiple outcome tokens on Polymarket prediction markets on Polygon in one batched call. ` +
      `Use this when the user is screening many outcomes at once, scanning a watchlist for entries, or comparing best bids and asks across markets for arbitrage or LP planning. ` +
      `Example queries: prices across these polymarket outcomes, batch price check, scan many prediction markets, compare best bids for these tokens. ` +
      `Read-only — does not place a bet.`,
    ),
    aliases: ["prediction market", "polymarket", "prices", "batch prices", "batch best bid ask"],
    exampleIntents: [
      "prices across these polymarket tokens",
      "batch price check on prediction markets",
      "scan best bids and asks across outcomes",
    ],
    chains: POLYMARKET_CHAINS,
  },

  "polymarket.clob.midpoint": {
    embeddingText: embeddingText(
      `Get the midpoint price (average of best bid and best ask) for one outcome token on a Polymarket prediction market on Polygon. ` +
      `Use this when the user wants a single fair-value estimate for a yes share or no share, a midpoint reference for limit-order placement, or a quick mark price for a position. ` +
      `Example queries: midpoint for this polymarket outcome, mid price on this prediction market, fair value for yes shares, mark price right now. ` +
      `Read-only — does not place a bet.`,
    ),
    aliases: [
      "prediction market", "polymarket",
      "midpoint", "mid price", "fair value", "mark price",
    ],
    exampleIntents: [
      "midpoint for this polymarket outcome",
      "mid price on this prediction market",
      "fair value for yes shares",
    ],
    chains: POLYMARKET_CHAINS,
  },

  "polymarket.clob.midpoints": {
    canonicalSummary:
      "Batch midpoint prices for multiple Polymarket prediction-market outcomes on Polygon — one CLOB call across many tokens.",
    embeddingText: embeddingText(
      `Get midpoint prices for multiple outcome tokens on Polymarket prediction markets on Polygon in one batched call. ` +
      `Use this when the user is screening many markets at once, scanning a watchlist for fair-value moves, or comparing mid prices across outcomes for arbitrage or LP planning. ` +
      `Example queries: midpoints across these polymarket outcomes, batch mid price check, scan fair values on many prediction markets, compare mid prices. ` +
      `Read-only — does not place a bet.`,
    ),
    aliases: ["prediction market", "polymarket", "midpoints", "batch midpoints", "batch mid price"],
    exampleIntents: [
      "midpoints across these polymarket tokens",
      "batch mid price check on prediction markets",
      "scan fair values across outcomes",
    ],
    chains: POLYMARKET_CHAINS,
  },

  "polymarket.clob.spread": {
    embeddingText: embeddingText(
      `Get the bid-ask spread for one outcome token on a Polymarket prediction market on Polygon. ` +
      `Use this when the user wants to check execution cost on a yes share or no share, compare liquidity across outcomes, or screen a market before placing a limit order. ` +
      `Example queries: spread on this polymarket outcome, bid ask spread for this prediction market, how tight is this market, execution cost check, liquidity screen. ` +
      `Read-only — does not place a bet.`,
    ),
    aliases: [
      "prediction market", "polymarket",
      "bid ask spread", "clob spread", "execution cost", "liquidity",
    ],
    exampleIntents: [
      "spread for this polymarket outcome",
      "bid ask on this prediction market",
      "how tight is this market",
    ],
    chains: POLYMARKET_CHAINS,
  },

  "polymarket.clob.spreads": {
    canonicalSummary:
      "Batch bid-ask spreads for multiple Polymarket prediction-market outcomes on Polygon — one CLOB call across many tokens.",
    embeddingText: embeddingText(
      `Get bid-ask spreads for multiple outcome tokens on Polymarket prediction markets on Polygon in one batched call. ` +
      `Use this when the user is screening many markets at once, scanning a watchlist, or comparing spreads across outcomes for arbitrage or LP planning. ` +
      `Example queries: spreads across these polymarket outcomes, batch spread check, scan many prediction markets, compare spreads for these tokens. ` +
      `Read-only — does not place a bet.`,
    ),
    aliases: ["prediction market", "polymarket", "spreads", "batch spreads", "batch bid ask spread"],
    exampleIntents: [
      "spreads for these polymarket tokens",
      "batch spread check on prediction markets",
      "compare bid ask spreads across outcomes",
    ],
    chains: POLYMARKET_CHAINS,
  },

  "polymarket.clob.lastTrade": {
    embeddingText: embeddingText(
      `Get the last trade price and side (BUY or SELL) for one outcome token on a Polymarket prediction market on Polygon. ` +
      `Use this when the user wants the most recent print on a yes share or no share, a quick reference for the last filled price, or to confirm where the market just traded. ` +
      `Example queries: last trade on this polymarket outcome, most recent print, last fill price for yes shares, where did this prediction market just trade. ` +
      `Read-only — does not place a bet.`,
    ),
    aliases: [
      "prediction market", "polymarket",
      "last trade", "last print", "last fill", "recent trade",
    ],
    exampleIntents: [
      "last trade on this polymarket outcome",
      "most recent print on this prediction market",
      "last fill price for yes shares",
    ],
    chains: POLYMARKET_CHAINS,
  },

  "polymarket.clob.lastTrades": {
    canonicalSummary:
      "Batch last trade prints for multiple Polymarket prediction-market outcomes on Polygon — one CLOB call across many tokens.",
    embeddingText: embeddingText(
      `Get last trade prices for multiple outcome tokens on Polymarket prediction markets on Polygon in one batched call. ` +
      `Use this when the user is screening many markets at once, scanning a watchlist for fresh prints, or comparing recent fills across outcomes for arbitrage or LP planning. ` +
      `Example queries: last trades across these polymarket outcomes, batch last print check, scan recent fills on many prediction markets, compare last trades. ` +
      `Read-only — does not place a bet.`,
    ),
    aliases: ["prediction market", "polymarket", "last trades", "batch last trades", "batch last prints", "batch recent fills"],
    exampleIntents: [
      "last trades for these polymarket tokens",
      "batch last print check on prediction markets",
      "recent fills across many outcomes",
    ],
    chains: POLYMARKET_CHAINS,
  },

  "polymarket.clob.priceHistory": {
    canonicalSummary:
      "OHLC price history time-series for a Polymarket prediction-market outcome on Polygon — 1h, 1d, 1w or all-time intervals.",
    embeddingText: embeddingText(
      `Get the price history time-series for a Polymarket prediction market on Polygon — OHLC data over a configurable interval (1h, 6h, 1d, 1w, 1m, all) with adjustable fidelity. ` +
      `Use this when the user wants a price chart for an outcome, historical odds, the trajectory of a yes share over time, a backtest data feed, or to plot how a prediction market has moved. ` +
      `Example queries: price history for this polymarket market, chart for this prediction market, historical odds, ohlc on this outcome, how has this market moved over time. ` +
      `Read-only — does not place a bet.`,
    ),
    aliases: [
      "prediction market", "polymarket",
      "price history", "chart", "ohlc",
      "historical odds", "time series", "condition id",
    ],
    exampleIntents: [
      "price history for this polymarket market",
      "chart for this prediction market",
      "historical odds on this outcome",
      "ohlc data on polymarket",
    ],
    preferredFor: ["price history", "ohlc", "historical odds", "polymarket chart"],
    chains: POLYMARKET_CHAINS,
  },

  "polymarket.clob.batchPriceHistory": {
    canonicalSummary:
      "Batch OHLC price history time-series for multiple Polymarket prediction-market outcomes on Polygon — up to 20 markets in one call.",
    embeddingText: embeddingText(
      `Get price history time-series for multiple Polymarket prediction markets on Polygon in one batched call (max 20 markets). ` +
      `Use this when the user wants a chart panel across many outcomes, comparing the trajectory of several yes shares at once, building a multi-market backtest, or plotting odds for a portfolio. ` +
      `Example queries: price history for these polymarket markets, batch chart, compare historical odds across outcomes, multi-market ohlc, plot many prediction markets. ` +
      `Read-only — does not place a bet.`,
    ),
    aliases: ["prediction market", "polymarket", "price history", "batch price history", "batch ohlc", "multi market chart"],
    exampleIntents: [
      "price history for these polymarket markets",
      "batch ohlc across prediction markets",
      "multi-market chart panel for outcomes",
    ],
    chains: POLYMARKET_CHAINS,
  },

  "polymarket.clob.serverTime": {
    embeddingText: embeddingText(
      `Get the Polymarket CLOB server time as a unix timestamp — the canonical clock for the prediction market on Polygon. ` +
      `Use this when the user wants to align a client clock with the exchange, debug timestamp drift on a signed order, or stamp a request precisely against server time. ` +
      `Example queries: polymarket server time, clob clock, current unix timestamp on polymarket, server time check. ` +
      `Read-only — does not place a bet.`,
    ),
    aliases: [
      "prediction market", "polymarket",
      "server time", "clob time", "unix timestamp",
    ],
    exampleIntents: [
      "polymarket server time",
      "clob clock",
      "unix timestamp on polymarket",
    ],
    chains: POLYMARKET_CHAINS,
  },

  "polymarket.clob.tickSize": {
    embeddingText: embeddingText(
      `Get the minimum tick size (price increment) for one outcome token on a Polymarket prediction market on Polygon. ` +
      `Use this when the user wants to round a limit-order price to a valid grid, check the smallest meaningful price step on a yes share or no share, or validate an order before signing it. ` +
      `Example queries: tick size for this polymarket outcome, minimum price increment, smallest tick on this prediction market, valid price grid. ` +
      `Read-only — does not place a bet.`,
    ),
    aliases: [
      "prediction market", "polymarket",
      "tick size", "price increment", "min tick",
    ],
    exampleIntents: [
      "tick size for this polymarket outcome",
      "minimum price increment on prediction market",
    ],
    chains: POLYMARKET_CHAINS,
  },

  "polymarket.clob.feeRate": {
    embeddingText: embeddingText(
      `Get the trading fee rate in basis points for one outcome token on a Polymarket prediction market on Polygon. ` +
      `Use this when the user wants to estimate trading cost before placing an order, compare taker fees across markets, or check what the CLOB will charge on a fill. ` +
      `Example queries: fee rate for this polymarket outcome, trading fees on this prediction market, taker fee in bps, what does polymarket charge. ` +
      `Read-only — does not place a bet.`,
    ),
    aliases: [
      "prediction market", "polymarket",
      "fee rate", "trading fees", "taker fee", "basis points", "bps",
    ],
    exampleIntents: [
      "fee rate for this polymarket outcome",
      "trading fees on this prediction market",
      "taker fee bps",
    ],
    chains: POLYMARKET_CHAINS,
  },
} satisfies Record<string, ToolDiscoveryMetadata>;

export const MARKETS_SIMPLIFIED_DISCOVERY = {
  "polymarket.clob.simplifiedMarkets": {
    embeddingText: embeddingText(
      `List Polymarket prediction markets on Polygon in a lightweight paginated form — condition id, active/closed status, outcome tokens with current prices, and reward fields. Faster than the full markets endpoint. ` +
      `Use this when the user wants a quick scan of available markets, a thin enumeration for a screener, an iterator across all markets without the heavy gamma payload, or a fast way to discover condition ids. ` +
      `Example queries: list polymarket markets, browse prediction markets fast, simplified market enumeration, iterate condition ids, lightweight market scan. ` +
      `Read-only — does not place a bet.`,
    ),
    aliases: [
      "prediction market", "polymarket",
      "simplified markets", "market list", "condition id", "lightweight markets",
    ],
    exampleIntents: [
      "list polymarket markets fast",
      "simplified prediction market list",
      "iterate polymarket condition ids",
    ],
    chains: POLYMARKET_CHAINS,
  },
} satisfies Record<string, ToolDiscoveryMetadata>;
