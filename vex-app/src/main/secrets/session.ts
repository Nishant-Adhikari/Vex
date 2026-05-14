import {
  applySecretVaultToProcessEnv,
  createSecretVault,
  getSecretVaultStatus,
  LocalSecretVaultError,
  stripManagedSecretsFromDotenvFile,
  unlockSecretVault,
  writeSecretVaultSecrets,
} from "@vex-lib/local-secret-vault.js";
import {
  MASTER_PASSWORD_ENV_KEY,
  VAULT_SECRET_KEYS,
  type VaultSecretKey,
} from "@vex-lib/secret-keys.js";
import { err, ok, type Result } from "@shared/ipc/result.js";
import { ENV_FILE, SECRETS_VAULT_FILE } from "../paths/config-dir.js";
import { log } from "../logger/index.js";

let unlockedMasterPassword: string | null = null;

export interface SecretSessionStatus {
  readonly vaultConfigured: boolean;
  readonly unlocked: boolean;
}

export interface SecretPresence {
  readonly vaultConfigured: boolean;
  readonly unlocked: boolean;
  readonly secrets: Partial<Record<VaultSecretKey, boolean>>;
}

function toPublicError(cause: unknown): Result<never> {
  if (cause instanceof LocalSecretVaultError && cause.code === "invalid_password") {
    return err({
      code: "wallet.password_invalid",
      domain: "wallet",
      message: "Master password is incorrect.",
      retryable: true,
      userActionable: true,
      redacted: true,
    });
  }

  if (cause instanceof LocalSecretVaultError && cause.code === "missing") {
    return err({
      code: "wallet.vault_not_configured",
      domain: "wallet",
      message: "Master password is not configured. Complete setup first.",
      retryable: false,
      userActionable: true,
      redacted: true,
    });
  }

  log.error("[secrets-session] secret vault operation failed", cause);
  return err({
    code: "onboarding.env_persist_failed",
    domain: "onboarding",
    message: "Could not access the encrypted secret vault. Check disk permissions and retry.",
    retryable: true,
    userActionable: true,
    redacted: true,
  });
}

function applyUnlockedRuntime(password: string): void {
  applySecretVaultToProcessEnv(password, { filePath: SECRETS_VAULT_FILE });
  delete process.env[MASTER_PASSWORD_ENV_KEY];
}

export function getSecretSessionStatus(): SecretSessionStatus {
  return {
    vaultConfigured: getSecretVaultStatus({ filePath: SECRETS_VAULT_FILE }).configured,
    unlocked: unlockedMasterPassword !== null,
  };
}

export function initializeMasterPassword(
  password: string,
): Result<{ readonly kind: "set" | "unchanged" }> {
  try {
    const existed = getSecretVaultStatus({ filePath: SECRETS_VAULT_FILE }).configured;
    createSecretVault(password, { filePath: SECRETS_VAULT_FILE });
    unlockedMasterPassword = password;
    applyUnlockedRuntime(password);
    stripManagedSecretsFromDotenvFile(ENV_FILE);
    return ok({ kind: existed ? "unchanged" : "set" });
  } catch (cause) {
    return toPublicError(cause);
  }
}

export function unlockSecretSession(
  password: string,
): Result<{ readonly unlocked: true }> {
  try {
    unlockSecretVault(password, { filePath: SECRETS_VAULT_FILE });
    unlockedMasterPassword = password;
    applyUnlockedRuntime(password);
    stripManagedSecretsFromDotenvFile(ENV_FILE);
    return ok({ unlocked: true });
  } catch (cause) {
    return toPublicError(cause);
  }
}

/**
 * Best-effort in-process scrub of the cached master password. JS strings are
 * immutable so we cannot zero the underlying buffer; nulling the reference is
 * the strongest in-process defense. Invoked from quit hooks + the explicit
 * `vex:secrets:lock` IPC channel.
 */
export function lockSecretSession(): void {
  unlockedMasterPassword = null;
  // Encourage GC so the residual string is more likely to be collected before
  // a crash dump captures it. `global.gc` only exists when launched with
  // `--expose-gc`; this is best-effort, not a guarantee.
  if (typeof global.gc === "function") global.gc();
}

export function requireUnlockedMasterPassword(): Result<string> {
  if (unlockedMasterPassword !== null) return ok(unlockedMasterPassword);
  return err({
    code: "wallet.keystore_locked",
    domain: "wallet",
    message: "Unlock Vex with your master password before using wallets or secrets.",
    retryable: false,
    userActionable: true,
    redacted: true,
  });
}

export function writeUnlockedSecrets(
  updates: Partial<Record<VaultSecretKey, string | null>>,
): Result<void> {
  const passwordResult = requireUnlockedMasterPassword();
  if (!passwordResult.ok) return passwordResult;

  try {
    writeSecretVaultSecrets(passwordResult.data, updates, {
      filePath: SECRETS_VAULT_FILE,
    });
    applyUnlockedRuntime(passwordResult.data);
    stripManagedSecretsFromDotenvFile(ENV_FILE);
    return ok(undefined);
  } catch (cause) {
    return toPublicError(cause);
  }
}

export function getUnlockedSecretPresence(): SecretPresence {
  const status = getSecretSessionStatus();
  const secrets: Partial<Record<VaultSecretKey, boolean>> = {};
  if (!status.vaultConfigured || unlockedMasterPassword === null) {
    return { ...status, secrets };
  }

  try {
    const contents = unlockSecretVault(unlockedMasterPassword, {
      filePath: SECRETS_VAULT_FILE,
    });
    for (const key of VAULT_SECRET_KEYS) {
      secrets[key] = Boolean(contents.secrets[key]);
    }
    return { ...status, secrets };
  } catch (cause) {
    log.warn("[secrets-session] presence probe failed; locking vault", cause);
    unlockedMasterPassword = null;
    return { vaultConfigured: status.vaultConfigured, unlocked: false, secrets: {} };
  }
}
