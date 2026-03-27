import type { ProtocolToolManifest } from "../../types.js";

export const STAKE_TOOLS: readonly ProtocolToolManifest[] = [
  {
    toolId: "solana.stake.accounts",
    namespace: "solana",
    lifecycle: "active",
    description: "Get stake accounts — balance, status, validator, claimable MEV tips.",
    mutating: false,
    params: [
      { key: "address", type: "string", required: true, description: "Wallet address." },
    ],
    exampleParams: { address: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM" },
  },
  {
    toolId: "solana.stake.delegate",
    namespace: "solana",
    lifecycle: "active",
    description: "Create and delegate a new stake account.",
    mutating: true,
    params: [
      { key: "amountSol", type: "number", required: true, description: "SOL amount to stake." },
      { key: "validator", type: "string", description: "Validator vote address (default: Solana Compass)." },
    ],
    exampleParams: { amountSol: 5 },
  },
  {
    toolId: "solana.stake.withdraw",
    namespace: "solana",
    lifecycle: "active",
    description: "Withdraw SOL from a deactivated stake account.",
    mutating: true,
    params: [
      { key: "stakeAccount", type: "string", required: true, description: "Stake account address." },
      { key: "amountSol", type: "number", description: "Amount to withdraw (omit for full)." },
    ],
    exampleParams: { stakeAccount: "Abc123..." },
  },
  {
    toolId: "solana.stake.claimMev",
    namespace: "solana",
    lifecycle: "active",
    description: "Claim MEV tips from stake accounts.",
    mutating: true,
    params: [
      { key: "stakeAccount", type: "string", description: "Specific account (omit for all)." },
    ],
    exampleParams: {},
  },
];
