import type { ProtocolToolManifest } from "../../../types.js";

export const TOKENS_TOOLS: readonly ProtocolToolManifest[] = [
  {
    toolId: "jaine.token.info",
    namespace: "jaine",
    lifecycle: "active",
    description: "Token data from Jaine subgraph — TVL, volume, fees, pool count, derivedETH price, transaction count.",
    mutating: false,
    params: [
      { key: "address", type: "string", required: true, description: "Token contract address (0x...)." },
    ],
    exampleParams: { address: "0x1f3aa82227281ca364bfb3d253b0f1af1da6473e" },
  },
  {
    toolId: "jaine.tokens.top",
    namespace: "jaine",
    lifecycle: "active",
    description: "Top tokens on Jaine DEX ranked by TVL or volume. Discover most active tokens on 0G Network.",
    mutating: false,
    params: [
      { key: "limit", type: "number", description: "Max tokens to return (default: 20, max 1000)." },
      { key: "skip", type: "number", description: "Number of tokens to skip for pagination." },
      { key: "by", type: "string", description: "Sort metric: tvl or volume (default: tvl)." },
    ],
    exampleParams: { limit: 20, by: "tvl" },
  },
  {
    toolId: "jaine.tokens.list",
    namespace: "jaine",
    lifecycle: "active",
    description: "List known core tokens on 0G Network with symbols and addresses. Includes USDC, WETH, w0G, st0G, stablecoins, and more.",
    mutating: false,
    params: [],
    exampleParams: {},
  },
];
