/**
 * POSIX secret adapter — write plaintext file with mode 0o600 in a
 * directory with mode 0o700. No DPAPI / safeStorage involvement; the
 * compose `pg_password.file:` reference points directly at the target.
 *
 * Used by macOS, Linux, and the vex-shell tsx CLI.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import type { SecretAdapter } from "./render.js";

export const posixSecretAdapter: SecretAdapter = {
  async write(targetPath, value) {
    const dir = path.dirname(targetPath);
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    const tempPath = `${targetPath}.tmp-${process.pid}-${Date.now()}`;
    await fs.writeFile(tempPath, value, { encoding: "utf8", mode: 0o600 });
    await fs.rename(tempPath, targetPath);
    return { composePath: targetPath };
  },

  async read(targetPath) {
    try {
      const value = await fs.readFile(targetPath, "utf8");
      return value.length > 0 ? value : null;
    } catch (err: unknown) {
      if (
        err &&
        typeof err === "object" &&
        "code" in err &&
        (err as { code: unknown }).code === "ENOENT"
      ) {
        return null;
      }
      throw err;
    }
  },

  async cleanup() {
    // POSIX has no transient artifacts — the secret IS the file.
  },

  async bootCleanup() {
    // POSIX has no transient artifacts.
  },
};
