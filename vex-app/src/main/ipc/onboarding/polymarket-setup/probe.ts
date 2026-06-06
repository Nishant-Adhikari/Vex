/**
 * Polymarket auto-setup — per-wallet "already configured" probe.
 *
 * Shared by BOTH the pre-network gate and the under-lock TOCTOU re-check so
 * the configured-set rule cannot drift between the two sites.
 */

import { getAddress } from "viem";
import { type WalletInventoryEntry } from "@vex-lib/wallet.js";
import { type VexError } from "@shared/ipc/result.js";
import { getConfiguredPolymarketAddresses } from "../../../secrets/session.js";

export type WalletConfiguredResult =
  | { readonly kind: "ok"; readonly configured: boolean }
  | { readonly kind: "error"; readonly error: VexError };

/**
 * Per-wallet "already configured" probe (puzzle 5 B-UI). Resolves the lowercased
 * configured-address set via `getConfiguredPolymarketAddresses()` and reports
 * whether the SELECTED wallet is already present. Returns the helper's error
 * Result on failure (locked session, malformed map → fail closed) so the caller
 * can short-circuit before any network/write. Used for BOTH the pre-network
 * gate and the under-lock TOCTOU recheck so the rule cannot drift.
 */
export function isWalletConfigured(
  entry: WalletInventoryEntry,
): WalletConfiguredResult {
  const result = getConfiguredPolymarketAddresses();
  if (!result.ok) return { kind: "error", error: result.error };
  const target = getAddress(entry.address).toLowerCase();
  return { kind: "ok", configured: result.data.includes(target) };
}
