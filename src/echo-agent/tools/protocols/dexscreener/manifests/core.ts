import type { ProtocolToolManifest } from "../../types.js";

export const CORE_TOOLS: readonly ProtocolToolManifest[] = [
  {
    toolId: "dexscreener.search",
    namespace: "dexscreener",
    lifecycle: "active",
    description: "Search DEX pairs across all chains by token name, symbol, or address. Returns price, volume, liquidity, FDV, market cap.",
    mutating: false,
    params: [
      { key: "query", type: "string", required: true, description: "Search term — token name, symbol, or contract address." },
    ],
    exampleParams: { query: "PEPE" },
    discovery: {
      embeddingText:
        "Search DEX Screener pairs by token name, ticker, symbol, contract address, meme coin, trending coin, liquidity pair, price chart. " +
        "Find tokens across ethereum, solana, bsc, base, arbitrum, polygon, avalanche, optimism and other DEX chains.",
    },
  },
  {
    toolId: "dexscreener.pairs",
    namespace: "dexscreener",
    lifecycle: "active",
    description: "Get detailed pair data by chain and pair address — price, volume, liquidity, transactions, FDV, market cap, boosts.",
    mutating: false,
    params: [
      { key: "chainId", type: "string", required: true, description: "Chain identifier (e.g. solana, ethereum, bsc, base)." },
      { key: "pairAddress", type: "string", required: true, description: "DEX pool/pair contract address." },
    ],
    exampleParams: { chainId: "ethereum", pairAddress: "0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640" },
    discovery: {
      embeddingText:
        "Get detailed DEX Screener pair analytics for a known chain and pair address. " +
        "Fetch token price, USD price, native price, volume, liquidity, buys, sells, transactions, FDV, market cap, pair age, boosts and DEX pool data.",
    },
  },
  {
    toolId: "dexscreener.tokens",
    namespace: "dexscreener",
    lifecycle: "active",
    description: "Get pair data for up to 30 tokens at once (comma-separated addresses). Useful for batch pricing and portfolio lookups.",
    mutating: false,
    params: [
      { key: "chainId", type: "string", required: true, description: "Chain identifier (e.g. solana, ethereum, bsc, base)." },
      { key: "tokenAddresses", type: "string", required: true, description: "Comma-separated token addresses (max 30)." },
    ],
    exampleParams: { chainId: "ethereum", tokenAddresses: "0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48,0xdAC17F958D2ee523a2206206994597C13D831ec7" },
    discovery: {
      embeddingText:
        "Batch lookup DEX Screener token market data by chain and up to 30 token contract addresses. " +
        "Get token prices, pairs, liquidity, volume, market cap and trading stats for portfolio pricing or token monitoring.",
    },
  },
  {
    toolId: "dexscreener.tokenPairs",
    namespace: "dexscreener",
    lifecycle: "active",
    description: "Get all DEX pools/pairs for a specific token — find best liquidity, compare across DEXes.",
    mutating: false,
    params: [
      { key: "chainId", type: "string", required: true, description: "Chain identifier (e.g. solana, ethereum, bsc, base)." },
      { key: "tokenAddress", type: "string", required: true, description: "Token contract address." },
    ],
    exampleParams: { chainId: "solana", tokenAddress: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" },
    discovery: {
      embeddingText:
        "Find all DEX pools and trading pairs for one token address on a chain. " +
        "Compare token liquidity across DEXes, pools, quote tokens, pair addresses, prices, volume and markets for best liquidity discovery.",
    },
  },
];
