import type { ProtocolToolManifest } from "../../types.js";
import { KYBER_SWAP_CHAINS, kyberEmbeddingText } from "../discovery-text.js";

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
      embeddingText: kyberEmbeddingText(
        `search EVM token by symbol name or address; find ERC20 token metadata; token decimals; verified or whitelisted token; ` +
        `token resolver before swap or limit order; USDC ETH WETH native token; ${KYBER_SWAP_CHAINS}`,
      ),
      aliases: ["token search", "find token", "token resolver", "ERC20 metadata", "whitelisted token"],
      exampleIntents: ["find USDC address on base", "search token before swap", "resolve ERC20 symbol"],
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
      embeddingText: kyberEmbeddingText(
        `check token safety before trading; honeypot check; fee on transfer check; FOT tax token detection; ` +
        `scam token risk; ERC20 safety on EVM chains; ${KYBER_SWAP_CHAINS}`,
      ),
      aliases: ["honeypot", "fee on transfer", "FOT", "token tax", "token safety", "scam token"],
      exampleIntents: ["check if token is honeypot", "fee on transfer tax check", "is this token safe to trade"],
    },
  },
];
