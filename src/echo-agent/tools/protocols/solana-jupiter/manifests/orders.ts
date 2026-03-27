import type { ProtocolToolManifest } from "../../types.js";

export const DCA_TOOLS: readonly ProtocolToolManifest[] = [
  {
    toolId: "solana.dca.list",
    namespace: "solana",
    lifecycle: "active",
    description: "List active DCA orders for a wallet.",
    mutating: false,
    params: [
      { key: "address", type: "string", required: true, description: "Wallet address." },
    ],
    exampleParams: { address: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM" },
  },
  {
    toolId: "solana.dca.create",
    namespace: "solana",
    lifecycle: "active",
    description: "Create a DCA (dollar-cost average) recurring order.",
    mutating: true,
    params: [
      { key: "inputToken", type: "string", required: true, description: "Token to spend (symbol or mint)." },
      { key: "outputToken", type: "string", required: true, description: "Token to buy (symbol or mint)." },
      { key: "amountPerCycle", type: "number", required: true, description: "Amount per cycle in human units." },
      { key: "interval", type: "string", required: true, description: "Interval: minute, hour, day, week, month." },
      { key: "numberOfOrders", type: "number", required: true, description: "Total number of cycles." },
    ],
    exampleParams: { inputToken: "USDC", outputToken: "SOL", amountPerCycle: 10, interval: "day", numberOfOrders: 30 },
  },
  {
    toolId: "solana.dca.cancel",
    namespace: "solana",
    lifecycle: "active",
    description: "Cancel an active DCA order.",
    mutating: true,
    params: [
      { key: "orderKey", type: "string", required: true, description: "DCA order key." },
    ],
    exampleParams: { orderKey: "Abc123..." },
  },
];

export const LIMIT_TOOLS: readonly ProtocolToolManifest[] = [
  {
    toolId: "solana.limit.list",
    namespace: "solana",
    lifecycle: "active",
    description: "List active limit orders for a wallet.",
    mutating: false,
    params: [
      { key: "address", type: "string", required: true, description: "Wallet address." },
    ],
    exampleParams: { address: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM" },
  },
  {
    toolId: "solana.limit.create",
    namespace: "solana",
    lifecycle: "active",
    description: "Create a limit order — triggers when target price is reached.",
    mutating: true,
    params: [
      { key: "inputToken", type: "string", required: true, description: "Token to sell (symbol or mint)." },
      { key: "outputToken", type: "string", required: true, description: "Token to buy (symbol or mint)." },
      { key: "inputAmount", type: "number", required: true, description: "Amount to sell in human units." },
      { key: "targetPriceUsd", type: "number", required: true, description: "Target price in USD." },
    ],
    exampleParams: { inputToken: "SOL", outputToken: "USDC", inputAmount: 10, targetPriceUsd: 200 },
  },
  {
    toolId: "solana.limit.cancel",
    namespace: "solana",
    lifecycle: "active",
    description: "Cancel an active limit order.",
    mutating: true,
    params: [
      { key: "orderKey", type: "string", required: true, description: "Limit order key." },
    ],
    exampleParams: { orderKey: "Abc123..." },
  },
];
