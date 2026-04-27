import type { ProtocolToolManifest } from "../../types.js";
import { KYBER_LIMIT_ORDER_CHAINS, kyberEmbeddingText } from "../discovery-text.js";

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
      embeddingText: kyberEmbeddingText(
        `list maker limit orders on EVM chains; open active partially filled filled cancelled expired orders; ` +
        `order history; maker order status; ${KYBER_LIMIT_ORDER_CHAINS}`,
      ),
      aliases: ["list orders", "maker orders", "order status", "open orders", "zlecenia"],
      exampleIntents: ["show active limit orders", "list my maker orders", "limit order status"],
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
      embeddingText: kyberEmbeddingText(
        `check active making amount for limit orders; locked makerAsset amount; allowance planning before creating order; ` +
        `total open order exposure for token; ${KYBER_LIMIT_ORDER_CHAINS}`,
      ),
      aliases: ["active making amount", "locked amount", "allowance planning", "makerAsset exposure"],
      exampleIntents: ["check allowance needed for limit order", "active making amount for USDC", "locked open order amount"],
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
      embeddingText: kyberEmbeddingText(
        `create gasless limit order on EVM chains; maker sells makerAsset for takerAsset; EIP-712 signed order; ` +
        `off-chain relay on-chain settlement; place order at target price; ${KYBER_LIMIT_ORDER_CHAINS}`,
      ),
      aliases: ["create limit order", "place limit order", "gasless order", "EIP712 order", "zlecenie limit"],
      exampleIntents: ["place limit order on polygon", "create gasless order", "sell USDC for ETH at target price"],
      preferredFor: ["create limit order", "place order", "target price trade"],
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
      embeddingText: kyberEmbeddingText(
        `gasless cancel limit order; cancel maker order without gas; EIP-712 cancel signature; ` +
        `operator stops co-signing order; cancel one order id; ${KYBER_LIMIT_ORDER_CHAINS}`,
      ),
      aliases: ["cancel order", "gasless cancel", "cancel limit order", "anuluj zlecenie"],
      exampleIntents: ["cancel my limit order", "gasless cancel order id", "cancel maker order"],
      preferredFor: ["gasless cancel", "cancel one order"],
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
      embeddingText: kyberEmbeddingText(
        `hard cancel limit order on chain; immediate cancel with gas; encode cancellation calldata; ` +
        `cancel order id through limit order contract; ${KYBER_LIMIT_ORDER_CHAINS}`,
      ),
      aliases: ["hard cancel", "on-chain cancel", "immediate cancel", "gas cancel"],
      exampleIntents: ["hard cancel order now", "cancel order on chain", "immediate limit order cancel"],
      preferredFor: ["immediate cancel", "hard cancel", "on-chain cancellation"],
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
      embeddingText: kyberEmbeddingText(
        `list supported limit order token pairs; makerAsset takerAsset pairs; available order markets on chain; ` +
        `discover fillable pair universe; ${KYBER_LIMIT_ORDER_CHAINS}`,
      ),
      aliases: ["supported pairs", "limit order pairs", "order markets", "makerAsset takerAsset"],
      exampleIntents: ["list limit order pairs", "supported order markets", "what pairs can be filled"],
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
      embeddingText: kyberEmbeddingText(
        `query open limit orders as taker; find orders to fill; orderbook sorted by best rate; ` +
        `makerAsset takerAsset filter; available making amount; ${KYBER_LIMIT_ORDER_CHAINS}`,
      ),
      aliases: ["open orders", "taker orders", "orders to fill", "best rate orderbook"],
      exampleIntents: ["find open orders to fill", "query taker orders", "limit order orderbook"],
      preferredFor: ["find fillable orders", "taker orderbook", "best rate limit orders"],
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
      embeddingText: kyberEmbeddingText(
        `fill single limit order as taker; on-chain fill execution; operator signature; takingAmount; ` +
        `thresholdAmount slippage guard; receive makerAsset; ${KYBER_LIMIT_ORDER_CHAINS}`,
      ),
      aliases: ["fill order", "take order", "taker fill", "operator signature", "threshold amount"],
      exampleIntents: ["fill limit order", "take maker order", "execute order fill on chain"],
      preferredFor: ["fill single order", "taker execution"],
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
      embeddingText: kyberEmbeddingText(
        `fill multiple limit orders in one on-chain transaction; batch fill orders; order ids; operator signatures; ` +
        `aggregate taking amount and threshold amount; ${KYBER_LIMIT_ORDER_CHAINS}`,
      ),
      aliases: ["batch fill", "fill multiple orders", "batch orders", "multi order fill"],
      exampleIntents: ["batch fill limit orders", "fill multiple orders", "execute many taker orders"],
      preferredFor: ["batch fill", "multiple order fill"],
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
      embeddingText: kyberEmbeddingText(
        `cancel all open limit orders; invalidate all maker orders by increasing nonce; on-chain cancel all transaction; ` +
        `gas required; emergency order cleanup; ${KYBER_LIMIT_ORDER_CHAINS}`,
      ),
      aliases: ["cancel all orders", "increase nonce", "invalidate orders", "emergency cancel"],
      exampleIntents: ["cancel all limit orders", "invalidate every open order", "emergency cancel all maker orders"],
      preferredFor: ["cancel all", "invalidate all orders", "emergency cleanup"],
    },
  },
];
