/**
 * Structural-only error mapping/normalization for the wallet-export handler
 * (extracted verbatim from `wallet-export.ts` — no behaviour change). Maps
 * engine `VexError` codes and formats the throttle retry hint; the handler in
 * `./handler.ts` owns the control flow that emits these.
 */

import { type VexError } from "@shared/ipc/result.js";

export function formatRetryAfter(ms: number): string {
  const seconds = Math.max(1, Math.ceil(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.ceil(seconds / 60);
  return `${minutes}m`;
}

/**
 * Engine `VexError` code constants mirrored locally to avoid coupling
 * to the engine's `ErrorCodes` namespace at the public surface.
 */
export const ENGINE_CODE = {
  KEYSTORE_NOT_FOUND: "KEYSTORE_NOT_FOUND",
  SOLANA_KEYSTORE_NOT_FOUND: "KHALANI_SOLANA_KEYSTORE_NOT_FOUND",
} as const;

export function isEngineErrorWithCode(cause: unknown, code: string): boolean {
  if (
    typeof cause === "object" &&
    cause !== null &&
    "code" in cause &&
    typeof (cause as { code: unknown }).code === "string"
  ) {
    return (cause as { code: string }).code === code;
  }
  return false;
}

export function keystoreCorruptError(correlationId: string): VexError {
  return {
    code: "wallet.keystore_corrupt",
    domain: "wallet",
    message: "Keystore file is corrupted or in an unsupported format.",
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
      "No wallet exists for this chain. Generate or import one before exporting.",
    retryable: false,
    userActionable: true,
    redacted: true,
    correlationId,
  };
}
