import type { ProtocolToolManifest } from "../../types.js";
import { embeddingText } from "../../_embedding-text.js";
import { KYBER_SWAP_CHAINS } from "../discovery-text.js";

export const CHAINS_TOOLS: readonly ProtocolToolManifest[] = [
  {
    toolId: "kyberswap.chains",
    namespace: "kyberswap",
    lifecycle: "active",
    description: "List all 20 KyberSwap-supported EVM chains with feature availability (swap, limit orders, zap).",
    mutating: false,
    params: [],
    exampleParams: {},
    discovery: {
      embeddingText: embeddingText(
        `List the EVM chains where KyberSwap is available — Ethereum, Base, Arbitrum, BNB Chain, Polygon, Optimism, Avalanche, Linea and others — with which features (swap, limit orders, zap LP) work on each chain. ` +
        `Use this when the user wants to know what chains KyberSwap supports, where they can swap or place limit orders, or which networks have zap liquidity available. ` +
        `Example queries: what chains does kyberswap support, where can I place a limit order, list evm networks for swap, does kyberswap work on base, kyberswap chain feature matrix.`,
      ),
      aliases: ["supported networks", "chain ids", "evm chains", "feature matrix"],
      exampleIntents: ["what chains does KyberSwap support", "list swap networks", "show KyberSwap chain ids"],
      chains: KYBER_SWAP_CHAINS,
    },
  },
  {
    toolId: "kyberswap.chains.supported",
    namespace: "kyberswap",
    lifecycle: "active",
    description: "Get live chain availability status from KyberSwap Common Service (active/inactive/new).",
    mutating: false,
    params: [],
    exampleParams: {},
    discovery: {
      embeddingText: embeddingText(
        `Live availability status for KyberSwap chains — which networks are currently active, inactive, or recently added. ` +
        `Use this when the user wants real-time chain status, asks if a network is up right now, or wants to know about new chain additions before trading. ` +
        `Example queries: is base active on kyberswap right now, live chain status, is the api up for arbitrum, any new chains on kyberswap, kyberswap network availability check.`,
      ),
      aliases: ["live chain status", "network availability", "active chain", "inactive chain"],
      exampleIntents: ["check if base is active", "live KyberSwap chain availability", "network status"],
      chains: KYBER_SWAP_CHAINS,
    },
  },
];
