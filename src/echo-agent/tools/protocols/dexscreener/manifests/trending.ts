import type { ProtocolToolManifest } from "../../types.js";

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
      embeddingText:
        "Get latest DEX Screener token profiles. Discover newly listed or recently visible token projects with profile page, icon, header, description, websites, socials and links. " +
        "Useful for new token discovery.",
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
      embeddingText:
        "Get latest boosted tokens on DEX Screener. Find newly promoted tokens, paid boosts, boost amount, campaign visibility, token marketing activity and recently boosted meme coins or launches.",
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
      embeddingText:
        "Get top boosted tokens on DEX Screener ranked by active or total boost amount. " +
        "Find most promoted tokens, strongest paid visibility, marketing spend, trending boosted coins and high attention projects.",
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
      embeddingText:
        "Get latest DEX Screener community takeover tokens. Find CTO events, community reclaimed tokens, community-run meme coins, takeover signals, claim dates and tokens with renewed social attention.",
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
      embeddingText:
        "Get unified DEX Screener trending discovery. Find trending tokens, boosted tokens, token profiles, promoted coins, meme coins, new launches and attention signals in one ranked deduplicated feed.",
    },
  },
];
