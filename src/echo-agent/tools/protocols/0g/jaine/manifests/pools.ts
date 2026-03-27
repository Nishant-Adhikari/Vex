import type { ProtocolToolManifest } from "../../../types.js";

export const POOLS_TOOLS: readonly ProtocolToolManifest[] = [
  {
    toolId: "jaine.meta",
    namespace: "jaine",
    lifecycle: "active",
    description: "Subgraph health check — latest indexed block, deployment ID, and indexing error status for Jaine DEX on 0G Network.",
    mutating: false,
    params: [],
    exampleParams: {},
  },
  {
    toolId: "jaine.pools.top",
    namespace: "jaine",
    lifecycle: "active",
    description: "Top liquidity pools on Jaine DEX ranked by TVL. Returns pair, fee tier, TVL, volume, fees, transaction count.",
    mutating: false,
    params: [
      { key: "limit", type: "number", description: "Max pools to return (default: 20, max 1000)." },
      { key: "skip", type: "number", description: "Number of pools to skip for pagination." },
    ],
    exampleParams: { limit: 20 },
  },
  {
    toolId: "jaine.pools.forToken",
    namespace: "jaine",
    lifecycle: "active",
    description: "Find all Jaine pools containing a specific token — ranked by TVL. Use to discover trading pairs for a token.",
    mutating: false,
    params: [
      { key: "token", type: "string", required: true, description: "Token address (0x...)." },
      { key: "limit", type: "number", description: "Max pools to return (default: 100)." },
      { key: "skip", type: "number", description: "Number of pools to skip for pagination." },
    ],
    exampleParams: { token: "0x1f3aa82227281ca364bfb3d253b0f1af1da6473e" },
  },
  {
    toolId: "jaine.pools.forPair",
    namespace: "jaine",
    lifecycle: "active",
    description: "Find Jaine pools for a specific token pair (all fee tiers). Useful for comparing liquidity across fee tiers.",
    mutating: false,
    params: [
      { key: "tokenA", type: "string", required: true, description: "First token address (0x...)." },
      { key: "tokenB", type: "string", required: true, description: "Second token address (0x...)." },
      { key: "limit", type: "number", description: "Max pools to return (default: 100)." },
      { key: "skip", type: "number", description: "Number of pools to skip for pagination." },
    ],
    exampleParams: { tokenA: "0x1f3aa82227281ca364bfb3d253b0f1af1da6473e", tokenB: "0x1Cd0690fF9a693f5EF2dD976660a8dAFc81A109c" },
  },
  {
    toolId: "jaine.pools.newest",
    namespace: "jaine",
    lifecycle: "active",
    description: "Newest pools on Jaine DEX by creation time — discover recently launched trading pairs on 0G Network.",
    mutating: false,
    params: [
      { key: "limit", type: "number", description: "Max pools to return (default: 20, max 1000)." },
    ],
    exampleParams: { limit: 20 },
  },
];
