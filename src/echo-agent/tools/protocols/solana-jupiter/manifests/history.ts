import type { ProtocolToolManifest } from "../../types.js";

export const HISTORY_TOOLS: readonly ProtocolToolManifest[] = [
  {
    toolId: "solana.history.spot",
    namespace: "solana",
    lifecycle: "active",
    description: "Get spot swap trade history with P&L — buy/sell, volume, profit, cost.",
    mutating: false,
    params: [
      { key: "address", type: "string", required: true, description: "Wallet address." },
      { key: "assetId", type: "string", description: "Filter by token mint." },
      { key: "limit", type: "number", description: "Max results." },
      { key: "after", type: "string", description: "Only trades after this timestamp (ISO or epoch)." },
      { key: "before", type: "string", description: "Only trades before this timestamp (ISO or epoch)." },
      { key: "offset", type: "string", description: "Pagination cursor from previous response next field." },
    ],
    exampleParams: { address: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM", limit: 20 },
  },
];
