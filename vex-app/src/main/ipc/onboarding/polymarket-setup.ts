/**
 * vex.onboarding.polymarketAutoSetup — Phase 2 feature #7 IPC handler.
 *
 * One-click Polymarket setup: derive CLOB API credentials from the unlocked
 * EVM wallet keystore, then persist them inside the encrypted secret vault.
 * The renderer ships the user's master password (re-auth, sudo-style) plus
 * a `riskAcknowledged: true` hard literal and an `overwriteConfirmed`
 * boolean for the "credentials already exist" branch.
 *
 * Flow per locked spec (Codex-approved):
 *   1. Schema validation runs automatically inside `registerHandler`.
 *   2. Vault session must be unlocked. The handler does NOT prompt for an
 *      unlock; the renderer is expected to gate the action behind
 *      `getSecretSessionStatus().unlocked`.
 *   3. EVM keystore must exist on disk. Missing → `wallet.keystore_missing`.
 *   4. Pre-network overwrite check (UX). If all three Polymarket secrets
 *      are already present and the renderer did NOT pass
 *      `overwriteConfirmed: true`, return `wallet.risk_confirmation_required`
 *      BEFORE making any network call. This avoids burning a Polymarket
 *      API request when the user has not confirmed.
 *   5. Sudo-style re-auth via `verifySecretVaultPassword`. Wrong password →
 *      `wallet.password_invalid`. No session-state mutation, no KDF upgrade.
 *   6. Acquire credentials OUTSIDE the env-write lock — the network call
 *      runs without holding the serialiser. Engine `VexError` codes map to
 *      public error codes per the policy comment below.
 *   7. Persist UNDER `withEnvWriteLock` so this cannot interleave with
 *      keystoreSet / apiKeysSet / embeddingConfigure / agentCoreConfigure.
 *      A second presence probe runs INSIDE the lock to close the TOCTOU
 *      race against a concurrent vault write that landed between (4) and
 *      this point.
 *   8. Drop the credentials reference as soon as the write returns. JS
 *      strings are immutable so we can't zeroize the buffer — minimising
 *      lifetime is the strongest in-process defense.
 *   9. Audit log records the wallet address + correlationId only. NEVER
 *      the credentials or any prefix preview.
 *
 * Logging contract (mirrors Codex-locked api-keys logging rule):
 *   - log only `address=<X>` + `correlationId=<id>` on success
 *   - NEVER values, lengths, or prefix/suffix previews
 */

import {
  acquirePolymarketCredentialsWithPassword,
} from "@vex-lib/polymarket.js";
import { loadKeystore } from "@vex-lib/wallet.js";
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
  getSecretSessionStatus,
  getUnlockedSecretPresence,
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

function isPolymarketTrioConfigured(
  presence: ReturnType<typeof getUnlockedSecretPresence>,
): boolean {
  return Boolean(
    presence.secrets.POLYMARKET_API_KEY &&
      presence.secrets.POLYMARKET_API_SECRET &&
      presence.secrets.POLYMARKET_PASSPHRASE,
  );
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

      // 3. EVM wallet keystore must exist and be parseable ─────────────
      try {
        if (loadKeystore() === null) {
          log.warn(
            `[ipc:vex:onboarding:polymarketAutoSetup] keystore missing correlationId=${ctx.requestId}`,
          );
          return err(keystoreMissingError(ctx.requestId));
        }
      } catch (cause: unknown) {
        const code = getEngineCode(cause);
        if (code === ENGINE_CODE.KEYSTORE_CORRUPT) {
          log.error(
            `[ipc:vex:onboarding:polymarketAutoSetup] keystore corrupt correlationId=${ctx.requestId}`,
            cause,
          );
          return err(keystoreCorruptError(ctx.requestId));
        }
        log.error(
          `[ipc:vex:onboarding:polymarketAutoSetup] keystore load failed correlationId=${ctx.requestId}`,
          cause,
        );
        return err(keystoreMissingError(ctx.requestId));
      }

      // 4. Pre-network overwrite check ─────────────────────────────────
      // `getUnlockedSecretPresence()` self-relocks the session if its internal
      // decrypt probe fails. If the session relocked between step 2 and here,
      // abort BEFORE the network call so we never burn a Polymarket API
      // request whose write would then fail.
      const initialPresence = getUnlockedSecretPresence();
      if (!initialPresence.unlocked) {
        log.warn(
          `[ipc:vex:onboarding:polymarketAutoSetup] presence probe relocked correlationId=${ctx.requestId}`,
        );
        return err(sessionLockedError(ctx.requestId));
      }
      if (
        isPolymarketTrioConfigured(initialPresence) &&
        !input.overwriteConfirmed
      ) {
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
          // Race re-check: a concurrent vault write (e.g. apiKeysSet on
          // another wizard tab, future Settings rotate flow) could have
          // landed between the pre-network probe (step 4) and now. If
          // the trio is now present and overwriteConfirmed is false,
          // back out without writing.
          const lockedPresence = getUnlockedSecretPresence();
          // The probe self-relocks the session on internal failure. If we
          // hit that path here — between acquire and write — fail closed
          // so the writeUnlockedSecrets below never runs against a locked
          // vault.
          if (!lockedPresence.unlocked) {
            return {
              kind: "write_failed",
              error: sessionLockedError(ctx.requestId),
            };
          }
          if (
            isPolymarketTrioConfigured(lockedPresence) &&
            !input.overwriteConfirmed
          ) {
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

          const writeResult = writeUnlockedSecrets({
            POLYMARKET_API_KEY: acquired.credentials.apiKey,
            POLYMARKET_API_SECRET: acquired.credentials.secret,
            POLYMARKET_PASSPHRASE: acquired.credentials.passphrase,
          });
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
