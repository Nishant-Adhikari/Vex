import type { ProtocolToolManifest } from "../../types.js";

export const ACCOUNT_TOOLS: readonly ProtocolToolManifest[] = [
  {
    toolId: "solana.account.burn",
    namespace: "solana",
    lifecycle: "active",
    description: "Burn SPL tokens — permanently destroy token balance.",
    mutating: true,
    params: [
      { key: "mint", type: "string", required: true, description: "Token mint address." },
      { key: "amount", type: "string", description: "Amount to burn in atomic units (omit for entire balance)." },
    ],
    exampleParams: { mint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263" },
  },
  {
    toolId: "solana.account.closeEmpty",
    namespace: "solana",
    lifecycle: "active",
    description: "Close empty token accounts and reclaim rent SOL.",
    mutating: true,
    params: [],
    exampleParams: {},
  },
];
