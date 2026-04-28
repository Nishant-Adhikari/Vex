import type { ProtocolToolManifest } from "../../types.js";
import { embeddingText } from "../../_embedding-text.js";
import { KYBER_SWAP_CHAINS } from "../discovery-text.js";

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
      embeddingText: embeddingText(
        `Preview a token swap on Ethereum, Base, Arbitrum, BNB Chain, Polygon, Optimism, Avalanche and other EVM chains — get the output amount, route, gas cost, price impact, and slippage before executing. ` +
        `Use this when the user wants to know the best price, check the rate before swapping, simulate a trade, or compare what they'd get for a swap. ` +
        `Example queries: how much usdc do I get for 1 eth on base, best price for swap, preview trade, what would I get for selling pepe, check the rate on bnb. ` +
        `Read-only — does not execute.`,
      ),
      aliases: ["swap quote", "route preview", "best route", "price impact", "slippage preview", "RFQ liquidity"],
      exampleIntents: ["quote swap on bnb", "best route USDC to ETH on base", "preview token swap"],
      preferredFor: ["swap quote", "route preview", "read only swap", "price impact"],
      chains: KYBER_SWAP_CHAINS,
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
      embeddingText: embeddingText(
        `Sell a token on Ethereum, Base, Arbitrum, BNB Chain, Polygon, Optimism, Avalanche and other EVM chains — routes through 400+ DEXes for the best price. ` +
        `Use this when the user wants to sell a coin, dump a holding, exit a position, swap out of a token, get out of a memecoin, or trade one token for another with the input fixed. ` +
        `Example queries: sell eth for usdc on base, swap pepe to usdc, dump my doge, exit my shitcoin position, swap out of bnb, get rid of this token.`,
      ),
      aliases: ["sell token", "swap out", "exit position", "reduce position"],
      exampleIntents: ["sell ETH for USDC on arbitrum", "swap token on bnb", "exit token position on base"],
      preferredFor: ["sell token", "exit position", "reduce position", "exact input swap"],
      chains: KYBER_SWAP_CHAINS,
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
      embeddingText: embeddingText(
        `Buy a token on Ethereum, Base, Arbitrum, BNB Chain, Polygon and other EVM chains using stablecoins or another asset as input — routes through 400+ DEXes for the best price. ` +
        `Use this when the user wants to buy a coin, ape into a memecoin, get into a position, acquire a token, swap stables into something, or open a spot position. ` +
        `Example queries: buy eth with usdc on base, ape into pepe, get me bnb, buy this memecoin with usdt, open a spot position in arb, acquire some link.`,
      ),
      aliases: ["buy token", "acquire token", "swap into token"],
      exampleIntents: ["buy ETH with USDC on base", "buy token on bnb", "swap stablecoin into token"],
      preferredFor: ["buy token", "acquire token", "open spot position", "exact input swap"],
      chains: KYBER_SWAP_CHAINS,
    },
  },
];
