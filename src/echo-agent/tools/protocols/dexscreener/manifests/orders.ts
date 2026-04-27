import type { ProtocolToolManifest } from "../../types.js";

export const ORDERS_TOOLS: readonly ProtocolToolManifest[] = [
  {
    toolId: "dexscreener.orders",
    namespace: "dexscreener",
    lifecycle: "active",
    description: "Check paid promotional orders for a token — type, status, payment timestamp. Legitimacy verification signal.",
    mutating: false,
    params: [
      { key: "chainId", type: "string", required: true, description: "Chain identifier (e.g. solana, ethereum, bsc, base)." },
      { key: "tokenAddress", type: "string", required: true, description: "Token contract address." },
    ],
    exampleParams: { chainId: "solana", tokenAddress: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" },
    discovery: {
      embeddingText:
        "Check DEX Screener paid token orders for a chain and token address. " +
        "Verify token promotion orders, ad payments, boost order status, payment timestamp, marketing legitimacy and campaign history.",
    },
  },
  {
    toolId: "dexscreener.ads",
    namespace: "dexscreener",
    lifecycle: "active",
    description: "Get latest DexScreener ad placements — type, duration, impressions. Monitor promotional activity across the platform.",
    mutating: false,
    params: [],
    exampleParams: {},
    discovery: {
      embeddingText:
        "Get latest DEX Screener ad placements. Monitor token advertisements, promoted campaigns, ad type, duration, impressions, paid visibility and platform-wide marketing activity.",
    },
  },
];
