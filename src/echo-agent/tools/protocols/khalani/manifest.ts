/**
 * Khalani protocol tool manifests — 9 tools (8 read + 1 mutating).
 *
 * Each manifest declares what the tool does, what params it takes,
 * and whether it mutates state. The runtime uses this for discovery
 * and parameter validation before calling handlers.
 */

import type { ProtocolToolManifest } from "../types.js";

const KHALANI_CHAINS =
  "Abstract, Arbitrum, Avalanche, Base, Berachain, Blast, BNB Chain, BSC, BOB, Cronos, Ethereum, " +
  "Flow, Gnosis, HyperEVM, Injective, Jovay, Ink, Katana, Lens, Linea, Lisk, Mantle, Mode, Monad, " +
  "Neon, Optimism, Plasma, Polygon, Redstone, Scroll, Sei, Solana, Soneium, Sonic, Sophon, Story, " +
  "Tron, Unichain, World Chain, Zero Gravity, 0G, Zilliqa, zkSync, Zora";

function khalaniEmbeddingText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export const KHALANI_TOOLS: readonly ProtocolToolManifest[] = [
  {
    toolId: "khalani.chains.list",
    namespace: "khalani",
    lifecycle: "active",
    description: "List all Khalani-supported chains with metadata (40+ chains, EVM + Solana).",
    mutating: false,
    params: [
      { key: "refresh", type: "boolean", description: "Force refresh chain cache." },
    ],
    exampleParams: {},
    discovery: {
      embeddingText: khalaniEmbeddingText(
        `list Khalani supported chains; cross-chain network registry; EVM and Solana chain metadata; ` +
        `chain ids and aliases; native currency; bridge-supported blockchains; supported routes universe; ${KHALANI_CHAINS}`,
      ),
    },
  },
  {
    toolId: "khalani.tokens.top",
    namespace: "khalani",
    lifecycle: "active",
    description: "List top Khalani tokens, optionally filtered by chain IDs.",
    mutating: false,
    params: [
      { key: "chainIds", type: "string", description: "Comma-separated chain IDs or aliases (e.g. '1,solana')." },
    ],
    exampleParams: { chainIds: "1,solana" },
    discovery: {
      embeddingText: khalaniEmbeddingText(
        `list top tokens on Khalani supported chains; popular bridge assets; token discovery by chainIds; ` +
        `top ERC20 and Solana tokens; stablecoins native tokens major assets; USDC ETH SOL WETH USDT; ${KHALANI_CHAINS}`,
      ),
    },
  },
  {
    toolId: "khalani.tokens.search",
    namespace: "khalani",
    lifecycle: "active",
    description: "Search Khalani tokens by symbol, name, or address. This is the canonical cross-chain token resolver — use before any EVM mutation to get exact contract addresses.",
    mutating: false,
    params: [
      { key: "query", type: "string", required: true, description: "Search phrase or token address." },
      { key: "chainIds", type: "string", description: "Comma-separated chain IDs or aliases." },
    ],
    exampleParams: { query: "USDC", chainIds: "1,8453" },
    discovery: {
      embeddingText: khalaniEmbeddingText(
        `search token by symbol name or address across chains; canonical cross-chain token resolver; ` +
        `find source token and destination token contract address before bridge quote or bridge execution; ` +
        `resolve USDC ETH SOL WETH USDT on EVM and Solana; ${KHALANI_CHAINS}`,
      ),
    },
  },
  {
    toolId: "khalani.tokens.autocomplete",
    namespace: "khalani",
    lifecycle: "active",
    description: "Semantic token autocomplete — understands '100 usdc on ethereum'.",
    mutating: false,
    params: [
      { key: "keyword", type: "string", required: true, description: "Autocomplete keyword." },
      { key: "chainIds", type: "string", description: "Comma-separated chain IDs or aliases." },
      { key: "limit", type: "number", description: "Max results." },
    ],
    exampleParams: { keyword: "eth", limit: 5 },
    discovery: {
      embeddingText: khalaniEmbeddingText(
        `semantic token autocomplete; parse natural language token amount and chain; 100 USDC on Ethereum; ` +
        `$50 ETH on Base; receive token on destination chain; suggest next token chain amount slots; ` +
        `cross-chain bridge form helper; ${KHALANI_CHAINS}`,
      ),
    },
  },
  {
    toolId: "khalani.tokens.balances",
    namespace: "khalani",
    lifecycle: "active",
    description: "Get token balances with USD prices for a wallet address across chains.",
    mutating: false,
    params: [
      { key: "address", type: "string", description: "Wallet address (optional — uses configured wallet)." },
      { key: "wallet", type: "string", description: "Wallet family: eip155 or solana (used if address not provided)." },
      { key: "chainIds", type: "string", description: "Comma-separated chain IDs or aliases." },
    ],
    exampleParams: { wallet: "eip155", chainIds: "1,8453" },
    discovery: {
      embeddingText: khalaniEmbeddingText(
        `get wallet token balances across chains; portfolio balances for EVM or Solana wallet; balance with USD price; ` +
        `check funds before bridge; find available source assets; USDC ETH SOL stablecoin balances; ${KHALANI_CHAINS}`,
      ),
    },
  },
  {
    toolId: "khalani.quote.get",
    namespace: "khalani",
    lifecycle: "active",
    description: "Get cross-chain bridge quote with routes, pricing, and ETA. Resolve fromToken/toToken addresses via khalani.tokens.search first.",
    mutating: false,
    params: [
      { key: "fromChain", type: "string", required: true, description: "Source chain ID or alias." },
      { key: "fromToken", type: "string", required: true, description: "Source token address." },
      { key: "toChain", type: "string", required: true, description: "Destination chain ID or alias." },
      { key: "toToken", type: "string", required: true, description: "Destination token address." },
      { key: "amount", type: "string", required: true, description: "Amount in smallest units." },
      { key: "tradeType", type: "string", description: "EXACT_INPUT or EXACT_OUTPUT (default: EXACT_INPUT)." },
      { key: "fromAddress", type: "string", description: "Source wallet address override." },
      { key: "recipient", type: "string", description: "Destination recipient override." },
      { key: "refundTo", type: "string", description: "Refund address override (defaults to fromAddress)." },
      { key: "referrer", type: "string", description: "EVM referrer address for fee sharing." },
      { key: "referrerFeeBps", type: "string", description: "Referrer fee in basis points (0-9999)." },
      { key: "filler", type: "string", description: "Restrict quotes to a specific filler." },
    ],
    exampleParams: {
      fromChain: "ethereum",
      fromToken: "0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
      toChain: "solana",
      toToken: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      amount: "1000000",
    },
    discovery: {
      embeddingText: khalaniEmbeddingText(
        `get cross-chain bridge quote; quote token transfer from source chain to destination chain; ` +
        `compare routes fillers and solvers; Hyperstream Across deBridge Glacis; exact input exact output; ` +
        `amountOut ETA gas quote expiry deposit methods; read-only bridge preview; ${KHALANI_CHAINS}`,
      ),
    },
  },
  {
    toolId: "khalani.orders.list",
    namespace: "khalani",
    lifecycle: "active",
    description: "List Khalani bridge orders for an address with pagination and filters.",
    mutating: false,
    params: [
      { key: "address", type: "string", description: "Wallet address (optional — uses configured wallet)." },
      { key: "wallet", type: "string", description: "Wallet family: eip155 or solana." },
      { key: "limit", type: "number", description: "Max results." },
      { key: "cursor", type: "number", description: "Pagination cursor for next page." },
      { key: "fromChain", type: "string", description: "Source chain filter (ID or alias)." },
      { key: "toChain", type: "string", description: "Destination chain filter (ID or alias)." },
      { key: "orderIds", type: "string", description: "Comma-separated order IDs to filter." },
      { key: "txHashSearch", type: "string", description: "Search by transaction hash." },
    ],
    exampleParams: { wallet: "solana", limit: 20 },
    discovery: {
      embeddingText: khalaniEmbeddingText(
        `list cross-chain bridge orders for wallet; bridge history; paginated order tracking; ` +
        `filter by source chain destination chain order ids or transaction hash; ` +
        `created deposited published filled refund pending refunded failed; EVM and Solana order status; ${KHALANI_CHAINS}`,
      ),
    },
  },
  {
    toolId: "khalani.orders.get",
    namespace: "khalani",
    lifecycle: "active",
    description: "Get a single Khalani bridge order by ID with full lifecycle details.",
    mutating: false,
    params: [
      { key: "orderId", type: "string", required: true, description: "Khalani order ID." },
    ],
    exampleParams: { orderId: "order_abc123" },
    discovery: {
      embeddingText: khalaniEmbeddingText(
        `get single cross-chain bridge order by id; inspect bridge lifecycle; order status details; ` +
        `deposit fill refund transactions; provider status; quoteId routeId fromChain toChain token amounts; ` +
        `troubleshoot bridge order; ${KHALANI_CHAINS}`,
      ),
    },
  },
  {
    toolId: "khalani.bridge",
    namespace: "khalani",
    lifecycle: "active",
    description: "Execute a cross-chain bridge: quote → build deposit → sign → broadcast → submit. Requires wallet access. Resolve fromToken/toToken addresses via khalani.tokens.search first.",
    mutating: true,
    params: [
      { key: "fromChain", type: "string", required: true, description: "Source chain ID or alias." },
      { key: "fromToken", type: "string", required: true, description: "Source token address." },
      { key: "toChain", type: "string", required: true, description: "Destination chain ID or alias." },
      { key: "toToken", type: "string", required: true, description: "Destination token address." },
      { key: "amount", type: "string", required: true, description: "Amount in smallest units." },
      { key: "tradeType", type: "string", description: "EXACT_INPUT or EXACT_OUTPUT." },
      { key: "fromAddress", type: "string", description: "Source wallet address override." },
      { key: "recipient", type: "string", description: "Destination recipient override." },
      { key: "refundTo", type: "string", description: "Refund address override (defaults to fromAddress)." },
      { key: "referrer", type: "string", description: "EVM referrer address for fee sharing." },
      { key: "referrerFeeBps", type: "string", description: "Referrer fee in basis points (0-9999)." },
      { key: "filler", type: "string", description: "Restrict quotes to a specific filler." },
      { key: "routeId", type: "string", description: "Specific route ID (default: best route)." },
      { key: "depositMethod", type: "string", description: "CONTRACT_CALL, PERMIT2, or TRANSFER." },
      { key: "dryRun", type: "boolean", description: "If true, build deposit plan without executing." },
    ],
    exampleParams: {
      fromChain: "ethereum",
      fromToken: "0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
      toChain: "base",
      toToken: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      amount: "100000000",
    },
    discovery: {
      embeddingText: khalaniEmbeddingText(
        `execute cross-chain bridge transfer; bridge tokens between EVM and Solana chains; ` +
        `quote build deposit sign broadcast submit; Hyperstream intent route; ` +
        `CONTRACT_CALL PERMIT2 TRANSFER deposit method; requires wallet approval; dry run bridge plan; ${KHALANI_CHAINS}`,
      ),
      canonicalSummary: "Execute a cross-chain bridge transfer across 40+ EVM and Solana chains.",
      preferredFor: ["cross-chain bridge", "bridge funds", "bridge tokens", "cross chain transfer"],
    },
  },
];
