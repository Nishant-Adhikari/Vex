import type { ProtocolToolManifest } from "../../types.js";
import { embeddingText } from "../../_embedding-text.js";
import { DEXSCREENER_CHAINS } from "../discovery-text.js";

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
      embeddingText: embeddingText(
        `Check whether a token has paid promotional orders on DEX Screener — type, status, payment timestamp. ` +
        `Use this when the user wants to verify if a token is being marketed, check the legitimacy or marketing history of a project, or see if money is being spent to promote a coin. ` +
        `Example queries: is this token paying for promo, marketing campaign for this coin, paid promo history for token, has this project bought ads, promo orders for this token.`,
      ),
      chains: DEXSCREENER_CHAINS,
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
      embeddingText: embeddingText(
        `Get the latest ad placements running on DEX Screener — what tokens are paying for visibility right now, ad type, duration. ` +
        `Use this when the user wants to see who is currently advertising on the platform, what new tokens are buying attention, or which projects are spending on visibility. ` +
        `Example queries: who is advertising on dexscreener, latest token ads, current promo placements, what's being marketed right now, who's spending on ads.`,
      ),
      chains: DEXSCREENER_CHAINS,
    },
  },
];
