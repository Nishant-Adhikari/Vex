import type { ProtocolToolManifest } from "../../types.js";
import { embeddingText } from "../../_embedding-text.js";

const SOLANA_CHAINS: readonly string[] = ["Solana"];

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
      embeddingText: embeddingText(
        `Get real-time USD prices for Solana SPL token mints — SOL, USDC, JUP, BONK, memecoins, LSTs, or any mint. ` +
        `Use this when the user wants the current price of one or more solana tokens, value their portfolio, or monitor price movements on Solana. ` +
        `Example queries: what's sol price now, current price of bonk, usd price for these spl mints, value my solana portfolio, price for this memecoin, sol token price.`,
      ),
      chains: SOLANA_CHAINS,
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
      embeddingText: embeddingText(
        `Look up a Solana SPL token by name, ticker, symbol, or mint address. ` +
        `Use this when the user names a sol coin (BONK, JUP, that new memecoin) and you need the mint address, decimals, or verification status before swapping. ` +
        `Example queries: find bonk on solana, what's the mint for jup, lookup this spl token, search sol token, resolve sol ticker, find sol contract. ` +
        `Returns metadata, organic score, holders, market cap, liquidity.`,
      ),
      chains: SOLANA_CHAINS,
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
      embeddingText: embeddingText(
        `Find trending and popular tokens on Solana — top traded SPL tokens, top trending memes, recently launched solana tokens, popular liquid staking tokens (LSTs), or verified tokens with the most attention. ` +
        `Use this when the user wants to see what's pumping on sol, what's hot on solana, top sol memes, new solana launches, or popular spl tokens. ` +
        `Example queries: trending tokens on solana, what's hot on sol right now, top sol memes, new solana launches, popular spl tokens, top traded sol coins. ` +
        `Filter by 5m, 1h, 6h, 24h windows.`,
      ),
      chains: SOLANA_CHAINS,
    },
  },
];
