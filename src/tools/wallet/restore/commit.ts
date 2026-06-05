/**
 * Journaled commit + rollback for restore (crypto-sensitive: wallet keys).
 *
 * Phase 4 (COMMIT): records a preimage journal for every live target, then
 * applies the staged keystores, the sanitized `.env`, the vault, and one atomic
 * `saveConfig` inventory rebuild. ANY failure during apply triggers `rollback`,
 * which restores every journaled target to its preimage; the caller re-throws
 * the original error.
 *
 * Commit and rollback live in the SAME module on purpose: rollback depends on
 * the EXACT journal/preimage set produced here. Keeping them apart would risk
 * the two drifting and leaving the user's live wallets half-written.
 *
 * Engine/main only — never imported by the renderer. Throws `VexError`.
 */

import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { ENV_FILE, SECRETS_VAULT_FILE, CONFIG_FILE } from "../../../config/paths.js";
import {
  loadConfig,
  saveConfig,
  type WalletInventoryEntry,
} from "../../../config/store.js";
import { VexError, ErrorCodes } from "../../../errors.js";
import { minLogger as logger } from "../../../utils/logger-shim.js";
import { sanitizeDotenv } from "./env-sanitize.js";
import type { ValidatedManifest } from "./manifest.js";
import type { ValidatedWallet } from "./verify.js";

interface JournalEntry {
  readonly path: string;
  readonly existedBefore: boolean;
  readonly preimage: Buffer | null;
}

export interface CommitRestoreResult {
  readonly filesRestored: string[];
  readonly walletsRestored: WalletInventoryEntry[];
}

/**
 * Journaled apply of the restore. Writes staged keystores, sanitized `.env`,
 * vault, and one atomic inventory rebuild; on any apply failure rolls every
 * journaled target back to its preimage and re-throws the original error.
 */
export function commitRestore(
  validatedWallets: ValidatedWallet[],
  manifest: ValidatedManifest,
  stagingDir: string,
  backupDir: string | null,
): CommitRestoreResult {
  // ── Phase 4 — JOURNALED COMMIT with rollback ─────────────────────────────
  const journal: JournalEntry[] = [];
  const recordPreimage = (path: string): void => {
    const existedBefore = existsSync(path);
    journal.push({
      path,
      existedBefore,
      preimage: existedBefore ? readFileSync(path) : null,
    });
  };

  // Targets that Phase 4 writes directly (config goes via saveConfig).
  for (const w of validatedWallets) recordPreimage(w.livePath);
  const stagedEnv = manifest.files.find((f) => f.role === "env");
  if (stagedEnv) recordPreimage(ENV_FILE);
  const stagedVault = manifest.files.find((f) => f.role === "vault");
  if (stagedVault) recordPreimage(SECRETS_VAULT_FILE);
  recordPreimage(CONFIG_FILE);

  const filesRestored: string[] = [];
  let walletsRestored: WalletInventoryEntry[] = [];

  try {
    // 4a. Write each staged keystore to its live derived path.
    for (const w of validatedWallets) {
      const bytes = readFileSync(join(stagingDir, w.stagedFilename));
      writeFileSync(w.livePath, bytes, { mode: 0o600 });
      filesRestored.push(w.stagedFilename);
    }

    // 4b. Sanitized .env — drop every MANAGED secret line.
    if (stagedEnv) {
      const rawEnv = readFileSync(join(stagingDir, stagedEnv.filename), "utf-8");
      writeFileSync(ENV_FILE, sanitizeDotenv(rawEnv), { mode: 0o600 });
      filesRestored.push(stagedEnv.filename);
    }

    // 4c. Vault verbatim from staging.
    if (stagedVault) {
      const bytes = readFileSync(join(stagingDir, stagedVault.filename));
      writeFileSync(SECRETS_VAULT_FILE, bytes, { mode: 0o600 });
      filesRestored.push(stagedVault.filename);
    }

    // 4d. Rebuild inventory in-memory, then ONE atomic saveConfig.
    const cfg = loadConfig();
    cfg.wallet.evm = [];
    cfg.wallet.solana = [];
    for (const w of validatedWallets) {
      const entry: WalletInventoryEntry = {
        id: w.id,
        address: w.address,
        label: w.label,
        createdAt: w.createdAt,
        ...(w.legacy ? { legacy: true } : {}),
      };
      cfg.wallet[w.family].push(entry);
    }
    saveConfig(cfg);
    walletsRestored = [...cfg.wallet.evm, ...cfg.wallet.solana];
  } catch (applyErr) {
    rollback(journal, backupDir);
    throw applyErr;
  }

  return { filesRestored, walletsRestored };
}

/**
 * Restore every journaled target to its preimage. On a clean rollback the
 * caller re-throws the original error. If rollback itself fails on any path we
 * escalate to ARCHIVE_RESTORE_FAILED naming the incomplete paths + backup dir.
 */
function rollback(journal: JournalEntry[], backupDir: string | null): void {
  const failed: string[] = [];
  // Reverse order: undo last writes first.
  for (let i = journal.length - 1; i >= 0; i -= 1) {
    const entry = journal[i]!;
    try {
      if (entry.existedBefore && entry.preimage) {
        writeFileSync(entry.path, entry.preimage);
      } else if (!entry.existedBefore && existsSync(entry.path)) {
        unlinkSync(entry.path);
      }
    } catch (err) {
      logger.error(
        `Rollback failed for ${entry.path}: ${err instanceof Error ? err.message : String(err)}`,
      );
      failed.push(entry.path);
    }
  }
  if (failed.length > 0) {
    const recovery = backupDir
      ? `Recover from the pre-restore backup at ${backupDir}.`
      : "No pre-restore backup was created (the install had no prior state).";
    throw new VexError(
      ErrorCodes.ARCHIVE_RESTORE_FAILED,
      `Restore failed AND rollback could not fully restore: ${failed.join(", ")}. ${recovery}`,
    );
  }
}
