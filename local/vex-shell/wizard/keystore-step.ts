/**
 * Keystore password — unlock or create the encrypted Vex secret vault.
 */

import { password, isCancel, log } from "@clack/prompts";
import { synchronizeTrackedEnv } from "../../../src/cli/setup/setup.js";
import {
  applySecretVaultToProcessEnv,
  createSecretVault,
  secretVaultExists,
  stripManagedSecretsFromDotenvFile,
  unlockSecretVault,
} from "../../../src/lib/local-secret-vault.js";
import { MASTER_PASSWORD_ENV_KEY } from "../../../src/lib/secret-keys.js";

const MIN_PASSWORD_LENGTH = 8;

export interface KeystoreOutcome {
  aborted: boolean;
  wasMissing: boolean;
}

export async function runKeystoreStep(): Promise<KeystoreOutcome> {
  const existing = process.env[MASTER_PASSWORD_ENV_KEY]?.trim();
  if (existing) {
    process.env[MASTER_PASSWORD_ENV_KEY] = existing;
    if (secretVaultExists()) applySecretVaultToProcessEnv(existing);
    stripManagedSecretsFromDotenvFile();
    log.info("Keystore password already configured.");
    return { aborted: false, wasMissing: false };
  }

  if (secretVaultExists()) {
    log.step("Unlock Vex");
    while (true) {
      const input = await password({
        message: "Enter master password",
        validate: (value) => {
          if (!value || value.length < MIN_PASSWORD_LENGTH) {
            return `At least ${MIN_PASSWORD_LENGTH} characters required.`;
          }
          return undefined;
        },
      });
      if (isCancel(input)) return { aborted: true, wasMissing: false };
      try {
        unlockSecretVault(input);
        process.env[MASTER_PASSWORD_ENV_KEY] = input;
        applySecretVaultToProcessEnv(input);
        stripManagedSecretsFromDotenvFile();
        synchronizeTrackedEnv();
        log.success("Secret vault unlocked.");
        return { aborted: false, wasMissing: false };
      } catch {
        log.warn("Password could not unlock the Vex secret vault.");
      }
    }
  }

  log.step("Keystore password");
  log.info(
    "Create the password that will protect and unlock your local EVM and Solana keystores. Minimum 8 characters.",
  );

  while (true) {
    const first = await password({
      message: "Enter VEX_KEYSTORE_PASSWORD",
      validate: (value) => {
        if (!value || value.length < MIN_PASSWORD_LENGTH) {
          return `At least ${MIN_PASSWORD_LENGTH} characters required.`;
        }
        return undefined;
      },
    });
    if (isCancel(first)) return { aborted: true, wasMissing: true };

    const confirm = await password({
      message: "Confirm VEX_KEYSTORE_PASSWORD",
      validate: (value) => (value === first ? undefined : "Passwords do not match."),
    });
    if (isCancel(confirm)) return { aborted: true, wasMissing: true };

    createSecretVault(first);
    stripManagedSecretsFromDotenvFile();
    process.env[MASTER_PASSWORD_ENV_KEY] = first;
    synchronizeTrackedEnv();
    log.success("Created encrypted Vex secret vault.");
    return { aborted: false, wasMissing: true };
  }
}
