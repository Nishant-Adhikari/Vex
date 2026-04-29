import { VexError, ErrorCodes } from "../errors.js";
import { readEnvValue } from "../providers/env-resolution.js";
import { ENV_FILE } from "../config/paths.js";

const ENV_KEY = "VEX_KEYSTORE_PASSWORD";

/**
 * Sanitize env value: treat empty string and literal "undefined" as missing.
 */
function sanitizeEnvValue(value: string | undefined): string | null {
  if (value === undefined || value === "" || value === "undefined") return null;
  return value;
}

/**
 * Resolve keystore password with 2-level fallback chain:
 *   1. process.env.VEX_KEYSTORE_PASSWORD (if non-empty, not "undefined")
 *   2. ~/.config/vex/.env (app-specific)
 *
 * Resolved value is cached in process.env for subsequent calls.
 */
export function getKeystorePassword(): string | null {
  const envValue = sanitizeEnvValue(process.env[ENV_KEY]);

  // 1. Valid env value — use it (automation / CI compatibility)
  if (envValue) {
    return envValue;
  }

  // 2. Fallback: ~/.config/vex/.env (app-specific)
  const appFileValue = readEnvValue(ENV_KEY, ENV_FILE);
  if (appFileValue) {
    process.env[ENV_KEY] = appFileValue;
    return appFileValue;
  }

  return null;
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
      "Run: vex setup password --from-env  (then restart OpenClaw sessions)"
    );
  }
  return pw;
}
