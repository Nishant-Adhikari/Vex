import type { ProtocolToolManifest } from "../../types.js";

export const STUDIO_TOOLS: readonly ProtocolToolManifest[] = [
  {
    toolId: "solana.studio.fees",
    namespace: "solana",
    lifecycle: "active",
    description: "Get unclaimed DBC trading fees for a token you created.",
    mutating: false,
    params: [
      { key: "mint", type: "string", required: true, description: "Token mint address." },
    ],
    exampleParams: { mint: "Abc123..." },
    requiresEnv: "JUPITER_API_KEY",
  },
  {
    toolId: "solana.studio.create",
    namespace: "solana",
    lifecycle: "active",
    description: "Create a new token with Dynamic Bonding Curve. Requires Jupiter API key.",
    mutating: true,
    params: [
      { key: "tokenName", type: "string", required: true, description: "Token display name." },
      { key: "tokenSymbol", type: "string", required: true, description: "Token ticker symbol." },
      { key: "imagePath", type: "string", required: true, description: "Path to token image (PNG)." },
      { key: "initialMarketCap", type: "number", required: true, description: "Initial market cap in USD." },
      { key: "migrationMarketCap", type: "number", required: true, description: "Migration market cap in USD." },
      { key: "description", type: "string", description: "Token description." },
      { key: "feeBps", type: "number", description: "Trading fee in basis points (default: 100 = 1%)." },
    ],
    exampleParams: { tokenName: "My Token", tokenSymbol: "MYTKN", imagePath: "/tmp/logo.png", initialMarketCap: 10000, migrationMarketCap: 100000 },
    requiresEnv: "JUPITER_API_KEY",
  },
  {
    toolId: "solana.studio.claimFees",
    namespace: "solana",
    lifecycle: "active",
    description: "Claim accumulated DBC trading fees for a token you created.",
    mutating: true,
    params: [
      { key: "poolAddress", type: "string", required: true, description: "DBC pool address." },
      { key: "maxAmount", type: "string", description: "Max quote amount to claim." },
    ],
    exampleParams: { poolAddress: "Abc123..." },
    requiresEnv: "JUPITER_API_KEY",
  },
];
