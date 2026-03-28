import type { ProtocolToolManifest } from "../../types.js";

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
  },
  {
    toolId: "kyberswap.swap.sell",
    namespace: "kyberswap",
    lifecycle: "active",
    description: "Sell tokens via KyberSwap — spend amountIn of tokenIn to receive tokenOut. Routes through 400+ DEXs on 18 EVM chains.",
    mutating: true,
    params: SWAP_EXECUTION_PARAMS,
    exampleParams: { chain: "base", tokenIn: "ETH", tokenOut: "USDC", amountIn: "0.5", slippageBps: 50 },
  },
  {
    toolId: "kyberswap.swap.buy",
    namespace: "kyberswap",
    lifecycle: "active",
    description: "Buy tokens via KyberSwap — spend amountIn of tokenIn to buy tokenOut. Same execution as sell, but explicitly marks trade as a buy for portfolio tracking.",
    mutating: true,
    params: SWAP_EXECUTION_PARAMS,
    exampleParams: { chain: "base", tokenIn: "USDC", tokenOut: "ETH", amountIn: "100", slippageBps: 50 },
  },
];
