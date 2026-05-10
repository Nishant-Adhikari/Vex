/**
 * Force-fresh keystore password resolution for wallet operations (M8).
 *
 * Per codex turn 8 RED #3: the engine's `getKeystorePassword()` (in
 * `src/utils/env.ts`) caches the file value into `process.env` after
 * the first call, and prefers `process.env` on subsequent calls. If
 * the file changes (e.g. M7 just wrote a new password), the next
 * engine call would read the stale cached value.
 *
 * Workaround without engine refactor: read the password directly from
 * `${CONFIG_DIR}/.env` via `readDotenvFileValue` BEFORE every wallet
 * operation, then OVERWRITE `process.env.VEX_KEYSTORE_PASSWORD` with
 * the fresh value. Engine's `requireKeystorePassword()` will then see
 * the freshest value (it reads `process.env` first).
 *
 * This module is the SINGLE place in vex-app main that mutates
 * `process.env.VEX_KEYSTORE_PASSWORD`. M7's keystore-writer never
 * touches process.env (writes file only). All wallet IPC handlers
 * route through this helper.
 */

import { readDotenvFileValue } from "@vex-lib/dotenv.js";
import { err, type Result, type VexError } from "@shared/ipc/result.js";
import { ENV_FILE } from "../paths/config-dir.js";

const KEYSTORE_ENV_KEY = "VEX_KEYSTORE_PASSWORD";

export interface FreshPasswordContext {
  readonly password: string;
}

/**
 * Read the current password from the shared `.env` file, force it
 * onto `process.env`, then run `fn`. Returns `err({code:"wallet.password_invalid"})`
 * if the file has no password (M7 not completed).
 *
 * The fn body sees both:
 *  - The fresh password as `ctx.password` (use this directly when
 *    calling the engine's lower-level `decryptPrivateKey`).
 *  - `process.env.VEX_KEYSTORE_PASSWORD` set to the fresh value, so
 *    engine helpers like `createWallet()` that internally call
 *    `requireKeystorePassword()` also see it.
 */
export async function withFreshKeystorePassword<T>(
  fn: (ctx: FreshPasswordContext) => Promise<T>
): Promise<T | Result<never, VexError>> {
  let fresh: string | null;
  try {
    fresh = readDotenvFileValue(KEYSTORE_ENV_KEY, ENV_FILE);
  } catch {
    fresh = null;
  }
  if (fresh === null || fresh.length === 0) {
    return err({
      code: "wallet.password_invalid",
      domain: "wallet",
      message: "Master password not configured. Complete Step 1 first.",
      retryable: false,
      userActionable: true,
      redacted: true,
    });
  }
  // Force-set process.env to the fresh file value for the engine
  // call, then DELETE it in `finally` (codex turn 10 NEEDS-WORK).
  // Restoring a prior `process.env` value would re-introduce the
  // exact stale-cache bug we're trying to fix: any engine helper
  // that runs AFTER this op (and doesn't itself route through
  // `withFreshKeystorePassword`) would see the old value instead
  // of the current file value. Deleting forces a fresh file read
  // on the next call site that uses env.ts's fallback chain
  // (`${CONFIG_DIR}/.env` is the source of truth).
  process.env[KEYSTORE_ENV_KEY] = fresh;
  try {
    return await fn({ password: fresh });
  } finally {
    delete process.env[KEYSTORE_ENV_KEY];
  }
}

/**
 * Type guard: when `withFreshKeystorePassword` short-circuits with
 * `err({code:"wallet.password_invalid"})`, the value is a `Result`
 * envelope (not the fn's return type). Callers narrow with this.
 */
export function isPasswordSetupError(
  value: unknown
): value is Result<never, VexError> {
  return (
    typeof value === "object" &&
    value !== null &&
    "ok" in value &&
    (value as { ok: unknown }).ok === false &&
    "error" in value
  );
}
