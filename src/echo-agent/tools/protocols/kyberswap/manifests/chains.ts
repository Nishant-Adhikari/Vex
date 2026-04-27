import type { ProtocolToolManifest } from "../../types.js";
import { KYBER_SWAP_CHAINS, kyberEmbeddingText } from "../discovery-text.js";

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
      embeddingText: kyberEmbeddingText(
        `list KyberSwap supported EVM chains; chain ids; network feature matrix; aggregator swap availability; ` +
        `limit order availability; zap liquidity availability; supported networks; ${KYBER_SWAP_CHAINS}`,
      ),
      aliases: ["supported networks", "chain ids", "evm chains", "feature matrix"],
      exampleIntents: ["what chains does KyberSwap support", "list swap networks", "show KyberSwap chain ids"],
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
      embeddingText: kyberEmbeddingText(
        `check live KyberSwap chain availability status; active inactive new network status; ` +
        `Common Service supported chains; API availability for EVM networks; ${KYBER_SWAP_CHAINS}`,
      ),
      aliases: ["live chain status", "network availability", "active chain", "inactive chain"],
      exampleIntents: ["check if base is active", "live KyberSwap chain availability", "network status"],
    },
  },
];
