import type { ProtocolToolManifest } from "../../types.js";
import { embeddingText } from "../../_embedding-text.js";
import { DEXSCREENER_CHAINS } from "../discovery-text.js";

export const TRENDING_TOOLS: readonly ProtocolToolManifest[] = [
  {
    toolId: "dexscreener.profiles",
    namespace: "dexscreener",
    lifecycle: "active",
    description: "Get latest trending token profiles — icons, descriptions, social links. Shows what projects are gaining attention.",
    mutating: false,
    params: [],
    exampleParams: {},
    discovery: {
      embeddingText: embeddingText(
        `Get the latest token profiles on DEX Screener — newly listed projects with descriptions, websites, socials. ` +
        `Use this when the user wants to find newly visible tokens, browse fresh project listings, or discover what's new in the ecosystem with full descriptions and links. ` +
        `Example queries: latest token profiles, find new project listings, what just got listed, browse newest crypto projects, fresh memecoin profiles, recently visible tokens.`,
      ),
      chains: DEXSCREENER_CHAINS,
    },
  },
  {
    toolId: "dexscreener.boosts",
    namespace: "dexscreener",
    lifecycle: "active",
    description: "Get latest boosted/promoted tokens with boost amounts. Paid visibility signal — shows where money is being spent on promotion.",
    mutating: false,
    params: [],
    exampleParams: {},
    discovery: {
      embeddingText: embeddingText(
        `Get the latest tokens that received paid boosts on DEX Screener across all chains — Ethereum, Solana, BNB, Base, Arbitrum and others. ` +
        `Use this when the user wants to see who's spending on visibility, find newly promoted tokens, track marketing activity in crypto, watch for paid attention signals on memecoins, or follow recent boost flow. ` +
        `Example queries: latest boosted tokens, what's being promoted, recent paid boosts, new memecoin boosts, who's buying visibility, fresh boost activity, who's paying for promo.`,
      ),
      chains: DEXSCREENER_CHAINS,
    },
  },
  {
    toolId: "dexscreener.boosts.top",
    namespace: "dexscreener",
    lifecycle: "active",
    description: "Get tokens with most active boosts (top promoted). Ranked by total boost amount.",
    mutating: false,
    params: [],
    exampleParams: {},
    discovery: {
      embeddingText: embeddingText(
        `Tokens with the most active boosts on DEX Screener, ranked by total boost amount — heaviest paid attention spend right now. ` +
        `Use this when the user wants the top-promoted tokens, the highest paid visibility, or the most-boosted projects ordered by spend. ` +
        `Example queries: top boosted tokens, most promoted coins, highest paid visibility, biggest boost spenders, top promo tokens by amount.`,
      ),
      chains: DEXSCREENER_CHAINS,
    },
  },
  {
    toolId: "dexscreener.communityTakeovers",
    namespace: "dexscreener",
    lifecycle: "active",
    description: "Get latest community takeover (CTO) events — tokens where community reclaimed control. Strong trading signal, often precedes price action.",
    mutating: false,
    params: [],
    exampleParams: {},
    discovery: {
      embeddingText: embeddingText(
        `Get the latest community takeover (CTO) events on DEX Screener — tokens where the community has reclaimed control. ` +
        `Use this when the user wants to find CTO opportunities, track community-run memecoins, watch for takeover signals (often precedes price action), or browse renewed-attention coins. ` +
        `Example queries: latest cto events, community takeover tokens, recent ctos, community-controlled memecoins, takeover signals, community reclaimed coins.`,
      ),
      chains: DEXSCREENER_CHAINS,
    },
  },
  {
    toolId: "dexscreener.trending",
    namespace: "dexscreener",
    lifecycle: "active",
    description: "Unified trending view — merges token profiles and boosts into a single ranked list. Deduplicated, sorted by boost amount then profile presence.",
    mutating: false,
    params: [
      { key: "limit", type: "number", description: "Max results to return." },
    ],
    exampleParams: { limit: 20 },
    discovery: {
      embeddingText: embeddingText(
        `Get a unified ranked feed of trending tokens across all chains — Ethereum, Solana, BNB, Base, Arbitrum, Polygon and others — combining boosts, profiles, and other attention signals. ` +
        `Use this when the user wants to see what's hot in crypto right now market-wide, what tokens are gaining attention, what's being promoted, or what's pumping across chains. ` +
        `Example queries: what's trending in crypto, hot new tokens, top promoted coins, what's pumping right now, fresh launches getting attention, trending memecoins.`,
      ),
      chains: DEXSCREENER_CHAINS,
    },
  },
];
