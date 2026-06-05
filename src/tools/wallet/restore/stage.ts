/**
 * Staging directory lifecycle for restore (crypto-sensitive).
 *
 * Phase 2 (STAGE): copies the validated archive bytes into a private,
 * per-run staging directory under CONFIG_DIR. Secret files (vault + keystores)
 * are written with mode 0o600. Staging happens BEFORE the pre-restore backup so
 * retention pruning during that backup cannot delete the source archive out
 * from under us. The caller owns staging-dir cleanup in a `finally`.
 *
 * Engine/main only — never imported by the renderer.
 */

import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { CONFIG_DIR } from "../../../config/paths.js";
import type { ValidatedManifest } from "./manifest.js";

/** Create a fresh private staging dir for this restore run. */
export function createStagingDir(): string {
  const stagingDir = join(CONFIG_DIR, `.restore-${randomUUID()}`);
  mkdirSync(stagingDir, { recursive: true });
  return stagingDir;
}

/**
 * Copy every validated archive file into the staging dir. Secret files (vault +
 * keystores) get mode 0o600; everything else is written with default mode.
 */
export function stageArchiveFiles(
  manifest: ValidatedManifest,
  resolved: string,
  stagingDir: string,
): void {
  for (const file of manifest.files) {
    const stagedPath = join(stagingDir, file.filename);
    const bytes = readFileSync(join(resolved, file.filename));
    const secret =
      file.role === "vault" ||
      file.role === "wallet-evm" ||
      file.role === "wallet-solana" ||
      file.role === "legacy-evm" ||
      file.role === "legacy-solana";
    writeFileSync(stagedPath, bytes, secret ? { mode: 0o600 } : undefined);
  }
}
