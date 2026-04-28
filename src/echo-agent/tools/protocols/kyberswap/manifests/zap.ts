import type { ProtocolToolManifest } from "../../types.js";
import { embeddingText } from "../../_embedding-text.js";
import { KYBER_ZAP_CHAINS } from "../discovery-text.js";

export const ZAP_TOOLS: readonly ProtocolToolManifest[] = [
  {
    toolId: "kyberswap.zap.in",
    namespace: "kyberswap",
    lifecycle: "active",
    description: "Add liquidity to a concentrated LP position via one-click zap. Handles routing, swaps, and position creation. Resolve tokenIn via khalani.tokens.search. Find pool address via dexscreener.tokenPairs. Use DEX_* IDs for dex param (query kyberswap.zap.list for options).",
    mutating: true,
    params: [
      { key: "chain", type: "string", required: true, description: "Chain slug or alias." },
      { key: "dex", type: "string", required: true, description: "DEX identifier — use official KyberSwap ZaaS DEX_* IDs (e.g. DEX_UNISWAPV3, DEX_QUICKSWAPV3ALGEBRA, DEX_PANCAKESWAPV3). Query kyberswap.zap.list for supported DEXes per chain." },
      { key: "pool", type: "string", required: true, description: "Pool contract address." },
      { key: "tokenIn", type: "string", required: true, description: "Input token address." },
      { key: "amountIn", type: "string", required: true, description: "Input amount in atomic units." },
      { key: "tickLower", type: "number", description: "Lower tick for new position." },
      { key: "tickUpper", type: "number", description: "Upper tick for new position." },
      { key: "positionRef", type: "string", description: "Position reference as expected by ZaaS API — NFT token ID for concentrated liquidity DEXes, wallet owner address for V2-like DEXes, ERC-1155 bin token ID for PancakeBin. Omit for new position." },
      { key: "slippageBps", type: "number", description: "Slippage tolerance in basis points." },
      { key: "approveExact", type: "boolean", description: "Approve exact amount instead of max." },
      { key: "dryRun", type: "boolean", description: "Preview route without executing." },
    ],
    exampleParams: { chain: "ethereum", dex: "DEX_UNISWAPV3", pool: "0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640", tokenIn: "0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", amountIn: "1000000000", slippageBps: 100 },
    discovery: {
      embeddingText: embeddingText(
        `Add liquidity to a Uniswap V3, PancakeSwap V3, Aerodrome, QuickSwap or Kodiak pool on Ethereum, Base, Arbitrum, Polygon, BNB Chain and other EVM chains — supply just one token, the rest is handled. ` +
        `Use this when the user wants to provide liquidity, become an LP, open a liquidity position, earn fees from a pool, zap into LP with one asset, or LP into a concentrated range. ` +
        `Example queries: add liquidity to usdc/eth on base, become lp on uniswap, zap into pool, provide liquidity with just usdc, open lp position, lp on arbitrum.`,
      ),
      aliases: ["zap in", "add liquidity", "LP position", "provide liquidity"],
      exampleIntents: ["add liquidity with one token", "zap into LP on base", "create concentrated liquidity position"],
      preferredFor: ["add liquidity", "zap in", "create LP position", "increase LP position"],
      chains: KYBER_ZAP_CHAINS,
    },
  },
  {
    toolId: "kyberswap.zap.out",
    namespace: "kyberswap",
    lifecycle: "active",
    description: "Remove liquidity from a concentrated LP position — converts to a single output token. Resolve tokenOut via khalani.tokens.search.",
    mutating: true,
    params: [
      { key: "chain", type: "string", required: true, description: "Chain slug or alias." },
      { key: "dex", type: "string", required: true, description: "DEX identifier — use official KyberSwap ZaaS DEX_* IDs. Query kyberswap.zap.list for options." },
      { key: "pool", type: "string", required: true, description: "Pool contract address." },
      { key: "positionRef", type: "string", required: true, description: "Position reference — NFT token ID for CL DEXes, wallet address for V2-like, ERC-1155 token ID for PancakeBin." },
      { key: "tokenOut", type: "string", required: true, description: "Output token address." },
      { key: "liquidity", type: "string", description: "Liquidity amount to remove (omit for full)." },
      { key: "collectFee", type: "boolean", description: "Collect accumulated LP fees during exit (default: true)." },
      { key: "slippageBps", type: "number", description: "Slippage tolerance in basis points." },
      { key: "dryRun", type: "boolean", description: "Preview route without executing." },
    ],
    exampleParams: { chain: "ethereum", dex: "DEX_UNISWAPV3", pool: "0x88e6...", positionRef: "12345", tokenOut: "0xA0b8..." },
    discovery: {
      embeddingText: embeddingText(
        `Remove liquidity from an LP position on Ethereum, Base, Arbitrum and other EVM chains — convert the LP back to one chosen output token in one click. ` +
        `Use this when the user wants to exit an LP position, close their liquidity, withdraw to a single token, collect LP fees, or get out of a pool. ` +
        `Example queries: remove liquidity to usdc on base, exit my lp position, withdraw from pool, close my lp, take fees and exit, get out of uniswap pool.`,
      ),
      aliases: ["zap out", "remove liquidity", "withdraw LP", "collect fees"],
      exampleIntents: ["remove liquidity to USDC", "zap out LP position", "withdraw concentrated liquidity"],
      preferredFor: ["remove liquidity", "zap out", "close LP position", "withdraw LP"],
      chains: KYBER_ZAP_CHAINS,
    },
  },
  {
    toolId: "kyberswap.zap.migrate",
    namespace: "kyberswap",
    lifecycle: "active",
    description: "Migrate LP position between pools or DEXes in a single transaction.",
    mutating: true,
    params: [
      { key: "chain", type: "string", required: true, description: "Chain slug or alias." },
      { key: "dexFrom", type: "string", required: true, description: "Source DEX — use official DEX_* IDs." },
      { key: "dexTo", type: "string", required: true, description: "Destination DEX — use official DEX_* IDs." },
      { key: "poolFrom", type: "string", required: true, description: "Source pool address." },
      { key: "poolTo", type: "string", required: true, description: "Destination pool address." },
      { key: "sourcePositionRef", type: "string", required: true, description: "Source position reference — NFT token ID for CL DEXes, wallet address for V2-like, ERC-1155 token ID for PancakeBin." },
      { key: "tickLower", type: "number", description: "Lower tick for destination position." },
      { key: "tickUpper", type: "number", description: "Upper tick for destination position." },
      { key: "liquidity", type: "string", description: "Liquidity to migrate (omit for full)." },
      { key: "collectFee", type: "boolean", description: "Collect accumulated LP fees during migration (default: true)." },
      { key: "slippageBps", type: "number", description: "Slippage tolerance in basis points." },
      { key: "dryRun", type: "boolean", description: "Preview route without executing." },
    ],
    exampleParams: { chain: "ethereum", dexFrom: "DEX_UNISWAPV3", dexTo: "DEX_PANCAKESWAPV3", poolFrom: "0xaaa...", poolTo: "0xbbb...", sourcePositionRef: "12345" },
    discovery: {
      embeddingText: embeddingText(
        `Migrate an LP position from one pool or DEX to another in a single transaction on EVM chains. ` +
        `Use this when the user wants to move their LP between pools, switch DEXes, rebalance into a new range, or follow liquidity from one venue to another. ` +
        `Example queries: move my lp from uniswap to pancake, migrate position to another pool, switch dex for my lp, rebalance my concentrated range, change pool for my liquidity.`,
      ),
      aliases: ["zap migrate", "migrate LP", "move liquidity", "rebalance liquidity"],
      exampleIntents: ["migrate LP to another pool", "move liquidity position", "rebalance concentrated liquidity"],
      preferredFor: ["migrate liquidity", "move LP", "rebalance LP position"],
      chains: KYBER_ZAP_CHAINS,
    },
  },
  {
    toolId: "kyberswap.zap.list",
    namespace: "kyberswap",
    lifecycle: "active",
    description: "List supported ZaaS DEX protocols on a chain for zap-in/out/migrate. Returns official DEX_* IDs that can be passed directly to zap tools.",
    mutating: false,
    params: [
      { key: "chain", type: "string", required: true, description: "Chain slug or alias (e.g. polygon, ethereum, base, arbitrum)." },
    ],
    exampleParams: { chain: "polygon" },
    discovery: {
      embeddingText: embeddingText(
        `List which DEX protocols support zap-in, zap-out, or zap-migrate on a given EVM chain — Uniswap V3, PancakeSwap V3, Aerodrome, QuickSwap, Kodiak, and others. ` +
        `Use this when the user wants to know which DEXes the zap tools work with on a chain, what protocols support one-click LP, or which liquidity venues are available before zapping in. ` +
        `Example queries: what dexes can I zap into on polygon, list zap protocols on base, supported lp dexes on arbitrum, where can I add liquidity with kyber zap.`,
      ),
      aliases: ["zap dex list", "DEX ids", "supported zap protocols", "ZaaS dexes"],
      exampleIntents: ["list zap DEX ids", "what DEX ids can I use for zap", "supported liquidity protocols"],
      chains: KYBER_ZAP_CHAINS,
    },
  },
];
