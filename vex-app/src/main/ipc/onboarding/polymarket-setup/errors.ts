/**
 * Polymarket auto-setup — engine-code mirror + public `VexError` builders.
 *
 * Pure module: only depends on the `VexError` type. The `ENGINE_CODE`
 * constants are mirrored locally to avoid coupling to the engine's
 * `ErrorCodes` namespace at the public surface; the 11 builder functions
 * each return a redacted, public-shaped `VexError`.
 */

import { type VexError } from "@shared/ipc/result.js";

/**
 * Engine `VexError` code constants mirrored locally to avoid coupling
 * to the engine's `ErrorCodes` namespace at the public surface.
 */
export const ENGINE_CODE = {
  KEYSTORE_NOT_FOUND: "KEYSTORE_NOT_FOUND",
  KEYSTORE_CORRUPT: "KEYSTORE_CORRUPT",
  KEYSTORE_DECRYPT_FAILED: "KEYSTORE_DECRYPT_FAILED",
  POLYMARKET_AUTH_FAILED: "POLYMARKET_AUTH_FAILED",
  HTTP_REQUEST_FAILED: "HTTP_REQUEST_FAILED",
} as const;

export function getEngineCode(cause: unknown): string | null {
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

export function sessionLockedError(correlationId: string): VexError {
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

export function keystoreMissingError(correlationId: string): VexError {
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

export function keystoreCorruptError(correlationId: string): VexError {
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

export function walletNotFoundError(correlationId: string): VexError {
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

export function overwriteRequiredError(correlationId: string): VexError {
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

export function passwordInvalidError(correlationId: string): VexError {
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

export function vaultNotConfiguredError(correlationId: string): VexError {
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

export function vaultIoError(correlationId: string): VexError {
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

export function polymarketSetupFailedError(correlationId: string): VexError {
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

export function providerUnavailableError(correlationId: string): VexError {
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

export function unexpectedAcquireError(correlationId: string): VexError {
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
