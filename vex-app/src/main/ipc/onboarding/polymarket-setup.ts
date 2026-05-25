/**
 * vex.onboarding.polymarketAutoSetup — Phase 2 feature #7 IPC handler.
 *
 * One-click Polymarket setup: derive CLOB API credentials from the unlocked
 * EVM wallet keystore, then persist them inside the encrypted secret vault.
 * The renderer ships the user's master password (re-auth, sudo-style) plus
 * a `riskAcknowledged: true` hard literal and an `overwriteConfirmed`
 * boolean for the "credentials already exist" branch.
 *
 * Per-wallet (puzzle 5 B-UI): the renderer may pass `walletId` to target a
 * specific EVM wallet; omitted = the primary. The credentials are merged into
 * the per-address `POLYMARKET_CLOB_CREDENTIALS_BY_ADDRESS` map (primary ALSO
 * refreshes the 3 fixed legacy keys) via the shared `buildPolymarketVaultUpdates`.
 *
 * Flow per locked spec (Codex-approved):
 *   1. Schema validation runs automatically inside `registerHandler`.
 *   2. Vault session must be unlocked. The handler does NOT prompt for an
 *      unlock; the renderer is expected to gate the action behind
 *      `getSecretSessionStatus().unlocked`.
 *   3. Resolve the TARGET wallet from `input.walletId` (or primary). A null
 *      entry → `wallet.not_found`, FAIL CLOSED before re-auth/acquire/network.
 *      The renderer-supplied id is the authority — never a renderer address.
 *   4. Pre-network overwrite check (UX), PER SELECTED WALLET. If the selected
 *      wallet already has credentials (its lowercased address is in
 *      `getConfiguredPolymarketAddresses()`) and the renderer did NOT pass
 *      `overwriteConfirmed: true`, return `wallet.risk_confirmation_required`
 *      BEFORE any network call.
 *   5. Sudo-style re-auth via `verifySecretVaultPassword`. Wrong password →
 *      `wallet.password_invalid`. No session-state mutation, no KDF upgrade.
 *   6. Acquire credentials OUTSIDE the env-write lock, WITH the resolved entry
 *      (acquire asserts the keystore derives the entry's address before
 *      signing). Engine `VexError` codes map to public codes below.
 *   7. Persist UNDER `withEnvWriteLock` so this cannot interleave with
 *      keystoreSet / apiKeysSet / embeddingConfigure / agentCoreConfigure.
 *      A second PER-WALLET configured-probe runs INSIDE the lock to close the
 *      TOCTOU race against a concurrent vault write that landed between (4)
 *      and this point. The write keys are computed by the shared
 *      `buildPolymarketVaultUpdates` (map merge + primary-only fixed keys).
 *   8. Drop the credentials reference as soon as the write returns. JS
 *      strings are immutable so we can't zeroize the buffer — minimising
 *      lifetime is the strongest in-process defense.
 *   9. Audit log records the wallet address + correlationId only. NEVER
 *      the credentials, the walletId, or any prefix preview.
 *
 * Logging contract (mirrors Codex-locked api-keys logging rule):
 *   - log only `address=<X>` + `correlationId=<id>` on success
 *   - NEVER values, lengths, or prefix/suffix previews
 */

import { getAddress } from "viem";
import {
  acquirePolymarketCredentialsWithPassword,
  buildPolymarketVaultUpdates,
  ENV_POLYMARKET_CLOB_CREDENTIALS_BY_ADDRESS,
} from "@vex-lib/polymarket.js";
import {
  getPrimaryEvmAddress,
  getPrimaryEvmEntry,
  getWalletById,
  type WalletInventoryEntry,
} from "@vex-lib/wallet.js";
import {
  LocalSecretVaultError,
  verifySecretVaultPassword,
} from "@vex-lib/local-secret-vault.js";
import { CH } from "@shared/ipc/channels.js";
import { err, ok, type Result, type VexError } from "@shared/ipc/result.js";
import {
  polymarketAutoSetupInputSchema,
  polymarketAutoSetupResultSchema,
  type PolymarketAutoSetupResult,
} from "@shared/schemas/api-keys.js";
import { withEnvWriteLock } from "../../onboarding/env-write-mutex.js";
import { SECRETS_VAULT_FILE } from "../../paths/config-dir.js";
import {
  getConfiguredPolymarketAddresses,
  getSecretSessionStatus,
  writeUnlockedSecrets,
} from "../../secrets/session.js";
import { log } from "../../logger/index.js";
import { registerHandler } from "../register-handler.js";

/**
 * Engine `VexError` code constants mirrored locally to avoid coupling
 * to the engine's `ErrorCodes` namespace at the public surface.
 */
