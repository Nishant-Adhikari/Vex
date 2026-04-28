import type { ProtocolToolManifest } from "../../types.js";
import { embeddingText } from "../../_embedding-text.js";

const SOLANA_CHAINS: readonly string[] = ["Solana"];

export const SWAP_TOOLS: readonly ProtocolToolManifest[] = [
  {
    toolId: "solana.swap.quote",
    namespace: "solana",
    lifecycle: "active",
    description: "Get swap quote — price, route, price impact, slippage. No execution.",
    mutating: false,
    params: [
      { key: "inputToken", type: "string", required: true, description: "Input token symbol or mint." },
      { key: "outputToken", type: "string", required: true, description: "Output token symbol or mint." },
      { key: "amount", type: "number", required: true, description: "Amount in human-readable units." },
      { key: "slippageBps", type: "number", description: "Slippage tolerance in basis points." },
    ],
    exampleParams: { inputToken: "SOL", outputToken: "USDC", amount: 1.0, slippageBps: 50 },
    requiresEnv: "JUPITER_API_KEY",
    discovery: {
      embeddingText: embeddingText(
        `Preview a Solana SPL token swap — get the output amount, route, price impact, and slippage before executing. ` +
        `Use this when the user wants to know the best price for a sol swap, simulate a trade, check the rate before swapping, or compare swap output. ` +
        `Example queries: how much usdc for 1 sol, preview swap on sol, best route for bonk to usdc, check rate before swapping spl, simulate solana trade. ` +
        `Read-only — does not execute.`,
      ),
      chains: SOLANA_CHAINS,
    },
  },
  {
    toolId: "solana.swap.execute",
    namespace: "solana",
    lifecycle: "active",
    description: "Execute a token swap via Jupiter Swap API V2 — routes through 400+ DEXs with MEV protection.",
    mutating: true,
    params: [
      { key: "inputToken", type: "string", required: true, description: "Input token symbol or mint." },
      { key: "outputToken", type: "string", required: true, description: "Output token symbol or mint." },
      { key: "amount", type: "number", required: true, description: "Amount in human-readable units." },
      { key: "slippageBps", type: "number", description: "Slippage tolerance in basis points." },
    ],
    exampleParams: { inputToken: "SOL", outputToken: "USDC", amount: 1.0 },
    requiresEnv: "JUPITER_API_KEY",
    discovery: {
      embeddingText: embeddingText(
        `Swap any SPL token on Solana — SOL, USDC, JUP, BONK, memecoins or any mint — using Jupiter's aggregator across 400+ DEXes with MEV protection. ` +
        `Use this when the user wants to swap on solana, buy a sol memecoin, sell an spl token, trade sol to usdc, ape into a solana coin, or get the best route on solana. ` +
        `Example queries: swap sol to usdc, buy bonk with sol, sell jup, ape into this sol memecoin, trade spl tokens, best swap on sol. ` +
        `Routes through Metis, JupiterZ RFQ, Dflow and OKX.`,
      ),
      chains: SOLANA_CHAINS,
    },
  },
];
