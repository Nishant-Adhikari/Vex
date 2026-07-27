/**
 * Server-side wallet-id → {id,address} resolution for per-session wallet
 * selection (puzzle 5 phase 5C). The renderer sends only inventory IDs; main
 * resolves the on-chain address from the engine config inventory (no DB, no
 * keys) so a renderer-supplied address is never trusted.
 */

import { getPrimaryEvmEntry, getWalletById } from "@vex-lib/wallet.js";
import type { VexError } from "@shared/ipc/result.js";

export type WalletRef = { id: string; address: string };

/**
 * Resolve a wallet ID for a family.
 *   - null/empty id → null (unselected);
 *   - known id → { id, address };
 *   - unknown id → "invalid" (caller fails closed, writes nothing).
 */
export function resolveWalletRef(
  family: "evm" | "solana",
  walletId: string | null | undefined,
): WalletRef | null | "invalid" {
  if (!walletId) return null;
  const entry = getWalletById(family, walletId);
  return entry ? { id: entry.id, address: entry.address } : "invalid";
}

/**
 * Default EVM wallet for a MISSION session when the operator made NO explicit
 * selection. Missions must always land on the PRIMARY trading wallet
 * (inventory `wallet.evm[0]`, the legacy "Primary" entry) so the host never has
 * to pick a wallet — the Mission Presets tab and the normal new-mission flow
 * both send `selectedEvmWalletId: null` expecting this default.
 *
 * Guards (fail safe, never crash):
 *   - no primary entry → null (session stays wallet-less, same as today);
 *   - primary is a vault (hold-only) wallet → null. A vault must NEVER be a
 *     session wallet; if evm[0] is somehow a vault we leave it null rather than
 *     bind a hold-only wallet. Callers still run the vault defense-in-depth.
 */
export function defaultMissionEvmWalletRef(): WalletRef | null {
  const entry = getPrimaryEvmEntry();
  if (!entry) return null;
  if (entry.vault === true) return null;
  return { id: entry.id, address: entry.address };
}

export function invalidWalletSelectionError(correlationId: string): VexError {
  return {
    code: "wallets.invalid_selection",
    domain: "wallets",
    message: "Selected wallet is not in the inventory.",
    retryable: false,
    userActionable: true,
    redacted: true,
    correlationId,
  };
}

/** True when the wallet is flagged vault (hold-only, never a session wallet). */
export function isVaultWallet(
  family: "evm" | "solana",
  walletId: string | null | undefined,
): boolean {
  if (!walletId) return false;
  return getWalletById(family, walletId)?.vault === true;
}

export function vaultWalletSelectionError(correlationId: string): VexError {
  return {
    code: "wallets.invalid_selection",
    domain: "wallets",
    message: "That wallet is a vault (hold-only) wallet and can't be used for a session.",
    retryable: false,
    userActionable: true,
    redacted: true,
    correlationId,
  };
}
