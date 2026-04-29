import type { ProtocolToolManifest } from "../../../types.js";

export const ALLOWANCE_TOOLS: readonly ProtocolToolManifest[] = [
  {
    toolId: "jaine.allowance.check",
    namespace: "jaine",
    lifecycle: "active",
    description: "Check current ERC-20 allowances for Jaine router and NFT position manager on 0G Network.",
    mutating: false,
    params: [
      { key: "token", type: "string", required: true, description: "Token address (0x...)." },
    ],
    exampleParams: { token: "0x1f3aa82227281ca364bfb3d253b0f1af1da6473e" },
  },
  {
    toolId: "jaine.allowance.approve",
    namespace: "jaine",
    lifecycle: "active",
    description: "Approve token spending for Jaine router or NFT manager. Handles USDT-style reset automatically.",
    mutating: true,
    params: [
      { key: "token", type: "string", required: true, description: "Token address (0x...)." },
      { key: "spender", type: "string", required: true, description: "Spender type: router or nft." },
      { key: "amount", type: "string", description: "Amount to approve in human units (default: unlimited)." },
      { key: "approveExact", type: "boolean", description: "Approve exact amount instead of max." },
    ],
    exampleParams: { token: "0x1f3a...", spender: "router" },
  },
  {
    toolId: "jaine.allowance.revoke",
    namespace: "jaine",
    lifecycle: "active",
    description: "Revoke token approval for Jaine router or NFT manager. Sets allowance to zero.",
    mutating: true,
    params: [
      { key: "token", type: "string", required: true, description: "Token address (0x...)." },
      { key: "spender", type: "string", required: true, description: "Spender type: router or nft." },
    ],
    exampleParams: { token: "0x1f3a...", spender: "router" },
  },
];
