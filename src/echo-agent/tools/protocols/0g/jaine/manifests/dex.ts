import type { ProtocolToolManifest } from "../../../types.js";

export const DEX_TOOLS: readonly ProtocolToolManifest[] = [
  {
    toolId: "jaine.dex.stats",
    namespace: "jaine",
    lifecycle: "active",
    description: "Global Jaine DEX daily stats — total volume (USD/ETH), fees, TVL, transaction count per day.",
    mutating: false,
    params: [
      { key: "limit", type: "number", description: "Number of days to return (default: 30, max 1000)." },
    ],
    exampleParams: { limit: 7 },
  },
];
