/**
 * Khalani protocol tool manifests — 9 tools (8 read + 1 mutating).
 *
 * Each manifest declares what the tool does, what params it takes,
 * and whether it mutates state. The runtime uses this for discovery
 * and parameter validation before calling handlers.
 */

import type { ProtocolToolManifest } from "../types.js";
import { embeddingText } from "../_embedding-text.js";
import { KHALANI_CHAINS } from "./discovery-text.js";

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
      embeddingText: embeddingText(
        `List every chain Khalani can bridge to or from — 40+ networks including Ethereum, Solana, Base, Arbitrum, BNB Chain, Polygon, Avalanche, Optimism, Linea, zkSync and others, both EVM and Solana. ` +
        `Use this when the user wants to know what chains the bridge supports, asks if a specific network can be bridged, or wants to see chain metadata before transferring. ` +
        `Example queries: what chains can I bridge to, list khalani supported networks, can I bridge to solana, what evm chains support bridging, supported bridge routes.`,
      ),
      chains: KHALANI_CHAINS,
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
      embeddingText: embeddingText(
        `List the most popular bridge-supported tokens — USDC, ETH, SOL, USDT, WETH and other major assets — across the 40+ chains Khalani supports. ` +
        `Use this when the user wants to know what tokens are commonly bridged, see top assets per chain, or browse popular cross-chain coins before deciding what to move. ` +
        `Example queries: top bridge tokens on base, popular cross-chain coins, what major tokens does khalani support, list common bridge assets, popular tokens to bridge.`,
      ),
      chains: KHALANI_CHAINS,
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
      embeddingText: embeddingText(
        `Look up a token by name, symbol, or address across 40+ EVM and Solana chains — the canonical cross-chain resolver. ` +
        `Use this when the user names a token by ticker or partial name (USDC, ETH, SOL, PEPE) and you need the exact contract address on the source or destination chain before swapping or bridging. ` +
        `Example queries: find usdc address on base, what's the address of pepe on eth, lookup sol mint, resolve this ticker on solana, find token contract on arb. ` +
        `Run this before any swap or bridge.`,
      ),
      chains: KHALANI_CHAINS,
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
      embeddingText: embeddingText(
        `Parse natural-language token plus amount plus chain phrases like '100 usdc on ethereum' or '50 eth on base' into structured suggestions for the next slot. ` +
        `Use this when the user types a partial bridge or swap intent and you need to auto-fill a form, suggest token completions, parse a freeform query, or guide them to the next field. ` +
        `Example queries: parse 100 usdc on eth, autocomplete 50 sol, what tokens match eth on base, suggest tokens for this query, fill in the bridge form.`,
      ),
      chains: KHALANI_CHAINS,
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
      embeddingText: embeddingText(
        `Get a wallet's token balances across multiple EVM and Solana chains, with USD prices included. ` +
        `Use this when the user wants to check their portfolio, see what they hold across chains, find available source assets before bridging or swapping, or get USD value of their holdings. ` +
        `Example queries: what's my balance, show my portfolio across chains, how much usdc do I have, check my wallet on solana, find available funds before bridging, total holdings, my crypto worth.`,
      ),
      chains: KHALANI_CHAINS,
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
      embeddingText: embeddingText(
        `Preview a cross-chain bridge — get expected output amount, routes, ETA, and gas cost before executing. ` +
        `Use this when the user wants to know what they'd receive when bridging, compare bridge routes, check ETA before transferring, or simulate a cross-chain transfer. ` +
        `Example queries: how much usdc would I get bridging from eth to solana, preview bridge from base to arbitrum, what's the eta to bridge, compare bridge routes, simulate cross-chain transfer. ` +
        `Read-only — does not execute.`,
      ),
      chains: KHALANI_CHAINS,
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
      embeddingText: embeddingText(
        `List a wallet's bridge orders on Khalani — paginated, filterable by source chain, destination chain, order ID, or transaction hash. ` +
        `Use this when the user wants to see their bridge history, track multiple in-flight transfers, look up a specific bridge by tx hash, or audit cross-chain activity. ` +
        `Example queries: show my bridge history, list my recent bridges, find my bridge by tx hash, track bridges from eth to base, my pending cross-chain transfers.`,
      ),
      chains: KHALANI_CHAINS,
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
      embeddingText: embeddingText(
        `Get full lifecycle details of a single Khalani bridge order — status, deposit and fill and refund transactions, source and destination, amounts, provider details. ` +
        `Use this when the user wants to inspect one specific bridge, troubleshoot a stuck transfer, see the deep details of a cross-chain order, or check completion status. ` +
        `Example queries: status of my bridge order abc123, why is my bridge stuck, full details for this cross-chain transfer, look up this bridge order, troubleshoot a bridge.`,
      ),
      chains: KHALANI_CHAINS,
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
      embeddingText: embeddingText(
        `Move tokens between blockchains — bridge across Ethereum, Solana, Base, Arbitrum, BNB Chain, Polygon, Avalanche and 35+ other EVM and Solana chains. ` +
        `Use this when the user wants to bridge funds, move tokens cross-chain, get assets onto another network, send USDC from Ethereum to Solana, transfer to Base, or get out of one chain into another. ` +
        `Example queries: bridge usdc from eth to solana, move funds to base, send sol from solana to ethereum, get tokens onto arb, cross-chain transfer, get my eth onto solana.`,
      ),
      canonicalSummary: "Execute a cross-chain bridge transfer across 40+ EVM and Solana chains.",
      preferredFor: ["cross-chain bridge", "bridge funds", "bridge tokens", "cross chain transfer"],
      chains: KHALANI_CHAINS,
    },
  },
];
