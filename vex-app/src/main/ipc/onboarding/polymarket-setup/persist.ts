/**
 * Polymarket auto-setup — persistence under the env-write lock (step 7).
 *
 * Owns the ENTIRE `withEnvWriteLock` block: the under-lock TOCTOU re-check via
 * `isWalletConfigured`, the null-acquired defensive guard, the `isPrimary`
 * compute, the `buildPolymarketVaultUpdates` key selection, and the
 * `writeUnlockedSecrets` write. The returned `PersistOutcome` carries NO
 * credential material — only the discriminator (and a `VexError` on failure).
 */

import { getAddress } from "viem";
import {
  buildPolymarketVaultUpdates,
  ENV_POLYMARKET_CLOB_CREDENTIALS_BY_ADDRESS,
} from "@vex-lib/polymarket.js";
import {
  getPrimaryEvmAddress,
  type WalletInventoryEntry,
} from "@vex-lib/wallet.js";
import { type VexError } from "@shared/ipc/result.js";
import { withEnvWriteLock } from "../../../onboarding/env-write-mutex.js";
import { writeUnlockedSecrets } from "../../../secrets/session.js";
import { log } from "../../../logger/index.js";
import { unexpectedAcquireError } from "./errors.js";
import { isWalletConfigured } from "./probe.js";

// ── Persistence result discriminator (under the lock) ─────────────────────
export type PersistOutcome =
  | { readonly kind: "persisted" }
  | { readonly kind: "race_confirmation_required" }
  | { readonly kind: "write_failed"; readonly error: VexError };

interface AcquiredCredentials {
  address: `0x${string}`;
  credentials: {
    apiKey: string;
    secret: string;
    passphrase: string;
  };
}

export interface PersistCredentialsArgs {
  readonly entry: WalletInventoryEntry;
  /** Nullable to keep the existing defensive guard (should be unreachable). */
  readonly acquired: AcquiredCredentials | null;
  readonly overwriteConfirmed: boolean;
  readonly correlationId: string;
}

/**
 * 7. Persist UNDER the env-write lock (with TOCTOU re-check).
 *
 * The whole body runs inside `withEnvWriteLock` so it cannot interleave with
 * keystoreSet / apiKeysSet / embeddingConfigure / agentCoreConfigure.
 */
export async function persistCredentials(
  args: PersistCredentialsArgs,
): Promise<PersistOutcome> {
  const { entry, acquired, overwriteConfirmed, correlationId } = args;
  return withEnvWriteLock(async (): Promise<PersistOutcome> => {
    // Race re-check — PER SELECTED WALLET. A concurrent vault write
    // (e.g. apiKeysSet on another tab, a Settings rotate flow, or a
    // parallel auto-setup for the same wallet) could have landed
    // between the pre-network probe (step 4) and now. Re-resolve the
    // configured set inside the lock; if the SELECTED wallet is now
    // present and overwriteConfirmed is false, back out without
    // writing. The probe also fails CLOSED if the session relocked
    // mid-flight (returns wallet.keystore_locked) so the write below
    // never runs against a locked vault.
    const lockedCheck = isWalletConfigured(entry);
    if (lockedCheck.kind === "error") {
      return {
        kind: "write_failed",
        error: { ...lockedCheck.error, correlationId },
      };
    }
    if (lockedCheck.configured && !overwriteConfirmed) {
      return { kind: "race_confirmation_required" };
    }

    if (acquired === null) {
      // Defensive — should be unreachable; logged to surface bugs.
      log.error(
        `[ipc:vex:onboarding:polymarketAutoSetup] acquired==null at write time correlationId=${correlationId}`,
      );
      return {
        kind: "write_failed",
        error: unexpectedAcquireError(correlationId),
      };
    }

    // PERSIST: compute isPrimary by comparing the acquired address to
    // the primary EVM address (guard a null primary), then build the
    // vault updates via the SHARED helper — NON-primary writes ONLY the
    // per-address map key (merged); PRIMARY writes the map key + the 3
    // fixed legacy keys. `buildPolymarketVaultUpdates` is the single
    // source of truth for key selection.
    const primaryAddress = getPrimaryEvmAddress();
    const isPrimary =
      primaryAddress !== null &&
      getAddress(primaryAddress) === getAddress(acquired.address);
    const updates = buildPolymarketVaultUpdates({
      currentMapEnv: process.env[ENV_POLYMARKET_CLOB_CREDENTIALS_BY_ADDRESS],
      address: acquired.address,
      creds: {
        apiKey: acquired.credentials.apiKey,
        apiSecret: acquired.credentials.secret,
        passphrase: acquired.credentials.passphrase,
      },
      isPrimary,
    });

    const writeResult = writeUnlockedSecrets(updates);
    if (!writeResult.ok) {
      return {
        kind: "write_failed",
        error: { ...writeResult.error, correlationId },
      };
    }
    return { kind: "persisted" };
  });
}
