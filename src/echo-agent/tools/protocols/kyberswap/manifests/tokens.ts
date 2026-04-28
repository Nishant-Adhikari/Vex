import type { ProtocolToolManifest } from "../../types.js";
import { embeddingText } from "../../_embedding-text.js";
import { KYBER_SWAP_CHAINS } from "../discovery-text.js";

export const TOKENS_TOOLS: readonly ProtocolToolManifest[] = [
  {
    toolId: "kyberswap.tokens.search",
    namespace: "kyberswap",
    lifecycle: "active",
    description: "Search EVM tokens by name/symbol across KyberSwap-supported chains. Returns address, decimals, marketCap, verification status.",
    mutating: false,
    params: [
      { key: "chain", type: "string", required: true, description: "Chain slug or alias (e.g. ethereum, arb, base)." },
      { key: "query", type: "string", description: "Token name or symbol to search." },
      { key: "whitelisted", type: "boolean", description: "Only return whitelisted tokens." },
      { key: "limit", type: "number", description: "Max results." },
    ],
    exampleParams: { chain: "ethereum", query: "USDC", whitelisted: true },
    discovery: {
      embeddingText: embeddingText(
        `Look up an EVM token by name, symbol, or address on a specific chain — get the contract address, decimals, market cap, and whether it's verified. ` +
        `Use this when the user names a token by ticker (USDC, ETH, PEPE, that BONK on base) and you need the exact contract before swapping or placing an order. ` +
        `Example queries: find usdc address on base, lookup pepe on arbitrum, what's the contract for shib, search token on bnb chain, resolve this ticker on optimism. ` +
        `Run this before any KyberSwap swap or limit order.`,
      ),
      aliases: ["token search", "find token", "token resolver", "ERC20 metadata", "whitelisted token"],
      exampleIntents: ["find USDC address on base", "search token before swap", "resolve ERC20 symbol"],
      chains: KYBER_SWAP_CHAINS,
    },
  },
  {
    toolId: "kyberswap.tokens.check",
    namespace: "kyberswap",
    lifecycle: "active",
    description: "Check if a token is a honeypot or has fee-on-transfer tax. Essential safety check before trading.",
    mutating: false,
    params: [
      { key: "chain", type: "string", required: true, description: "Chain slug or alias." },
      { key: "address", type: "string", required: true, description: "Token contract address." },
    ],
    exampleParams: { chain: "ethereum", address: "0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48" },
    discovery: {
      embeddingText: embeddingText(
        `Check whether an EVM token is a honeypot or has a fee-on-transfer tax before trading it. ` +
        `Use this when the user wants a safety check on a token, asks if a coin is a scam, suspects fee-on-transfer behavior, or wants to verify a memecoin before aping in. ` +
        `Example queries: is this token a honeypot, check fee on transfer for pepe, is this coin safe, scam check this token, fot tax on this contract, can I trade this safely. ` +
        `Critical safety check for unknown or new tokens.`,
      ),
      aliases: ["honeypot", "fee on transfer", "FOT", "token tax", "token safety", "scam token"],
      exampleIntents: ["check if token is honeypot", "fee on transfer tax check", "is this token safe to trade"],
      chains: KYBER_SWAP_CHAINS,
    },
  },
];
