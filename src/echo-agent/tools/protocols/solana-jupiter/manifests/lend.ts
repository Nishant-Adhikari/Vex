import type { ProtocolToolManifest } from "../../types.js";
import { embeddingText } from "../../_embedding-text.js";

const SOLANA_CHAINS: readonly string[] = ["Solana"];

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
      embeddingText: embeddingText(
        `Get Jupiter Lend Earn vault yield rates on Solana — APY (supply plus rewards), TVL, total supply per token. ` +
        `Use this when the user wants to compare lending APYs, find yield opportunities on solana, check earn rates on usdc or sol, or look at vault TVL before depositing. ` +
        `Example queries: best lending apy on solana, rates for usdc earn, jupiter lend yields, where can I earn yield on sol, check tvl for jupiter vaults, sol earn rates.`,
      ),
      chains: SOLANA_CHAINS,
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
      embeddingText: embeddingText(
        `Get a wallet's open Jupiter Lend Earn positions on Solana — supplied assets, balances, accrued earnings, rewards. ` +
        `Use this when the user wants to see what they have lent, check yield earned so far, review their solana lending portfolio, or audit their earn positions. ` +
        `Example queries: my lend positions on solana, what have I deposited, my jupiter earn balance, check accrued yield, review my lending, sol earn portfolio.`,
      ),
      chains: SOLANA_CHAINS,
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
      embeddingText: embeddingText(
        `Deposit SPL tokens into Jupiter Lend Earn vaults on Solana to earn yield. ` +
        `Use this when the user wants to earn yield on idle stables or sol, deposit into lending, supply assets, put usdc to work, or get a passive return on solana holdings. ` +
        `Example queries: deposit usdc to earn, lend my sol, supply assets for yield, put usdc to work on solana, earn on stables, start lending on solana.`,
      ),
      chains: SOLANA_CHAINS,
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
      embeddingText: embeddingText(
        `Withdraw SPL tokens from Jupiter Lend Earn vaults on Solana. ` +
        `Use this when the user wants to exit a lending position, take out their supplied assets, claim their earned yield by withdrawing, or pull funds from earn. ` +
        `Example queries: withdraw my usdc from lend, exit lending position on solana, take out my deposit, redeem my earn shares, pull funds from jupiter lend, stop lending.`,
      ),
      chains: SOLANA_CHAINS,
    },
  },
];
