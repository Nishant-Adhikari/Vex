/**
 * Polymarket auto-setup — credential acquisition (step 6).
 *
 * Wraps `acquirePolymarketCredentialsWithPassword` with the engine-code →
 * public-error mapping. The credentials live ONLY inside the returned `ok`
 * result; the caller copies the address into a separate binding so it can drop
 * the credentials reference as soon as the write returns.
 */

import {
  acquirePolymarketCredentialsWithPassword,
} from "@vex-lib/polymarket.js";
import { type WalletInventoryEntry } from "@vex-lib/wallet.js";
import { type VexError } from "@shared/ipc/result.js";
import { log } from "../../../logger/index.js";
import {
  ENGINE_CODE,
  getEngineCode,
  keystoreCorruptError,
  keystoreMissingError,
  passwordInvalidError,
  polymarketSetupFailedError,
  providerUnavailableError,
  unexpectedAcquireError,
} from "./errors.js";

// ── Acquired-credentials wrapper so we can drop the reference under the
// write lock without losing the address we need to return. ─────────────────
export interface AcquiredAddress {
  readonly address: `0x${string}`;
}

interface AcquiredCredentials {
  address: `0x${string}`;
  credentials: {
    apiKey: string;
    secret: string;
    passphrase: string;
  };
}

export type AcquireResult =
  | { readonly kind: "ok"; readonly acquired: AcquiredCredentials }
  | { readonly kind: "error"; readonly error: VexError };

/**
 * 6. Acquire credentials OUTSIDE the lock.
 *
 * Wraps the engine acquire primitive WITH the resolved entry (acquire asserts
 * the keystore derives the entry's address before signing). Engine `VexError`
 * codes map to the public codes below; any unmapped failure surfaces as an
 * unexpected-acquire error. On success the credentials are returned inside the
 * `ok` result for the caller to persist and immediately drop.
 */
export async function acquireCredentials(
  password: string,
  entry: WalletInventoryEntry,
  correlationId: string,
): Promise<AcquireResult> {
  try {
    const acquired = await acquirePolymarketCredentialsWithPassword(
      password,
      entry,
    );
    return { kind: "ok", acquired };
  } catch (cause: unknown) {
    const code = getEngineCode(cause);
    if (code === ENGINE_CODE.KEYSTORE_NOT_FOUND) {
      log.warn(
        `[ipc:vex:onboarding:polymarketAutoSetup] keystore missing (acquire) correlationId=${correlationId}`,
      );
      return { kind: "error", error: keystoreMissingError(correlationId) };
    }
    if (code === ENGINE_CODE.KEYSTORE_CORRUPT) {
      log.error(
        `[ipc:vex:onboarding:polymarketAutoSetup] keystore corrupt (acquire) correlationId=${correlationId}`,
        cause,
      );
      return { kind: "error", error: keystoreCorruptError(correlationId) };
    }
    if (code === ENGINE_CODE.KEYSTORE_DECRYPT_FAILED) {
      // The vault re-auth passed but the keystore decrypt did not.
      // This means the wallet keystore was encrypted with a different
      // password than the vault (mismatched state) — surface as a
      // password-invalid error so the user re-checks the input.
      log.warn(
        `[ipc:vex:onboarding:polymarketAutoSetup] keystore decrypt failed correlationId=${correlationId}`,
      );
      return { kind: "error", error: passwordInvalidError(correlationId) };
    }
    if (code === ENGINE_CODE.POLYMARKET_AUTH_FAILED) {
      log.warn(
        `[ipc:vex:onboarding:polymarketAutoSetup] auth failed correlationId=${correlationId}`,
      );
      return {
        kind: "error",
        error: polymarketSetupFailedError(correlationId),
      };
    }
    if (code === ENGINE_CODE.HTTP_REQUEST_FAILED) {
      log.warn(
        `[ipc:vex:onboarding:polymarketAutoSetup] network failure correlationId=${correlationId}`,
      );
      return { kind: "error", error: providerUnavailableError(correlationId) };
    }
    log.error(
      `[ipc:vex:onboarding:polymarketAutoSetup] acquire failed correlationId=${correlationId}`,
      cause,
    );
    return { kind: "error", error: unexpectedAcquireError(correlationId) };
  }
}
