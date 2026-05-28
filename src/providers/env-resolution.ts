/**
 * Provider-neutral env resolution.
 *
 * `.env` is reserved for non-secret runtime configuration. Secrets are
 * loaded only from the current process environment, which the desktop app
 * and shell populate after unlocking the encrypted local vault.
 */

import { ENV_FILE } from "../config/paths.js";
import {
  MANAGED_SECRET_ENV_KEYS,
  isManagedSecretEnvKey,
} from "../lib/secret-keys.js";
import {
  appendToDotenvFile,
  loadDotenvFileIntoProcess,
  readDotenvFileValue,
  removeFromDotenvFile,
} from "../utils/dotenv.js";

/**
 * Read a single value from a .env file.
 * Handles double-quoted values.
 */
export function readEnvValue(key: string, envPath: string): string | null {
  if (isManagedSecretEnvKey(key)) {
    const value = process.env[key]?.trim();
    return value ? value : null;
  }
  return readDotenvFileValue(key, envPath);
}

/**
 * Load provider-neutral dotenv at runtime startup.
 * Loads from app-specific .env only.
 */
export function loadProviderDotenv(options: { overwrite?: boolean } = {}): void {
  loadDotenvFileIntoProcess(ENV_FILE, {
    shouldLoadKey: (key) => !isManagedSecretEnvKey(key),
    overwrite: options.overwrite ?? false,
  });
}

export function writeAppEnvValue(key: string, value: string): string {
  if (isManagedSecretEnvKey(key)) {
    throw new Error(`${key} is managed by the encrypted Vex secret vault.`);
  }
  for (const secretKey of MANAGED_SECRET_ENV_KEYS) {
    removeFromDotenvFile(secretKey, ENV_FILE);
  }
  return appendToDotenvFile(key, value, ENV_FILE);
}
