import type { ProtocolToolManifest } from "../../types.js";
import { KYBER_SWAP_CHAINS, kyberEmbeddingText } from "../discovery-text.js";

const SWAP_EXECUTION_PARAMS = [
  { key: "chain", type: "string" as const, required: true, description: "Chain slug or alias." },
  { key: "tokenIn", type: "string" as const, required: true, description: "Input token address or symbol." },
  { key: "tokenOut", type: "string" as const, required: true, description: "Output token address or symbol." },
  { key: "amountIn", type: "string" as const, required: true, description: "Amount in human-readable units." },
  { key: "slippageBps", type: "number" as const, description: "Slippage tolerance in basis points (default: 50 = 0.5%)." },
  { key: "recipient", type: "string" as const, description: "Recipient address (default: sender)." },
  { key: "approveExact", type: "boolean" as const, description: "Approve exact amount instead of max." },
  { key: "dryRun", type: "boolean" as const, description: "Preview without executing." },
];

export const SWAP_TOOLS: readonly ProtocolToolManifest[] = [
  {
    toolId: "kyberswap.swap.quote",
    namespace: "kyberswap",
    lifecycle: "active",
    description: "Get best swap route across 400+ DEXs — price, route, gas estimate, price impact. Read-only, no execution.",
    mutating: false,
    params: [
      { key: "chain", type: "string", required: true, description: "Chain slug or alias." },
      { key: "tokenIn", type: "string", required: true, description: "Input token address or symbol." },
      { key: "tokenOut", type: "string", required: true, description: "Output token address or symbol." },
      { key: "amountIn", type: "string", required: true, description: "Amount in human-readable units." },
    ],
    exampleParams: { chain: "ethereum", tokenIn: "ETH", tokenOut: "USDC", amountIn: "1.0" },
    discovery: {
      embeddingText: kyberEmbeddingText(
        `swap token on EVM chains; get best KyberSwap Aggregator route; quote tokenIn to tokenOut; RFQ liquidity; ` +
        `gas estimate; price impact; slippage preview; read only route preview; ${KYBER_SWAP_CHAINS}`,
      ),
      aliases: ["swap quote", "route preview", "best route", "price impact", "slippage preview", "RFQ liquidity"],
      exampleIntents: ["quote swap on bnb", "best route USDC to ETH on base", "preview token swap"],
      preferredFor: ["swap quote", "route preview", "read only swap", "price impact"],
    },
  },
  {
    toolId: "kyberswap.swap.sell",
    namespace: "kyberswap",
    lifecycle: "active",
    description: "Sell tokens via KyberSwap — exact-input swap: spend amountIn of tokenIn to receive tokenOut. Use when reducing/exiting a position. Routes through 400+ DEXs on 18 EVM chains. Resolve token addresses via khalani.tokens.search first.",
    mutating: true,
    params: SWAP_EXECUTION_PARAMS,
    exampleParams: { chain: "base", tokenIn: "ETH", tokenOut: "USDC", amountIn: "0.5", slippageBps: 50 },
    discovery: {
      embeddingText: kyberEmbeddingText(
        `swap token on EVM chains; sell token exact input; spend tokenIn amountIn to receive tokenOut; ` +
        `exit or reduce position; execute KyberSwap router transaction; approval and slippage; ${KYBER_SWAP_CHAINS}`,
      ),
      aliases: ["sell token", "swap out", "exit position", "reduce position", "sprzedaj", "wymień", "swapnij"],
      exampleIntents: ["sell ETH for USDC on arbitrum", "swap token on bnb", "exit token position on base"],
      preferredFor: ["sell token", "exit position", "reduce position", "exact input swap"],
    },
  },
  {
    toolId: "kyberswap.swap.buy",
    namespace: "kyberswap",
    lifecycle: "active",
    description: "Buy tokens via KyberSwap — exact-input swap: spend amountIn of tokenIn to acquire tokenOut. Same routing as sell, but marks trade as a buy for portfolio tracking (lot opens on tokenOut side). Resolve token addresses via khalani.tokens.search first.",
    mutating: true,
    params: SWAP_EXECUTION_PARAMS,
    exampleParams: { chain: "base", tokenIn: "USDC", tokenOut: "ETH", amountIn: "100", slippageBps: 50 },
    discovery: {
      embeddingText: kyberEmbeddingText(
        `swap token on EVM chains; buy token intent; acquire tokenOut with tokenIn; spend USDC ETH WETH or stablecoin to buy asset; ` +
        `exact input swap; execute KyberSwap router transaction; ${KYBER_SWAP_CHAINS}`,
      ),
      aliases: ["buy token", "acquire token", "swap into token", "kup", "wymień", "swapnij"],
      exampleIntents: ["buy ETH with USDC on base", "buy token on bnb", "swap stablecoin into token"],
      preferredFor: ["buy token", "acquire token", "open spot position", "exact input swap"],
    },
  },
];
