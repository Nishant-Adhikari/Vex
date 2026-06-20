import type { ProtocolToolManifest } from "../../types.js";
import { SOLANA_CORE_DISCOVERY } from "../../embeddings/solana-jupiter/core.js";

export const CORE_TOOLS: readonly ProtocolToolManifest[] = [
  {
    toolId: "solana.prices",
    namespace: "solana",
    lifecycle: "active",
    description: "Get real-time USD prices for one or more token mints.",
    mutating: false,
    actionKind: "read",
    params: [
      { key: "mints", type: "string", required: true, description: "Comma-separated mint addresses." },
    ],
    exampleParams: { mints: "So11111111111111111111111111111111111111112" },
    requiresEnv: "JUPITER_API_KEY",
    discovery: SOLANA_CORE_DISCOVERY["solana.prices"],
  },
  {
    toolId: "solana.tokens.search",
    namespace: "solana",
    lifecycle: "active",
    description: "Search Solana tokens by name or symbol via Jupiter.",
    mutating: false,
    actionKind: "read",
    params: [
      { key: "query", type: "string", required: true, description: "Token name, symbol, or mint address." },
    ],
    exampleParams: { query: "BONK" },
    requiresEnv: "JUPITER_API_KEY",
    discovery: SOLANA_CORE_DISCOVERY["solana.tokens.search"],
  },
  {
    toolId: "solana.tokens.trending",
    namespace: "solana",
    lifecycle: "active",
    description: "Discover Solana tokens — freshly launched/new (recent), trending, top-traded, top-organic, or verified. Solana's primary token-discovery feed: richer signal (organic score, verification, holder data) than generic feeds for finding new/fresh tokens.",
    mutating: false,
    actionKind: "read",
    params: [
      { key: "category", type: "string", description: "Category: recent (freshly launched / newly listed tokens by first pool creation — use for brand-new/fresh tokens), toptrending (most price movement), toptraded (highest volume), toporganicscore (highest real/organic activity), verified (Jupiter-verified), lst (liquid staking)." },
      { key: "interval", type: "string", description: "Time interval: 5m, 1h, 6h, 24h." },
      { key: "limit", type: "number", description: "Max results (default 20)." },
    ],
    exampleParams: { category: "toptrending", interval: "1h", limit: 10 },
    requiresEnv: "JUPITER_API_KEY",
    discovery: SOLANA_CORE_DISCOVERY["solana.tokens.trending"],
  },
];
