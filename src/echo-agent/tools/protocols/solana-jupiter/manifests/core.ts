import type { ProtocolToolManifest } from "../../types.js";

export const CORE_TOOLS: readonly ProtocolToolManifest[] = [
  {
    toolId: "solana.prices",
    namespace: "solana",
    lifecycle: "active",
    description: "Get real-time USD prices for one or more token mints.",
    mutating: false,
    params: [
      { key: "mints", type: "string", required: true, description: "Comma-separated mint addresses." },
    ],
    exampleParams: { mints: "So11111111111111111111111111111111111111112" },
    requiresEnv: "JUPITER_API_KEY",
    discovery: {
      embeddingText: "Get real-time USD prices for Solana SPL token mint addresses with Jupiter Price API V3. Price lookup for portfolio valuation, token monitoring, SOL, USDC, JUP, meme coins, LST assets and any Solana mint.",
    },
  },
  {
    toolId: "solana.tokens.search",
    namespace: "solana",
    lifecycle: "active",
    description: "Search Solana tokens by name or symbol via Jupiter.",
    mutating: false,
    params: [
      { key: "query", type: "string", required: true, description: "Token name, symbol, or mint address." },
    ],
    exampleParams: { query: "BONK" },
    requiresEnv: "JUPITER_API_KEY",
    discovery: {
      embeddingText: "Search Solana SPL tokens by name, ticker, symbol or mint address with Jupiter Tokens API V2. Find token metadata, decimals, icon, verification status, organic score, holders, market cap, liquidity and trading stats.",
    },
  },
  {
    toolId: "solana.tokens.trending",
    namespace: "solana",
    lifecycle: "active",
    description: "Get trending Solana tokens — top traded, top organic, recent, LST, verified.",
    mutating: false,
    params: [
      { key: "category", type: "string", description: "Category: toptrending, toptraded, toporganicscore, recent, lst, verified." },
      { key: "interval", type: "string", description: "Time interval: 5m, 1h, 6h, 24h." },
      { key: "limit", type: "number", description: "Max results (default 20)." },
    ],
    exampleParams: { category: "toptrending", interval: "1h", limit: 10 },
    requiresEnv: "JUPITER_API_KEY",
    discovery: {
      embeddingText: "Discover trending Solana tokens with Jupiter token categories: top trending, top traded, top organic score, recent new tokens, LST tokens and verified tokens. Find popular SPL tokens, meme coins and market movers by 5m, 1h, 6h or 24h interval.",
    },
  },
];
