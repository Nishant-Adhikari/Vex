/**
 * Wallet tools — read state and prepare/confirm transfers.
 *
 * `wallet_send_prepare` returns an intent ID; `wallet_send_confirm` broadcasts.
 * Confirm is the only mutating tool here.
 */

import type { ToolDef } from "../types.js";

export const WALLET_TOOLS: readonly ToolDef[] = [
  {
    name: "wallet_read", kind: "internal", mutating: false,
    description: "Read wallet state. action=address: get wallet address. action=balances: get all token balances with USD prices across chains via Khalani.",
    parameters: { type: "object", properties: {
      action: { type: "string", enum: ["address", "balances"], description: "address: get wallet address. balances: all tokens with USD prices." },
      chain: { type: "string", enum: ["eip155", "solana"], description: "Chain family (for address action)." },
      wallet: { type: "string", enum: ["eip155", "solana", "all"], description: "Wallet scope for balances (default: all)." },
      chainIds: { type: "string", description: "Chain ID filter for balances (comma-separated IDs or aliases)." },
    }, required: ["action"] },
  },
  {
    name: "wallet_send_prepare", kind: "internal", mutating: false,
    description: "Prepare a transfer intent (no broadcast). Returns intent ID for confirmation. Supports native tokens, ERC-20, and ERC-721 on any EVM chain. Solana: SOL + SPL tokens only (no pNFT/cNFT).",
    parameters: { type: "object", properties: {
      network: { type: "string", enum: ["eip155", "solana"], description: "Network family" },
      chain: { type: "string", description: "EVM chain ID or alias (e.g. 'polygon', '137', '0g'). Default: 0g. Ignored for solana." },
      to: { type: "string", description: "Recipient address" },
      amount: { type: "string", description: "Amount in user-facing units (for native/ERC-20) or '1' for ERC-721" },
      token: { type: "string", description: "Token: 'native' for chain native, contract address for ERC-20, 'nft:{contract}:{tokenId}' for ERC-721. Solana: symbol or mint (SOL + SPL only, NFT not supported)." },
    }, required: ["network", "to", "amount"] },
  },
  {
    name: "wallet_send_confirm", kind: "internal", mutating: true,
    description: "Confirm and broadcast a prepared transfer. Requires approval in restricted/off mode.",
    parameters: { type: "object", properties: {
      network: { type: "string", enum: ["eip155", "solana"], description: "Network family" },
      intentId: { type: "string", description: "Prepared intent ID" },
    }, required: ["network", "intentId"] },
  },
];
