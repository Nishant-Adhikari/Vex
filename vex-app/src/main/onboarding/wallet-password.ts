/**
 * Wallet operations need the master password in the root engine because
 * wallet helpers still resolve it from `process.env.VEX_KEYSTORE_PASSWORD`.
 * The desktop app does not persist that env var. It injects the unlocked
 * in-memory password for the duration of a single wallet operation and
 * deletes it immediately afterwards.
 */

import {
  MASTER_PASSWORD_ENV_KEY,
} from "@vex-lib/secret-keys.js";
import { err, type Result, type VexError } from "@shared/ipc/result.js";
import { requireUnlockedMasterPassword } from "../secrets/session.js";

const KEYSTORE_ENV_KEY = MASTER_PASSWORD_ENV_KEY;

export interface FreshPasswordContext {
  readonly password: string;
}

export async function withFreshKeystorePassword<T>(
  fn: (ctx: FreshPasswordContext) => Promise<T>,
): Promise<T | Result<never, VexError>> {
  const passwordResult = requireUnlockedMasterPassword();
  if (!passwordResult.ok) return passwordResult;

  process.env[KEYSTORE_ENV_KEY] = passwordResult.data;
  try {
    return await fn({ password: passwordResult.data });
  } finally {
    delete process.env[KEYSTORE_ENV_KEY];
  }
}

export function isPasswordSetupError(
  value: unknown,
): value is Result<never, VexError> {
  return (
    typeof value === "object" &&
    value !== null &&
    "ok" in value &&
    (value as { ok: unknown }).ok === false &&
    "error" in value
  );
}

export function passwordSetupError(): Result<never, VexError> {
  return err({
    code: "wallet.keystore_locked",
    domain: "wallet",
    message: "Unlock Vex with your master password before using wallets.",
    retryable: false,
    userActionable: true,
    redacted: true,
  });
}
