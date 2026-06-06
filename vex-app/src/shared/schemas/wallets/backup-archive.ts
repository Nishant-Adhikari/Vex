/**
 * walletListBackups / walletRestoreArchive (C2 — full-archive restore) and
 * walletOpenBackupFolder (open a previously-created backup dir in the OS
 * file manager).
 *
 * listBackups returns metadata ONLY (no secrets, no absolute paths). `id` is
 * the opaque backup-dir basename the C1 primitive re-resolves under
 * BACKUPS_DIR — the renderer never receives or sends a filesystem path.
 *
 * restoreArchive takes that opaque `id` + the master password. The result
 * carries `filesRestored` (basenames) + `walletsRestored` (public inventory
 * metadata, NO key material) + `vaultLocked`. The C1 primitive's absolute
 * `backupDir` is deliberately NOT surfaced over IPC (metadata-only boundary).
 */

import { z } from "zod";

// ── walletListBackups / walletRestoreArchive (C2 — full-archive restore) ─────
export const walletListBackupsInputSchema = z.object({}).strict();
export type WalletListBackupsInput = z.infer<typeof walletListBackupsInputSchema>;

export const walletAvailableBackupSchema = z
  .object({
    id: z.string().min(1),
    timestamp: z.string(),
    walletCount: z.number().int().nonnegative(),
    addresses: z.array(z.string()),
    vaultIncluded: z.boolean(),
    envIncluded: z.boolean(),
  })
  .strict();
export type WalletAvailableBackup = z.infer<typeof walletAvailableBackupSchema>;

export const walletListBackupsResultSchema = z
  .object({ backups: z.array(walletAvailableBackupSchema) })
  .strict();
export type WalletListBackupsResult = z.infer<typeof walletListBackupsResultSchema>;

export const walletRestoreArchiveInputSchema = z
  .object({
    // Opaque backup id from listBackups (a directory basename) — NOT a path.
    id: z.string().min(1),
    password: z.string().min(1),
  })
  .strict();
export type WalletRestoreArchiveInput = z.infer<
  typeof walletRestoreArchiveInputSchema
>;

// Public, secret-free inventory metadata mapped from the C1
// `WalletInventoryEntry`. `legacy` is optional (absent for non-legacy ids).
export const walletRestoredEntrySchema = z
  .object({
    id: z.string(),
    address: z.string(),
    label: z.string(),
    createdAt: z.string(),
    legacy: z.boolean().optional(),
  })
  .strict();
export type WalletRestoredEntry = z.infer<typeof walletRestoredEntrySchema>;

export const walletRestoreArchiveResultSchema = z
  .object({
    filesRestored: z.array(z.string()),
    walletsRestored: z.array(walletRestoredEntrySchema),
    vaultLocked: z.boolean(),
  })
  .strict();
export type WalletRestoreArchiveResult = z.infer<
  typeof walletRestoreArchiveResultSchema
>;

// ── walletOpenBackupFolder ──────────────────────────────────────────────
// Renderer passes the `backupDir` it received from a previous restore
// result. Main MUST validate the path is a real directory inside
// `${CONFIG_DIR}/backups/` via `fs.realpath` BEFORE opening (codex turn
// 8 answer #5 — symlink-safe), otherwise refuses with
// `validation.invalid_input`.
export const walletOpenBackupFolderInputSchema = z
  .object({ backupDir: z.string().min(1) })
  .strict();
export type WalletOpenBackupFolderInput = z.infer<typeof walletOpenBackupFolderInputSchema>;

export const walletOpenBackupFolderResultSchema = z
  .object({ ok: z.boolean() })
  .strict();
export type WalletOpenBackupFolderResult = z.infer<typeof walletOpenBackupFolderResultSchema>;
