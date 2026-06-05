/**
 * Mandatory pre-restore backup gate (crypto-sensitive).
 *
 * Phase 3 (BACKUP — HARD GATE): if there is ANY current state a restore would
 * overwrite, a successful, USABLE snapshot of that state is REQUIRED before any
 * live write. A null return, a pruned/missing backup dir, an unreadable backup
 * manifest, or an un-captured orphan fixed legacy keystore all abort the
 * restore (AUTO_BACKUP_FAILED). Only a genuinely empty install (nothing to
 * lose) may proceed without a backup.
 *
 * Engine/main only — never imported by the renderer. Throws `VexError`.
 */

import { existsSync } from "node:fs";

import {
  CONFIG_FILE,
  ENV_FILE,
  KEYSTORE_FILE,
  SECRETS_VAULT_FILE,
  SOLANA_KEYSTORE_FILE,
} from "../../../config/paths.js";
import { VexError, ErrorCodes } from "../../../errors.js";
import type { VexConfig } from "../../../config/store.js";
import { autoBackup, readArchiveManifest } from "../backup.js";
import { derivePath } from "../inventory.js";

/**
 * Run the mandatory pre-restore backup hard gate. Takes the config loaded
 * during validation (used for the inventory existence walk) and returns the
 * pre-restore backup dir (null only when the install had no prior state).
 */
export async function runPreRestoreBackupGate(currentCfg: VexConfig): Promise<string | null> {
  // ── Phase 3 — MANDATORY backup of current state (HARD GATE) ──────────────
  // Is there any current state we'd be overwriting? If so, a successful
  // snapshot is REQUIRED before any live write — a null return or a pruned/
  // missing backup dir must abort. Only a genuinely empty install (nothing to
  // lose) may proceed without a backup.
  // Fixed legacy keystores count as current state even when they are NOT in
  // the inventory (orphan) — restore could still overwrite them.
  const hasFixedEvm = existsSync(KEYSTORE_FILE);
  const hasFixedSolana = existsSync(SOLANA_KEYSTORE_FILE);
  const hasCurrentState =
    existsSync(CONFIG_FILE) ||
    existsSync(SECRETS_VAULT_FILE) ||
    existsSync(ENV_FILE) ||
    hasFixedEvm ||
    hasFixedSolana ||
    (["evm", "solana"] as const).some((fam) =>
      currentCfg.wallet[fam].some((e) => {
        try {
          return existsSync(derivePath(fam, e));
        } catch {
          return false;
        }
      }),
    );
  let backupDir: string | null;
  try {
    backupDir = await autoBackup();
  } catch (err) {
    throw new VexError(
      ErrorCodes.AUTO_BACKUP_FAILED,
      "Could not snapshot current wallets before restore; aborted to protect existing wallets.",
      err instanceof Error ? err.message : String(err),
    );
  }
  const BACKUP_GATE_MSG =
    "Could not snapshot current wallets before restore; aborted to protect existing wallets.";
  if (hasCurrentState) {
    // Inline throws (not a helper) so TS narrows backupDir to string below.
    if (backupDir === null) {
      throw new VexError(
        ErrorCodes.AUTO_BACKUP_FAILED,
        BACKUP_GATE_MSG,
        "autoBackup produced no archive despite existing state.",
      );
    }
    if (!existsSync(backupDir)) {
      throw new VexError(
        ErrorCodes.AUTO_BACKUP_FAILED,
        BACKUP_GATE_MSG,
        `pre-restore backup dir is missing: ${backupDir}`,
      );
    }
    // The snapshot must be USABLE (manifest parses), not merely a directory.
    let backupManifest: ReturnType<typeof readArchiveManifest>;
    try {
      backupManifest = readArchiveManifest(backupDir);
    } catch (err) {
      throw new VexError(
        ErrorCodes.AUTO_BACKUP_FAILED,
        BACKUP_GATE_MSG,
        `pre-restore backup manifest is unreadable: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    // An ORPHAN fixed legacy keystore (on disk but absent from inventory) is
    // not captured by autoBackup's inventory walk. Refuse to overwrite a
    // keystore we could not snapshot.
    const backedUpRoles = new Set(
      backupManifest.version === 2 ? backupManifest.files.map((f) => f.role) : [],
    );
    if (hasFixedEvm && !backedUpRoles.has("legacy-evm")) {
      throw new VexError(
        ErrorCodes.AUTO_BACKUP_FAILED,
        BACKUP_GATE_MSG,
        "a fixed EVM keystore (keystore.json) exists on disk but was not captured in the pre-restore backup (orphan / not in inventory); resolve it before restoring.",
      );
    }
    if (hasFixedSolana && !backedUpRoles.has("legacy-solana")) {
      throw new VexError(
        ErrorCodes.AUTO_BACKUP_FAILED,
        BACKUP_GATE_MSG,
        "a fixed Solana keystore (solana-keystore.json) exists on disk but was not captured in the pre-restore backup; resolve it before restoring.",
      );
    }
  }

  return backupDir;
}
