import { ENV_FILE } from "../../config/paths.js";
import { removeFromDotenvFile } from "../../utils/dotenv.js";
import { MANAGED_SECRET_ENV_KEYS, VAULT_SECRET_KEYS } from "../secret-keys.js";
import type { LocalSecretVaultContents, LocalSecretVaultOptions } from "./status.js";
import { unlockSecretVault } from "./lifecycle.js";

export function applySecretVaultToProcessEnv(
  password: string,
  options: LocalSecretVaultOptions = {},
): LocalSecretVaultContents {
  const contents = unlockSecretVault(password, options);
  for (const key of VAULT_SECRET_KEYS) {
    const value = contents.secrets[key];
    if (value) process.env[key] = value;
    else delete process.env[key];
  }
  return contents;
}

export function stripManagedSecretsFromDotenvFile(envPath = ENV_FILE): void {
  for (const key of MANAGED_SECRET_ENV_KEYS) {
    removeFromDotenvFile(key, envPath);
  }
}