const ENGINE_CODE = {
  KEYSTORE_NOT_FOUND: "KEYSTORE_NOT_FOUND",
  KEYSTORE_CORRUPT: "KEYSTORE_CORRUPT",
  KEYSTORE_DECRYPT_FAILED: "KEYSTORE_DECRYPT_FAILED",
  POLYMARKET_AUTH_FAILED: "POLYMARKET_AUTH_FAILED",
  HTTP_REQUEST_FAILED: "HTTP_REQUEST_FAILED",
} as const;

function getEngineCode(cause: unknown): string | null {
  if (
    typeof cause === "object" &&
    cause !== null &&
    "code" in cause &&
    typeof (cause as { code: unknown }).code === "string"
  ) {
    return (cause as { code: string }).code;
  }
  return null;
}

// ── Public error helpers ──────────────────────────────────────────────────

function sessionLockedError(correlationId: string): VexError {
  return {
    code: "wallet.keystore_locked",
    domain: "wallet",
    message:
      "Unlock Vex with your master password before configuring Polymarket.",
    retryable: false,
    userActionable: true,
    redacted: true,
    correlationId,
  };
}

function keystoreMissingError(correlationId: string): VexError {
  return {
    code: "wallet.keystore_missing",
    domain: "wallet",
    message:
      "No EVM wallet exists. Generate or import a wallet before configuring Polymarket.",
    retryable: false,
    userActionable: true,
    redacted: true,
    correlationId,
  };
}

function keystoreCorruptError(correlationId: string): VexError {
  return {
    code: "wallet.keystore_corrupt",
    domain: "wallet",
    message:
      "Wallet keystore is corrupt. Restore from backup or regenerate before configuring Polymarket.",
    retryable: false,
    userActionable: true,
    redacted: true,
    correlationId,
  };
}

function walletNotFoundError(correlationId: string): VexError {
  return {
    code: "wallet.not_found",
    domain: "wallet",
    message:
      "The selected EVM wallet was not found. Re-select a wallet and try again.",
    retryable: false,
    userActionable: true,
    redacted: true,
    correlationId,
  };
}

function overwriteRequiredError(correlationId: string): VexError {
  return {
    code: "wallet.risk_confirmation_required",
    domain: "wallet",
    message:
      "Polymarket credentials already exist. Confirm overwrite to continue.",
    retryable: true,
    userActionable: true,
    redacted: true,
    correlationId,
  };
}

function passwordInvalidError(correlationId: string): VexError {
  return {
    code: "wallet.password_invalid",
    domain: "wallet",
    message: "Master password is incorrect.",
    retryable: true,
    userActionable: true,
    redacted: true,
    correlationId,
  };
}

function vaultNotConfiguredError(correlationId: string): VexError {
  return {
    code: "wallet.vault_not_configured",
    domain: "wallet",
    message: "Master password is not configured. Complete setup first.",
    retryable: false,
    userActionable: true,
    redacted: true,
    correlationId,
  };
}

function vaultIoError(correlationId: string): VexError {
  return {
    code: "internal.unexpected",
    domain: "wallet",
    message: "Could not access the secret vault.",
    retryable: true,
    userActionable: false,
    redacted: true,
    correlationId,
  };
}

function polymarketSetupFailedError(correlationId: string): VexError {
  return {
    code: "provider.polymarket_setup_failed",
    domain: "onboarding",
    message:
      "Polymarket rejected the wallet signature. Verify the wallet has a Polymarket account and try again.",
    retryable: true,
    userActionable: true,
    redacted: true,
    correlationId,
  };
}

function providerUnavailableError(correlationId: string): VexError {
  return {
    code: "provider.unavailable",
    domain: "onboarding",
    message:
      "Polymarket API is temporarily unavailable. Try again in a moment.",
    retryable: true,
    userActionable: true,
    redacted: true,
    correlationId,
  };
}

function unexpectedAcquireError(correlationId: string): VexError {
  return {
    code: "internal.unexpected",
    domain: "onboarding",
    message: "Polymarket setup failed unexpectedly.",
    retryable: true,
    userActionable: false,
    redacted: true,
    correlationId,
  };
}

// ── Acquired-credentials wrapper so we can drop the reference under the
// write lock without losing the address we need to return. ─────────────────
interface AcquiredAddress {
  readonly address: `0x${string}`;
}

// ── Persistence result discriminator (under the lock) ─────────────────────
type PersistOutcome =
  | { readonly kind: "persisted" }
  | { readonly kind: "race_confirmation_required" }
  | { readonly kind: "write_failed"; readonly error: VexError };

