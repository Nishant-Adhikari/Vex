import type { ProtocolToolManifest } from "../../types.js";

export const SEND_TOOLS: readonly ProtocolToolManifest[] = [
  {
    toolId: "solana.send.pending",
    namespace: "solana",
    lifecycle: "active",
    description: "Get pending send invites (tokens locked, unclaimed by recipient).",
    mutating: false,
    params: [
      { key: "address", type: "string", required: true, description: "Wallet address." },
    ],
    exampleParams: { address: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM" },
  },
  {
    toolId: "solana.send.invite",
    namespace: "solana",
    lifecycle: "active",
    description: "Send tokens via invite code — recipient claims via Jupiter Mobile.",
    mutating: true,
    params: [
      { key: "amount", type: "number", required: true, description: "Amount in human units." },
      { key: "mint", type: "string", description: "Token mint (default: SOL)." },
    ],
    exampleParams: { amount: 1.0 },
  },
  {
    toolId: "solana.send.clawback",
    namespace: "solana",
    lifecycle: "active",
    description: "Recover unclaimed sent tokens using invite code.",
    mutating: true,
    params: [
      { key: "inviteCode", type: "string", required: true, description: "Invite code from original send." },
    ],
    exampleParams: { inviteCode: "AbC123xYz" },
  },
];
