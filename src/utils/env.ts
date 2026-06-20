import { VexError, ErrorCodes } from "../errors.js";
import { MASTER_PASSWORD_ENV_KEY } from "../lib/secret-keys.js";

const ENV_KEY = MASTER_PASSWORD_ENV_KEY;

/**
 * Sanitize env value: treat empty string and literal "undefined" as missing.
 */
function sanitizeEnvValue(value: string | undefined): string | null {
  if (value === undefined || value === "" || value === "undefined") return null;
  return value;
}

/**
 * Optional main-owned keystore-password provider. The Electron main secret
 * session registers this AFTER an explicit vault unlock so in-process signing can
 * read the master password LIVE from main's in-memory unlocked state WITHOUT the
 * password ever being written to `process.env` (the unlock flow intentionally
 * scrubs the env — FINDING-security-003). Only the function REFERENCE is stored
 * here; the resolved string is never cached. The provider is cleared on relock so
 * a lock atomically revokes the signing capability.
 */
let keystorePasswordProvider: (() => string | null) | null = null;

/**
 * Register the main-owned keystore-password provider. Call ONLY from the Electron
 * main secret-session owner after unlock/init/adopt. The provider must return the
 * live unlocked master password, or `null` when the vault is locked. Never logs,
 * never persists the password to env.
 */
export function setKeystorePasswordProvider(provider: () => string | null): void {
  keystorePasswordProvider = provider;
}

/**
 * Clear the registered provider — call on relock. Afterwards password resolution
 * falls back to `process.env` only, so signing fails closed once the vault locks.
 */
export function clearKeystorePasswordProvider(): void {
  keystorePasswordProvider = null;
}

/**
 * Resolve the keystore password: the main-owned provider FIRST (desktop, after an
 * explicit unlock), then `process.env` (shell/automation). Returns `null` when
 * neither yields a value (locked vault and no env var) so callers fail closed.
 */
export function getKeystorePassword(): string | null {
  if (keystorePasswordProvider !== null) {
    const fromProvider = keystorePasswordProvider();
    if (fromProvider) {
      const sanitized = sanitizeEnvValue(fromProvider);
      if (sanitized !== null) return sanitized;
    }
  }
  return sanitizeEnvValue(process.env[ENV_KEY]);
}

/**
 * Get keystore password from environment, throw if not set.
 * Used in automation flows where password is required.
 */
export function requireKeystorePassword(): string {
  const pw = getKeystorePassword();
  if (!pw) {
    throw new VexError(
      ErrorCodes.KEYSTORE_PASSWORD_NOT_SET,
      "VEX_KEYSTORE_PASSWORD environment variable is required.",
      "Unlock Vex with your master password or set VEX_KEYSTORE_PASSWORD for automation."
    );
  }
  return pw;
}
