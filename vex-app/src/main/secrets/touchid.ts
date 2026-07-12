/**
 * Touch ID unlock — OPT-IN, macOS only. OFF by default.
 *
 * SECURITY MODEL (read before touching this): enabling Touch ID stores the vault
 * master password ENCRYPTED via Electron `safeStorage` (its key lives in the
 * macOS login keychain, tied to the OS account) and releases it after an
 * APP-LEVEL `systemPreferences.promptTouchID`. This is a CONVENIENCE tier, not a
 * hardware guarantee:
 *   - it protects a logged-in-but-away Mac (someone who can't pass Touch ID
 *     cannot unlock Vex), but
 *   - it does NOT protect against code running as the same macOS user (which
 *     could skip the prompt and `safeStorage.decryptString` the file directly).
 * It deliberately trades away the "master password never on disk" guarantee, so
 * it is only ever active when the user explicitly enables it.
 *
 * All effects (crypto, biometric prompt, filesystem, session unlock) are behind
 * an injected `TouchIdDeps`, so the branching logic is unit-tested with no
 * Electron and no disk.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { SECRETS_DIR } from "../paths/config-dir.js";

/** The safeStorage-encrypted master password lives here (0600), next to pg_password. */
export const TOUCHID_FILE = path.join(SECRETS_DIR, "touchid.bin");
export const TOUCHID_PROMPT_REASON = "unlock Vex";

export interface TouchIdDeps {
  /** macOS + Touch ID hardware present AND safeStorage encryption available. */
  supported(): boolean;
  encrypt(plain: string): Buffer;
  decrypt(cipher: Buffer): string;
  /** Rejects if the fingerprint prompt is cancelled/failed. */
  promptBiometric(reason: string): Promise<void>;
  /** The live in-memory master password (present only while the vault is unlocked). */
  currentUnlockedPassword(): string | null;
  /** Feed a recovered password to the existing unlock; true iff it unlocked. */
  unlockSession(password: string): boolean;
  readCipher(): Promise<Buffer | null>;
  writeCipher(cipher: Buffer): Promise<void>;
  removeCipher(): Promise<void>;
}

export interface TouchIdStatus {
  readonly supported: boolean;
  readonly enabled: boolean;
}

export async function getTouchIdStatus(deps: TouchIdDeps): Promise<TouchIdStatus> {
  const enabled = (await deps.readCipher()) !== null;
  return { supported: deps.supported(), enabled };
}

export type EnableResult = { ok: true } | { ok: false; reason: "unsupported" | "locked" };

/**
 * Enroll: persist the CURRENTLY-unlocked password, safeStorage-encrypted. The
 * vault must be unlocked (that's the only place the password lives) — enrolment
 * is driven from Settings after the user has unlocked.
 */
export async function enableTouchId(deps: TouchIdDeps): Promise<EnableResult> {
  if (!deps.supported()) return { ok: false, reason: "unsupported" };
  const password = deps.currentUnlockedPassword();
  if (password === null || password.length === 0) return { ok: false, reason: "locked" };
  await deps.writeCipher(deps.encrypt(password));
  return { ok: true };
}

export async function disableTouchId(deps: TouchIdDeps): Promise<void> {
  await deps.removeCipher();
}

export type TouchIdUnlockReason =
  | "unsupported" | "not_enrolled" | "biometric_failed" | "decrypt_failed" | "bad_secret";
export interface TouchIdUnlockResult {
  readonly unlocked: boolean;
  readonly reason?: TouchIdUnlockReason;
}

/**
 * Unlock: gate on the fingerprint FIRST, then decrypt the stored password and
 * hand it to the normal unlock. Never decrypts before the biometric passes.
 */
export async function unlockWithTouchId(deps: TouchIdDeps): Promise<TouchIdUnlockResult> {
  if (!deps.supported()) return { unlocked: false, reason: "unsupported" };
  const cipher = await deps.readCipher();
  if (cipher === null) return { unlocked: false, reason: "not_enrolled" };

  try {
    await deps.promptBiometric(TOUCHID_PROMPT_REASON);
  } catch {
    return { unlocked: false, reason: "biometric_failed" };
  }

  let password: string;
  try {
    password = deps.decrypt(cipher);
  } catch {
    return { unlocked: false, reason: "decrypt_failed" };
  }

  return deps.unlockSession(password)
    ? { unlocked: true }
    : { unlocked: false, reason: "bad_secret" };
}

// ── Production wiring (Electron) ──────────────────────────────────────────────

/** Real deps: Electron safeStorage + Touch ID, the secrets session, and the file. */
export function productionTouchIdDeps(): TouchIdDeps {
  return {
    supported: () => {
      if (process.platform !== "darwin") return false;
      // Lazy-require so the module stays importable in unit tests without Electron.
      const { safeStorage, systemPreferences } = require("electron") as typeof import("electron");
      try {
        return (
          typeof systemPreferences.canPromptTouchID === "function"
          && systemPreferences.canPromptTouchID()
          && safeStorage.isEncryptionAvailable()
        );
      } catch {
        return false;
      }
    },
    encrypt: (plain) => {
      const { safeStorage } = require("electron") as typeof import("electron");
      return safeStorage.encryptString(plain);
    },
    decrypt: (cipher) => {
      const { safeStorage } = require("electron") as typeof import("electron");
      return safeStorage.decryptString(cipher);
    },
    promptBiometric: async (reason) => {
      const { systemPreferences } = require("electron") as typeof import("electron");
      await systemPreferences.promptTouchID(reason);
    },
    currentUnlockedPassword: () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { getUnlockedMasterPassword } = require("./session.js") as typeof import("./session.js");
      return getUnlockedMasterPassword();
    },
    unlockSession: (password) => {
      const { unlockSecretSession } = require("./session.js") as typeof import("./session.js");
      return unlockSecretSession(password).ok;
    },
    readCipher: async () => {
      try {
        return await fs.readFile(TOUCHID_FILE);
      } catch {
        return null;
      }
    },
    writeCipher: async (cipher) => {
      await fs.mkdir(SECRETS_DIR, { recursive: true });
      await fs.writeFile(TOUCHID_FILE, cipher, { mode: 0o600 });
    },
    removeCipher: async () => {
      await fs.rm(TOUCHID_FILE, { force: true });
    },
  };
}
