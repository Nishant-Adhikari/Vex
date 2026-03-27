import type { ProtocolToolManifest } from "../../../types.js";

export const SWAP_TOOLS: readonly ProtocolToolManifest[] = [
  {
    toolId: "jaine.swap.quote",
    namespace: "jaine",
    lifecycle: "active",
    description: "Get best swap route on Jaine DEX with on-chain quote. Returns route path, expected output, and price. Read-only, no execution.",
    mutating: false,
    params: [
      { key: "tokenIn", type: "string", required: true, description: "Input token — symbol (e.g. USDC, w0G) or address." },
      { key: "tokenOut", type: "string", required: true, description: "Output token — symbol or address." },
      { key: "amountIn", type: "string", required: true, description: "Input amount in human-readable units." },
      { key: "maxHops", type: "number", description: "Max routing hops (default: 3)." },
    ],
    exampleParams: { tokenIn: "USDC", tokenOut: "w0G", amountIn: "100" },
  },
  {
    toolId: "jaine.swap.sell",
    namespace: "jaine",
    lifecycle: "active",
    description: "Execute a token swap on Jaine DEX (0G Network). Routes through multi-hop paths, handles approvals automatically.",
    mutating: true,
    params: [
      { key: "tokenIn", type: "string", required: true, description: "Input token — symbol (e.g. USDC, w0G) or address." },
      { key: "tokenOut", type: "string", required: true, description: "Output token — symbol or address." },
      { key: "amountIn", type: "string", required: true, description: "Input amount in human-readable units." },
      { key: "slippageBps", type: "number", description: "Slippage tolerance in basis points (default: 50 = 0.5%)." },
      { key: "maxHops", type: "number", description: "Max routing hops (default: 3)." },
      { key: "dryRun", type: "boolean", description: "Preview route and quote without executing." },
    ],
    exampleParams: { tokenIn: "USDC", tokenOut: "w0G", amountIn: "100", slippageBps: 50 },
  },
];
