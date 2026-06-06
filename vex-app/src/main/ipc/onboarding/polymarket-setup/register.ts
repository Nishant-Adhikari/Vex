/**
 * vex.onboarding.polymarketAutoSetup — handler registration + orchestration.
 *
 * Wires the locked-spec flow (steps 2→9): session-unlock gate → wallet resolve
 * (fail-closed on null) → pre-network overwrite probe → re-auth via
 * `verifySecretVaultPassword` → `acquireCredentials` → `persistCredentials` →
 * drop the credentials reference (`acquired = null`) → audit switch. The
 * extracted modules own the pure error builders, the configured-probe, the
 * acquire wrapper, and the under-lock persistence.
 */

import {
  LocalSecretVaultError,
  verifySecretVaultPassword,
} from "@vex-lib/local-secret-vault.js";
import {
  getPrimaryEvmEntry,
  getWalletById,
  type WalletInventoryEntry,
} from "@vex-lib/wallet.js";
import { CH } from "@shared/ipc/channels.js";
import { err, ok, type Result } from "@shared/ipc/result.js";
import {
  polymarketAutoSetupInputSchema,
  polymarketAutoSetupResultSchema,
  type PolymarketAutoSetupResult,
} from "@shared/schemas/api-keys.js";
import { SECRETS_VAULT_FILE } from "../../../paths/config-dir.js";
import { getSecretSessionStatus } from "../../../secrets/session.js";
import { log } from "../../../logger/index.js";
import { registerHandler } from "../../register-handler.js";
import { acquireCredentials, type AcquiredAddress } from "./credentials.js";
import {
  overwriteRequiredError,
  passwordInvalidError,
  sessionLockedError,
  vaultIoError,
  vaultNotConfiguredError,
  walletNotFoundError,
} from "./errors.js";
import { persistCredentials, type PersistOutcome } from "./persist.js";
import { isWalletConfigured } from "./probe.js";

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
      // success path response. The acquire-result wrapper is confined to
      // a nested block so it does NOT retain a SECOND reference to the
      // credential object past the write — `acquired = null` (step 8)
      // must drop the ONLY surviving reference (drop-ref invariant 4).
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
      {
        const acquireResult = await acquireCredentials(
          input.password,
          entry,
          ctx.requestId,
        );
        if (acquireResult.kind === "error") {
          return err(acquireResult.error);
        }
        acquired = acquireResult.acquired;
      }

      const acquiredAddress: AcquiredAddress = { address: acquired.address };

      // 7. Persist UNDER the env-write lock (with TOCTOU re-check) ─────
      const persistOutcome: PersistOutcome = await persistCredentials({
        entry,
        acquired,
        overwriteConfirmed: input.overwriteConfirmed,
        correlationId: ctx.requestId,
      });

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
