import type { ProtocolToolManifest } from "../../types.js";
import { embeddingText } from "../../_embedding-text.js";
import { DEXSCREENER_CHAINS } from "../discovery-text.js";

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
      embeddingText: embeddingText(
        `Search trading pairs and tokens by name, symbol, or contract address across every chain — Ethereum, Solana, BNB, Base, Arbitrum, Polygon, Avalanche and others. ` +
        `Use this when the user names a coin or pair (PEPE, BONK, SHIB, that new memecoin) and wants to find it without specifying a chain, or wants to compare pairs across chains. ` +
        `Example queries: find pepe pair, search bonk, lookup this contract, where is shib trading, find a token across chains, search dex pairs.`,
      ),
      chains: DEXSCREENER_CHAINS,
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
      embeddingText: embeddingText(
        `Full analytics for one specific DEX trading pair by pool address — price, volume, liquidity, buys and sells, transactions, FDV, market cap, pair age, boosts. ` +
        `Use this when the user has a specific pool address and wants the deep stats, market metrics, or recent activity on that single pair. ` +
        `Example queries: pair details for this pool, give me stats for this pair on base, volume and liquidity for this dex pair, full analytics for this pool, single pool stats.`,
      ),
      chains: DEXSCREENER_CHAINS,
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
      embeddingText: embeddingText(
        `Get DEX market data for up to 30 token contract addresses at once on a chain — prices, pairs, liquidity, volume, market cap. ` +
        `Use this when the user has a portfolio of tokens and wants batch pricing, monitoring multiple coins at once, or comparing several tokens on one chain. ` +
        `Example queries: batch lookup these tokens, prices for my portfolio coins, market data for these contracts, compare these tokens on base, batch token stats.`,
      ),
      chains: DEXSCREENER_CHAINS,
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
      embeddingText: embeddingText(
        `Find every pool and trading pair for a single token across all DEXes on a chain. ` +
        `Use this when the user wants to compare where a token has the most liquidity, find the best pool to trade in, see all markets for a coin, or pick which DEX has the deepest liquidity for a token. ` +
        `Example queries: find best pool for pepe on solana, where is most liquidity for this coin, all pools for usdc on base, compare dexes for this token, deepest pool for sol/usdc, best market for this memecoin.`,
      ),
      chains: DEXSCREENER_CHAINS,
    },
  },
];
