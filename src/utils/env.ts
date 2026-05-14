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
 * Resolve keystore password from process.env only.
 * The desktop app and shell set it after an explicit vault unlock.
 */
export function getKeystorePassword(): string | null {
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