/**
 * Per-wallet "already configured" probe (puzzle 5 B-UI). Resolves the lowercased
 * configured-address set via `getConfiguredPolymarketAddresses()` and reports
 * whether the SELECTED wallet is already present. Returns the helper's error
 * Result on failure (locked session, malformed map → fail closed) so the caller
 * can short-circuit before any network/write. Used for BOTH the pre-network
 * gate and the under-lock TOCTOU recheck so the rule cannot drift.
 */
function isWalletConfigured(
  entry: WalletInventoryEntry,
):
  | { readonly kind: "ok"; readonly configured: boolean }
  | { readonly kind: "error"; readonly error: VexError } {
  const result = getConfiguredPolymarketAddresses();
  if (!result.ok) return { kind: "error", error: result.error };
  const target = getAddress(entry.address).toLowerCase();
  return { kind: "ok", configured: result.data.includes(target) };
}

export function registerPolymarketSetupHandler(): () => void {
  return registerHandler({
    channel: CH.onboarding.polymarketAutoSetup,
    domain: "onboarding",
    inputSchema: polymarketAutoSetupInputSchema,
    outputSchema: polymarketAutoSetupResultSchema,
    handle: async (
      input,
      ctx,
    ): Promise<Result<PolymarketAutoSetupResult>> => {
      // 2. Session must be unlocked ───────────────────────────────────
      const sessionStatus = getSecretSessionStatus();
      if (!sessionStatus.unlocked) {
        log.warn(
          `[ipc:vex:onboarding:polymarketAutoSetup] session locked correlationId=${ctx.requestId}`,
        );
        return err(sessionLockedError(ctx.requestId));
      }

      // 3. Resolve the TARGET wallet from the renderer-supplied id ─────
      // `walletId` omitted → the primary EVM wallet (pre-B-UI behavior);
      // otherwise the specific inventory entry. The id is the authority —
      // we resolve through the config inventory and NEVER trust a
      // renderer-supplied address. A null entry fails CLOSED here, BEFORE
      // any password re-auth / acquire / network (Codex B-UI binding).
      const entry: WalletInventoryEntry | null = input.walletId
        ? getWalletById("evm", input.walletId)
        : getPrimaryEvmEntry();
      if (entry === null) {
        log.warn(
          `[ipc:vex:onboarding:polymarketAutoSetup] wallet not found correlationId=${ctx.requestId}`,
        );
        return err(walletNotFoundError(ctx.requestId));
      }

      // 4. Pre-network overwrite check — PER SELECTED WALLET ───────────
      // `getConfiguredPolymarketAddresses()` requires the unlocked session
      // (returns wallet.keystore_locked if it relocked between step 2 and
      // here) and fails CLOSED on a malformed map. The selected wallet is
      // "already configured" iff its lowercased address is in that set; if
      // so and the renderer did not confirm overwrite, abort BEFORE the
      // network call so we never burn a Polymarket API request.
      const preCheck = isWalletConfigured(entry);
      if (preCheck.kind === "error") {
        log.warn(
          `[ipc:vex:onboarding:polymarketAutoSetup] configured-probe failed (pre-network) correlationId=${ctx.requestId} code=${preCheck.error.code}`,
        );
        return err({ ...preCheck.error, correlationId: ctx.requestId });
      }
      if (preCheck.configured && !input.overwriteConfirmed) {
        log.info(
          `[ipc:vex:onboarding:polymarketAutoSetup] overwrite confirmation required correlationId=${ctx.requestId}`,
        );
        return err(overwriteRequiredError(ctx.requestId));
      }

      // 5. Re-auth via verifySecretVaultPassword ──────────────────────
      try {
        verifySecretVaultPassword(input.password, {
          filePath: SECRETS_VAULT_FILE,
        });
      } catch (cause: unknown) {
        if (cause instanceof LocalSecretVaultError) {
          if (cause.code === "invalid_password") {
            log.warn(
              `[ipc:vex:onboarding:polymarketAutoSetup] wrong password correlationId=${ctx.requestId}`,
            );
            return err(passwordInvalidError(ctx.requestId));
          }
          if (cause.code === "missing") {
            return err(vaultNotConfiguredError(ctx.requestId));
          }
        }
        // Corrupt JSON / IO — not an attacker signal.
        log.error(
          `[ipc:vex:onboarding:polymarketAutoSetup] vault verify failed correlationId=${ctx.requestId}`,
          cause,
        );
        return err(vaultIoError(ctx.requestId));
      }

      // 6. Acquire credentials OUTSIDE the lock ────────────────────────
      // The credentials live in `acquired` only inside this scope. We
      // copy the address into a separate binding (`acquiredAddress`) so
      // the persistence step can drop the credentials reference as soon
      // as the write returns, while we still have the address for the
      // success path response.
      let acquired:
        | {
            address: `0x${string}`;
            credentials: {
              apiKey: string;
              secret: string;
              passphrase: string;
            };
          }
        | null = null;
      try {
        acquired = await acquirePolymarketCredentialsWithPassword(
          input.password,
          entry,
        );
      } catch (cause: unknown) {
        const code = getEngineCode(cause);
        if (code === ENGINE_CODE.KEYSTORE_NOT_FOUND) {
          log.warn(
            `[ipc:vex:onboarding:polymarketAutoSetup] keystore missing (acquire) correlationId=${ctx.requestId}`,
          );
          return err(keystoreMissingError(ctx.requestId));
        }
        if (code === ENGINE_CODE.KEYSTORE_CORRUPT) {
          log.error(
            `[ipc:vex:onboarding:polymarketAutoSetup] keystore corrupt (acquire) correlationId=${ctx.requestId}`,
            cause,
          );
          return err(keystoreCorruptError(ctx.requestId));
        }
        if (code === ENGINE_CODE.KEYSTORE_DECRYPT_FAILED) {
          // The vault re-auth passed but the keystore decrypt did not.
          // This means the wallet keystore was encrypted with a different
          // password than the vault (mismatched state) — surface as a
          // password-invalid error so the user re-checks the input.
          log.warn(
            `[ipc:vex:onboarding:polymarketAutoSetup] keystore decrypt failed correlationId=${ctx.requestId}`,
          );
          return err(passwordInvalidError(ctx.requestId));
        }
        if (code === ENGINE_CODE.POLYMARKET_AUTH_FAILED) {
          log.warn(
            `[ipc:vex:onboarding:polymarketAutoSetup] auth failed correlationId=${ctx.requestId}`,
          );
          return err(polymarketSetupFailedError(ctx.requestId));
        }
        if (code === ENGINE_CODE.HTTP_REQUEST_FAILED) {
          log.warn(
            `[ipc:vex:onboarding:polymarketAutoSetup] network failure correlationId=${ctx.requestId}`,
          );
          return err(providerUnavailableError(ctx.requestId));
        }
        log.error(
          `[ipc:vex:onboarding:polymarketAutoSetup] acquire failed correlationId=${ctx.requestId}`,
          cause,
        );
        return err(unexpectedAcquireError(ctx.requestId));
      }

      const acquiredAddress: AcquiredAddress = { address: acquired.address };

      // 7. Persist UNDER the env-write lock (with TOCTOU re-check) ─────
      const persistOutcome: PersistOutcome = await withEnvWriteLock(
        async (): Promise<PersistOutcome> => {
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
              error: { ...lockedCheck.error, correlationId: ctx.requestId },
            };
          }
          if (lockedCheck.configured && !input.overwriteConfirmed) {
            return { kind: "race_confirmation_required" };
          }

          if (acquired === null) {
            // Defensive — should be unreachable; logged to surface bugs.
            log.error(
              `[ipc:vex:onboarding:polymarketAutoSetup] acquired==null at write time correlationId=${ctx.requestId}`,
            );
            return {
              kind: "write_failed",
              error: unexpectedAcquireError(ctx.requestId),
            };
          }

          // PERSIST: compute isPrimary by comparing the acquired address to
          // the primary EVM address (guard a null primary), then build the
          // vault updates via the SHARED helper — NON-primary writes ONLY the
          // per-address map key (merged); PRIMARY writes the map key + the 3
          // fixed legacy keys. `buildPolymarketVaultUpdates` is the single
          // source of truth for key selection (shared with the CLI path).
          const primaryAddress = getPrimaryEvmAddress();
          const isPrimary =
            primaryAddress !== null &&
            getAddress(primaryAddress) === getAddress(acquired.address);
          const updates = buildPolymarketVaultUpdates({
            currentMapEnv:
              process.env[ENV_POLYMARKET_CLOB_CREDENTIALS_BY_ADDRESS],
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
              error: { ...writeResult.error, correlationId: ctx.requestId },
            };
          }
          return { kind: "persisted" };
        },
      );

      // 8. Drop the credentials reference ASAP ────────────────────────
      acquired = null;

      // 9. Resolve the persist outcome + audit log ────────────────────
      switch (persistOutcome.kind) {
        case "race_confirmation_required":
          log.info(
            `[ipc:vex:onboarding:polymarketAutoSetup] overwrite required under lock correlationId=${ctx.requestId}`,
          );
          return err(overwriteRequiredError(ctx.requestId));

        case "write_failed":
          // The inner `writeUnlockedSecrets` already logged the failure.
          return err(persistOutcome.error);

        case "persisted":
          log.info(
            `[ipc:vex:onboarding:polymarketAutoSetup] address=${acquiredAddress.address} correlationId=${ctx.requestId}`,
          );
          return ok({
            configured: true,
            address: acquiredAddress.address,
          });
      }
    },
  });
}
