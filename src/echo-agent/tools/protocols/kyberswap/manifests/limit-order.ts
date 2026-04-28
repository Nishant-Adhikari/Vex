import type { ProtocolToolManifest } from "../../types.js";
import { embeddingText } from "../../_embedding-text.js";
import { KYBER_LIMIT_ORDER_CHAINS } from "../discovery-text.js";

export const LIMIT_ORDER_TOOLS: readonly ProtocolToolManifest[] = [
  // ── Maker ────────────────────────────────────────────────────────

  {
    toolId: "kyberswap.limitOrder.list",
    namespace: "kyberswap",
    lifecycle: "active",
    description: "List maker's limit orders on a chain — active, filled, cancelled, expired.",
    mutating: false,
    params: [
      { key: "chain", type: "string", required: true, description: "Chain slug or alias." },
      { key: "status", type: "string", description: "Filter by status: active, filled, cancelled, expired." },
    ],
    exampleParams: { chain: "ethereum", status: "active" },
    discovery: {
      embeddingText: embeddingText(
        `List a wallet's KyberSwap limit orders on an EVM chain — see active orders, filled orders, cancelled orders, and expired orders. ` +
        `Use this when the user wants to see their open limit orders, check order history, see what's been filled, or review pending sells and buys. ` +
        `Example queries: show my limit orders, list my open orders on base, what's my order history, check my pending sells, see filled orders, status of my limit orders.`,
      ),
      aliases: ["list orders", "maker orders", "order status", "open orders"],
      exampleIntents: ["show active limit orders", "list my maker orders", "limit order status"],
      chains: KYBER_LIMIT_ORDER_CHAINS,
    },
  },
  {
    toolId: "kyberswap.limitOrder.activeMakingAmount",
    namespace: "kyberswap",
    lifecycle: "active",
    description: "Get total active making amount locked in open orders for a token (for allowance planning). Resolve makerAsset address via khalani.tokens.search first.",
    mutating: false,
    params: [
      { key: "chain", type: "string", required: true, description: "Chain slug or alias." },
      { key: "makerAsset", type: "string", required: true, description: "Maker token address." },
    ],
    exampleParams: { chain: "ethereum", makerAsset: "0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48" },
    discovery: {
      embeddingText: embeddingText(
        `Check how much of a token a wallet has locked in open KyberSwap limit orders on an EVM chain. ` +
        `Use this when the user wants to know how much is locked up in pending orders, plan how much to spend on the next order, or check exposure before placing more orders. ` +
        `Example queries: how much usdc is locked in my orders, what's my open order exposure for eth, total locked in pending limit orders, how much can I still order, exposure check before new order.`,
      ),
      aliases: ["active making amount", "locked amount", "allowance planning", "makerAsset exposure"],
      exampleIntents: ["check allowance needed for limit order", "active making amount for USDC", "locked open order amount"],
      chains: KYBER_LIMIT_ORDER_CHAINS,
    },
  },
  {
    toolId: "kyberswap.limitOrder.create",
    namespace: "kyberswap",
    lifecycle: "active",
    description: "Create a gasless EIP-712 signed limit order. Off-chain relay, on-chain settlement. Resolve token addresses via khalani.tokens.search first.",
    mutating: true,
    params: [
      { key: "chain", type: "string", required: true, description: "Chain slug or alias." },
      { key: "makerAsset", type: "string", required: true, description: "Token to sell (address or symbol)." },
      { key: "takerAsset", type: "string", required: true, description: "Token to buy (address or symbol)." },
      { key: "makingAmount", type: "string", required: true, description: "Amount to sell in human units." },
      { key: "takingAmount", type: "string", required: true, description: "Amount to receive in human units." },
      { key: "expires", type: "string", required: true, description: "Duration until expiry (e.g. 1h, 24h, 7d, 30d)." },
      { key: "dryRun", type: "boolean", description: "Preview order without creating." },
    ],
    exampleParams: { chain: "ethereum", makerAsset: "USDC", takerAsset: "ETH", makingAmount: "100", takingAmount: "0.04", expires: "24h" },
    discovery: {
      embeddingText: embeddingText(
        `Place a gasless limit order on Ethereum, Base, Arbitrum, BNB Chain, Polygon, Optimism and other EVM chains — sell or buy a token only when it hits a target price, with no upfront gas cost. ` +
        `Use this when the user wants to set a target price, sell when price hits X, buy a dip, take profit at a level, or place a limit sell or limit buy. ` +
        `Example queries: sell eth at 5000, place limit order to buy pepe at 0.0001, target price order, take profit at 4k, gasless limit sell, buy the dip at 1900. ` +
        `Order is signed off-chain and fills when price is hit.`,
      ),
      aliases: ["create limit order", "place limit order", "gasless order", "EIP712 order"],
      exampleIntents: ["place limit order on polygon", "create gasless order", "sell USDC for ETH at target price"],
      preferredFor: ["create limit order", "place order", "target price trade"],
      chains: KYBER_LIMIT_ORDER_CHAINS,
    },
  },
  {
    toolId: "kyberswap.limitOrder.cancel",
    namespace: "kyberswap",
    lifecycle: "active",
    description: "Cancel a limit order (gasless — operator signature lapses within ~5 minutes).",
    mutating: true,
    params: [
      { key: "chain", type: "string", required: true, description: "Chain slug or alias." },
      { key: "orderId", type: "number", required: true, description: "Order ID to cancel." },
    ],
    exampleParams: { chain: "ethereum", orderId: 12345 },
    discovery: {
      embeddingText: embeddingText(
        `Cancel a single KyberSwap limit order without paying gas — fast, cost-free cancel by order ID. Cancellation lapses within ~5 minutes. ` +
        `Use this when the user wants to cancel one specific order at no cost, drop a single pending sell or buy, or kill one order without spending gas. ` +
        `Example queries: cancel my limit order 12345, gasless cancel one order, drop my limit sell on eth, cancel this pending order, no-gas cancel, kill order 555.`,
      ),
      aliases: ["cancel order", "gasless cancel", "cancel limit order"],
      exampleIntents: ["cancel my limit order", "gasless cancel order id", "cancel maker order"],
      preferredFor: ["gasless cancel", "cancel one order"],
      chains: KYBER_LIMIT_ORDER_CHAINS,
    },
  },
  {
    toolId: "kyberswap.limitOrder.hardCancel",
    namespace: "kyberswap",
    lifecycle: "active",
    description: "Hard-cancel a limit order on-chain (immediate, costs gas).",
    mutating: true,
    params: [
      { key: "chain", type: "string", required: true, description: "Chain slug or alias." },
      { key: "orderId", type: "number", required: true, description: "Order ID to hard-cancel." },
    ],
    exampleParams: { chain: "ethereum", orderId: 12345 },
    discovery: {
      embeddingText: embeddingText(
        `Cancel one KyberSwap limit order immediately on-chain, with gas — guaranteed instant invalidation. ` +
        `Use this when the user wants to cancel one order right now and is willing to pay gas, force a cancel that won't wait for the gasless lapse window, or invalidate one order at the contract level. ` +
        `Example queries: cancel order now, hard cancel my limit order on chain, kill order immediately, force cancel with gas, cancel right away.`,
      ),
      aliases: ["hard cancel", "on-chain cancel", "immediate cancel", "gas cancel"],
      exampleIntents: ["hard cancel order now", "cancel order on chain", "immediate limit order cancel"],
      preferredFor: ["immediate cancel", "hard cancel", "on-chain cancellation"],
      chains: KYBER_LIMIT_ORDER_CHAINS,
    },
  },

  // ── Taker ────────────────────────────────────────────────────────

  {
    toolId: "kyberswap.limitOrder.pairs",
    namespace: "kyberswap",
    lifecycle: "active",
    description: "List supported trading pairs for limit order filling on a chain.",
    mutating: false,
    params: [
      { key: "chain", type: "string", required: true, description: "Chain slug or alias." },
    ],
    exampleParams: { chain: "ethereum" },
    discovery: {
      embeddingText: embeddingText(
        `List token pairs that can be filled as a KyberSwap limit order taker on an EVM chain. ` +
        `Use this when the user wants to know which markets are available for filling orders, what pairs they can take orders against, or what taker opportunities exist on a chain. ` +
        `Example queries: what pairs can I fill on base, supported limit order markets, available taker pairs on arbitrum, list orderbook pairs, fillable markets.`,
      ),
      aliases: ["supported pairs", "limit order pairs", "order markets", "makerAsset takerAsset"],
      exampleIntents: ["list limit order pairs", "supported order markets", "what pairs can be filled"],
      chains: KYBER_LIMIT_ORDER_CHAINS,
    },
  },
  {
    toolId: "kyberswap.limitOrder.takerOrders",
    namespace: "kyberswap",
    lifecycle: "active",
    description: "Query available limit orders to fill as a taker.",
    mutating: false,
    params: [
      { key: "chain", type: "string", required: true, description: "Chain slug or alias." },
      { key: "makerAsset", type: "string", description: "Filter by maker token address." },
      { key: "takerAsset", type: "string", description: "Filter by taker token address." },
    ],
    exampleParams: { chain: "ethereum" },
    discovery: {
      embeddingText: embeddingText(
        `Find open KyberSwap limit orders on an EVM chain that can be filled by a taker — sorted by best rate. ` +
        `Use this when the user wants to find orders to fill, look for arbitrage opportunities, browse the limit order book, or find above-market rates as a counterparty. ` +
        `Example queries: find orders to fill on base, browse the limit order book, what taker orders exist on arbitrum, best rate orders to take, look for limit order arb.`,
      ),
      aliases: ["open orders", "taker orders", "orders to fill", "best rate orderbook"],
      exampleIntents: ["find open orders to fill", "query taker orders", "limit order orderbook"],
      preferredFor: ["find fillable orders", "taker orderbook", "best rate limit orders"],
      chains: KYBER_LIMIT_ORDER_CHAINS,
    },
  },
  {
    toolId: "kyberswap.limitOrder.fill",
    namespace: "kyberswap",
    lifecycle: "active",
    description: "Fill a limit order as a taker (on-chain execution).",
    mutating: true,
    params: [
      { key: "chain", type: "string", required: true, description: "Chain slug or alias." },
      { key: "orderId", type: "number", required: true, description: "Order ID to fill." },
      { key: "takingAmount", type: "string", required: true, description: "Amount to take in atomic units." },
      { key: "thresholdAmount", type: "string", required: true, description: "Min acceptable making amount in atomic units." },
      { key: "dryRun", type: "boolean", description: "Preview without executing." },
    ],
    exampleParams: { chain: "ethereum", orderId: 12345, takingAmount: "1000000", thresholdAmount: "990000" },
    discovery: {
      embeddingText: embeddingText(
        `Fill one KyberSwap limit order as a taker — single on-chain execution against a specific maker order. ` +
        `Use this when the user wants to take one specific order, execute against a maker, or fill one opportunity they found. ` +
        `Example queries: fill order 12345 on base, take this maker order, execute order fill, take the limit order, accept this single order.`,
      ),
      aliases: ["fill order", "take order", "taker fill", "operator signature", "threshold amount"],
      exampleIntents: ["fill limit order", "take maker order", "execute order fill on chain"],
      preferredFor: ["fill single order", "taker execution"],
      chains: KYBER_LIMIT_ORDER_CHAINS,
    },
  },
  {
    toolId: "kyberswap.limitOrder.batchFill",
    namespace: "kyberswap",
    lifecycle: "active",
    description: "Fill multiple limit orders as a taker in one on-chain transaction.",
    mutating: true,
    params: [
      { key: "chain", type: "string", required: true, description: "Chain slug or alias." },
      { key: "orderIds", type: "string", required: true, description: "Comma-separated order IDs." },
      { key: "takingAmounts", type: "string", required: true, description: "Comma-separated taking amounts in atomic units (one per order)." },
      { key: "thresholdAmount", type: "string", required: true, description: "Min total acceptable making amount in atomic units." },
      { key: "dryRun", type: "boolean", description: "Preview without executing." },
    ],
    exampleParams: { chain: "ethereum", orderIds: "123,456", takingAmounts: "1000000,2000000", thresholdAmount: "2900000" },
    discovery: {
      embeddingText: embeddingText(
        `Fill multiple KyberSwap limit orders as a taker in one on-chain transaction — gas-efficient batch execution. ` +
        `Use this when the user wants to fill many orders at once, batch take maker orders for gas savings, or execute several arb opportunities in one tx. ` +
        `Example queries: batch fill orders, take many limit orders at once, fill multiple orders on base, batch execute taker orders, multi-fill in one transaction.`,
      ),
      aliases: ["batch fill", "fill multiple orders", "batch orders", "multi order fill"],
      exampleIntents: ["batch fill limit orders", "fill multiple orders", "execute many taker orders"],
      preferredFor: ["batch fill", "multiple order fill"],
      chains: KYBER_LIMIT_ORDER_CHAINS,
    },
  },
  {
    toolId: "kyberswap.limitOrder.cancelAll",
    namespace: "kyberswap",
    lifecycle: "active",
    description: "Cancel ALL open limit orders on a chain by increasing the nonce (on-chain, costs gas).",
    mutating: true,
    params: [
      { key: "chain", type: "string", required: true, description: "Chain slug or alias." },
    ],
    exampleParams: { chain: "ethereum" },
    discovery: {
      embeddingText: embeddingText(
        `Cancel every open KyberSwap limit order on an EVM chain in one transaction. ` +
        `Use this when the user wants to wipe all their orders, panic-cancel everything, clear the slate, do an emergency cleanup of pending orders, or invalidate the entire open book at once. ` +
        `Example queries: cancel all my orders, kill all limit orders, panic close everything, clear my open orders on base, wipe all pending sells, mass cancel.`,
      ),
      aliases: ["cancel all orders", "increase nonce", "invalidate orders", "emergency cancel"],
      exampleIntents: ["cancel all limit orders", "invalidate every open order", "emergency cancel all maker orders"],
      preferredFor: ["cancel all", "invalidate all orders", "emergency cleanup"],
      chains: KYBER_LIMIT_ORDER_CHAINS,
    },
  },
];
