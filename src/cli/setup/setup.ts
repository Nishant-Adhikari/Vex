import { REQUIRED_ENV } from "../../mcp/bootstrap.js";
import { loadProviderDotenv, writeAppEnvValue } from "../../providers/env-resolution.js";
import { VexError, ErrorCodes } from "../../errors.js";
import { writeStderr } from "../../utils/output.js";
import {
  applySecretVaultToProcessEnv,
  createSecretVault,
  secretVaultExists,
  stripManagedSecretsFromDotenvFile,
  unlockSecretVault,
  writeSecretVaultSecrets,
} from "../../lib/local-secret-vault.js";
import { MASTER_PASSWORD_ENV_KEY } from "../../lib/secret-keys.js";
import { getEnvExamplePath } from "./package-assets.js";
import { readAppEnvMap } from "./status.js";
import { promptSecret, renderSection } from "./ui.js";
import { JUPITER_API_KEY_GUIDANCE } from "./api-key-guidance.js";

const LOCAL_DEFAULT_ENV_KEYS = REQUIRED_ENV.filter((key) => key !== "JUPITER_API_KEY");
const TRACKED_ENV_KEYS = REQUIRED_ENV.filter((key) => key !== "JUPITER_API_KEY");

function readBundledEnvDefaults(): Record<string, string> {
  return readAppEnvMap(getEnvExamplePath());
}

export function synchronizeTrackedEnv(): void {
  const envMap = readAppEnvMap();

  for (const key of TRACKED_ENV_KEYS) {
    const value = envMap[key];
    if (value !== undefined) {
      process.env[key] = value;
    }
  }

  loadProviderDotenv();
}

export function ensureRequiredEnvDefaults(): void {
  const current = readAppEnvMap();
  const defaults = readBundledEnvDefaults();

  for (const key of LOCAL_DEFAULT_ENV_KEYS) {
    if ((current[key] ?? "").trim()) {
      continue;
    }

    const fallback = defaults[key];
    if (!fallback) {
      throw new VexError(
        ErrorCodes.SYSTEM_CHECK_FAILED,
        `Bundled default for ${key} is missing.`,
        "The published package must include docker/vex-agent/.env.example with the required local defaults.",
      );
    }

    writeAppEnvValue(key, fallback);
    process.env[key] = fallback;
    writeStderr(`Configured ${key} from bundled local defaults.`);
  }
}

export async function ensureJupiterApiKey(): Promise<void> {
  await ensureKeystorePassword();
  const envMap = readAppEnvMap();
  const existingKey = envMap.JUPITER_API_KEY?.trim();

  if (existingKey) {
    process.env.JUPITER_API_KEY = existingKey;
    return;
  }

  renderSection(
    "Jupiter API Key",
    JUPITER_API_KEY_GUIDANCE,
  );

  while (true) {
    const apiKey = await promptSecret("Enter JUPITER_API_KEY");
    if (!apiKey.trim()) {
      writeStderr("JUPITER_API_KEY cannot be empty.");
      continue;
    }

    writeSecretVaultSecrets(requireUnlockedSetupPassword(), {
      JUPITER_API_KEY: apiKey.trim(),
    });
    stripManagedSecretsFromDotenvFile();
    process.env.JUPITER_API_KEY = apiKey.trim();
    writeStderr("Stored JUPITER_API_KEY in the encrypted Vex secret vault.");
    return;
  }
}

export async function ensureKeystorePassword(): Promise<void> {
  const existingPassword = process.env[MASTER_PASSWORD_ENV_KEY]?.trim();

  if (existingPassword) {
    if (secretVaultExists()) applySecretVaultToProcessEnv(existingPassword);
    process.env[MASTER_PASSWORD_ENV_KEY] = existingPassword;
    return;
  }

  if (secretVaultExists()) {
    renderSection("Password", "Unlock the encrypted Vex secret vault.");
    while (true) {
      const password = await promptSecret("Enter master password");
      try {
        unlockSecretVault(password);
        process.env[MASTER_PASSWORD_ENV_KEY] = password;
        applySecretVaultToProcessEnv(password);
        stripManagedSecretsFromDotenvFile();
        return;
      } catch {
        writeStderr("Password could not unlock the Vex secret vault.");
      }
    }
  }

  renderSection(
    "Password",
    "Create the password that will protect and unlock your local EVM and Solana keystores.",
  );

  while (true) {
    const password = await promptSecret("Enter VEX_KEYSTORE_PASSWORD");
    if (password.length < 8) {
      writeStderr("Password must be at least 8 characters long.");
      continue;
    }

    const confirmation = await promptSecret("Confirm VEX_KEYSTORE_PASSWORD");
    if (password !== confirmation) {
      writeStderr("Passwords do not match. Try again.");
      continue;
    }

    createSecretVault(password);
    stripManagedSecretsFromDotenvFile();
    process.env[MASTER_PASSWORD_ENV_KEY] = password;
    writeStderr("Created encrypted Vex secret vault.");
    return;
  }
}

function requireUnlockedSetupPassword(): string {
  const password = process.env[MASTER_PASSWORD_ENV_KEY]?.trim();
  if (!password) {
    throw new VexError(
      ErrorCodes.KEYSTORE_PASSWORD_NOT_SET,
      "Vex secret vault is locked.",
      "Unlock Vex with your master password before writing secrets.",
    );
  }
  return password;
}
