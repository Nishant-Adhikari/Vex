import { existsSync } from "node:fs";
import { SECRETS_VAULT_FILE } from "../../config/paths.js";
import type { VaultSecretKey } from "../secret-keys.js";
import type { VAULT_VERSION } from "./crypto.js";

export interface LocalSecretVaultOptions {
  readonly filePath?: string;
}

export interface LocalSecretVaultStatus {
  readonly configured: boolean;
}

export interface LocalSecretVaultContents {
  readonly version: typeof VAULT_VERSION;
  readonly secrets: Partial<Record<VaultSecretKey, string>>;
  /**
   * Secret keys this build does not recognize (written by a newer build).
   * Preserved on read so an unrecognized key never fails a correct password,
   * and round-tripped on the next write so an older-build write cannot
   * silently strip them.
   */
  readonly extraSecrets?: Readonly<Record<string, string>>;
}

export class LocalSecretVaultError extends Error {
  constructor(
    message: string,
    /**
     * - `invalid_password` — the GCM auth-tag check at decipher.final()
     *   failed (wrong password or tampered ciphertext; indistinguishable).
     *   This is the ONLY code the unlock throttle may advance on.
     * - `corrupt` — the envelope, KDF params, or decrypted plaintext are
     *   structurally invalid (before crypto, or after authentication).
     * - `unavailable` — a crypto-runtime/allocation failure (scrypt, cipher
     *   setup, post-auth decode) — the vault may be perfectly fine; RETRY.
     * - `incompatible` — the vault (outer envelope OR inner contents) was
     *   written by a newer build. The outer check fires BEFORE decryption,
     *   so this does NOT always imply the password was verified.
     * - `missing` / `io` — vault file absence / filesystem errors.
     */
    readonly code: "missing" | "invalid_password" | "corrupt" | "io" | "incompatible" | "unavailable",
    // `override`: shadows Error.cause (lib ES2022+); explicit for
    // vex-app's noImplicitOverride typecheck profile.
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = "LocalSecretVaultError";
  }
}

export function resolveVaultPath(options: LocalSecretVaultOptions): string {
  return options.filePath ?? SECRETS_VAULT_FILE;
}

export function secretVaultExists(options: LocalSecretVaultOptions = {}): boolean {
  return existsSync(resolveVaultPath(options));
}

export function getSecretVaultStatus(
  options: LocalSecretVaultOptions = {},
): LocalSecretVaultStatus {
  return { configured: secretVaultExists(options) };
}
