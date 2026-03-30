/**
 * Shared Solana validation and amount helpers for the new solana-ecosystem shelf.
 */

import { PublicKey } from "@solana/web3.js";
import { loadConfig } from "../../../config/store.js";
import { EchoError, ErrorCodes } from "../../../errors.js";

export function validateSolanaAddress(addr: string): string {
  try {
    const pubkey = new PublicKey(addr);
    return pubkey.toBase58();
  } catch {
    throw new EchoError(
      ErrorCodes.SOLANA_INVALID_ADDRESS,
      `Invalid Solana address: ${addr}`,
      "Provide a valid base58-encoded Solana public key.",
    );
  }
}

export function tokenAmountToUi(rawAmount: string | bigint, decimals: number): number {
  return Number(BigInt(rawAmount)) / 10 ** decimals;
}

export function uiToTokenAmount(uiAmount: number, decimals: number): bigint {
  if (!Number.isFinite(uiAmount) || uiAmount <= 0) {
    throw new EchoError(
      ErrorCodes.INVALID_AMOUNT,
      `Invalid token amount: ${uiAmount}`,
      "Amount must be a positive finite number.",
    );
  }

  return BigInt(Math.round(uiAmount * 10 ** decimals));
}

export function looksLikeSolanaAddress(value: string): boolean {
  return value.length >= 32 && /^[1-9A-HJ-NP-Za-km-z]+$/.test(value);
}

export function solanaExplorerUrl(
  hashOrAddress: string,
  type: "tx" | "address" = "tx",
): string {
  const cfg = loadConfig();
  const base = cfg.solana?.explorerUrl ?? "https://explorer.solana.com";
  const clusterParam = cfg.solana?.cluster && cfg.solana.cluster !== "mainnet-beta"
    ? `?cluster=${cfg.solana.cluster}`
    : "";
  return `${base}/${type}/${hashOrAddress}${clusterParam}`;
}
