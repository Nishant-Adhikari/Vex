import type { ProtocolToolManifest } from "../../types.js";

export const LEND_TOOLS: readonly ProtocolToolManifest[] = [
  {
    toolId: "solana.lend.rates",
    namespace: "solana",
    lifecycle: "active",
    description: "Get lending rates — APY (supply + rewards), TVL, total supply per token.",
    mutating: false,
    params: [],
    exampleParams: {},
    requiresEnv: "JUPITER_API_KEY",
    discovery: {
      embeddingText: "Get Jupiter Lend Earn vault rates on Solana. Compare supply APY, reward APY, TVL, total supply, jlToken or fToken vault data and supported lending assets for yield opportunities.",
    },
  },
  {
    toolId: "solana.lend.positions",
    namespace: "solana",
    lifecycle: "active",
    description: "Get lending positions and accrued earnings for a wallet.",
    mutating: false,
    params: [
      { key: "address", type: "string", required: true, description: "Wallet address." },
    ],
    exampleParams: { address: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM" },
    requiresEnv: "JUPITER_API_KEY",
    discovery: {
      embeddingText: "Get Jupiter Lend Earn positions for a Solana wallet. Review supplied assets, vault balances, accrued earnings, rewards, exchange price, yield and active lending portfolio.",
    },
  },
  {
    toolId: "solana.lend.deposit",
    namespace: "solana",
    lifecycle: "active",
    description: "Deposit tokens into Jupiter Lend Earn vault.",
    mutating: true,
    params: [
      { key: "asset", type: "string", required: true, description: "Token address to deposit." },
      { key: "amount", type: "string", required: true, description: "Amount in atomic units." },
    ],
    exampleParams: { asset: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", amount: "1000000" },
    requiresEnv: "JUPITER_API_KEY",
    discovery: {
      embeddingText: "Deposit SPL tokens into Jupiter Lend Earn vault on Solana. Supply assets to earn lending yield, mint vault shares, enter Earn position and execute a mutating lending deposit transaction.",
    },
  },
  {
    toolId: "solana.lend.withdraw",
    namespace: "solana",
    lifecycle: "active",
    description: "Withdraw tokens from Jupiter Lend Earn vault.",
    mutating: true,
    params: [
      { key: "asset", type: "string", required: true, description: "Token address to withdraw." },
      { key: "amount", type: "string", required: true, description: "Amount in atomic units." },
    ],
    exampleParams: { asset: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", amount: "1000000" },
    requiresEnv: "JUPITER_API_KEY",
    discovery: {
      embeddingText: "Withdraw SPL tokens from Jupiter Lend Earn vault on Solana. Redeem vault shares, exit lending position, recover supplied assets and execute a mutating lending withdrawal transaction.",
    },
  },
];
