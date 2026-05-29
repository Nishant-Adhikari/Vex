/**
 * Core wallet backup logic.
 * No direct output — caller is responsible for display.
 *
 * Manifest V2 (this module's writer): captures the FULL wallet surface — every
 * per-family inventory keystore (legacy fixed file + per-id `wallet-<id>.json`),
 * the encrypted secret vault, the sanitized `.env`, and `config.json`. V1
 * (legacy: a flat `files: string[]`) is parsed ONLY for listing metadata
 * (`listAvailableBackups`). Archive RESTORE is V2-only and fail-closed on V1
 * (a V1 manifest carries no per-file roles, so restoring from it would be
 * ambiguous); recover individual legacy keystores via the single-file
 * `restoreWalletFromFile` path instead.
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

import { loadConfig } from "../../config/store.js";
import {
  BACKUPS_DIR,
  CONFIG_FILE,
  ENV_FILE,
  SECRETS_VAULT_FILE,
} from "../../config/paths.js";
import { VexError, ErrorCodes } from "../../errors.js";
import { minLogger as logger } from "../../utils/logger-shim.js";
import {
  derivePath,
  getPrimaryEvmAddress,
  getPrimarySolanaAddress,
  type InventoryFamily,
} from "./inventory.js";

const MAX_BACKUPS = 20;

// ── Manifest schemas / types ────────────────────────────────────────────────

/** A file recorded in a V2 backup manifest. `role` tags how restore should treat it. */
export type BackupFileRole =
  | "legacy-evm"
  | "legacy-solana"
  | "wallet-evm"
  | "wallet-solana"
  | "vault"
  | "env"
  | "config";

const backupFileEntrySchema = z.object({
  filename: z.string().min(1),
  role: z.enum([
    "legacy-evm",
    "legacy-solana",
    "wallet-evm",
    "wallet-solana",
    "vault",
    "env",
    "config",
  ]),
  walletId: z.string().optional(),
  walletFamily: z.enum(["evm", "solana"]).optional(),
  address: z.string().optional(),
});

const backupManifestWalletSchema = z.object({
  id: z.string(),
  family: z.enum(["evm", "solana"]),
  address: z.string(),
  label: z.string(),
  createdAt: z.string(),
  legacy: z.boolean(),
});

/** V1 manifest (pre-multi-wallet): a flat list of filenames. Read-only. */
export const backupManifestV1Schema = z.object({
  version: z.literal(1),
  cliVersion: z.string().optional(),
  createdAt: z.string().optional(),
  walletAddress: z.string().nullable().optional(),
  solanaWalletAddress: z.string().nullable().optional(),
  chainId: z.number().optional(),
  files: z.array(z.string()),
});

/** V2 manifest: full wallet surface with per-file roles + inventory snapshot. */
export const backupManifestV2Schema = z.object({
  version: z.literal(2),
  cliVersion: z.string(),
  createdAt: z.string(),
  walletAddress: z.string().nullable().optional(),
  solanaWalletAddress: z.string().nullable().optional(),
  chainId: z.number().optional(),
  wallets: z.array(backupManifestWalletSchema),
  files: z.array(backupFileEntrySchema),
});

/**
 * Version-gated parse accepting V1 AND V2. A discriminated union on `version`
 * gives precise error messages and rejects any other shape (incl. version > 2).
 */
export const backupManifestSchema = z.discriminatedUnion("version", [
  backupManifestV1Schema,
  backupManifestV2Schema,
]);

export type BackupManifestV1 = z.infer<typeof backupManifestV1Schema>;
export type BackupManifestV2 = z.infer<typeof backupManifestV2Schema>;
export type BackupManifest = z.infer<typeof backupManifestSchema>;
export type BackupManifestWallet = z.infer<typeof backupManifestWalletSchema>;
export type BackupFileEntry = z.infer<typeof backupFileEntrySchema>;

function getCLIVersion(): string {
  try {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const pkgPath = join(__dirname, "..", "..", "..", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { version?: string };
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

function legacyRole(family: InventoryFamily): BackupFileRole {
  return family === "solana" ? "legacy-solana" : "legacy-evm";
}

function walletRole(family: InventoryFamily): BackupFileRole {
  return family === "solana" ? "wallet-solana" : "wallet-evm";
}

/**
 * Create a complete backup of the current wallet surface under
 * `BACKUPS_DIR/<timestamp>/`:
 *   - every inventory keystore (legacy fixed files + per-id `wallet-<id>.json`),
 *   - the encrypted secret vault (`secrets.vault.json`),
 *   - the `.env` file,
 *   - `config.json`,
 * plus a V2 `manifest.json` written LAST (after all copies succeed) so a copy
 * failure can never leave a "complete" manifest behind.
 *
 * Returns the backup path, or null if there is genuinely nothing to back up.
 * Throws VexError(AUTO_BACKUP_FAILED) on write failure.
 */
export async function autoBackup(): Promise<string | null> {
  const cfg = loadConfig();

  // Enumerate every inventory keystore the SAME way exportAllWallets does, so a
  // restore can rebuild the full inventory. A bad LOCAL id (config is trusted)
  // is skipped with a warning rather than aborting the whole backup.
  interface PlannedCopy {
    readonly src: string;
    readonly filename: string;
    readonly fileEntry: BackupFileEntry;
    readonly wallet: BackupManifestWallet;
  }
  const planned: PlannedCopy[] = [];

  for (const family of ["evm", "solana"] as const) {
    for (const entry of cfg.wallet[family]) {
      let src: string;
      try {
        src = derivePath(family, entry);
      } catch (err) {
        logger.warn(
          `Skipping ${family} wallet ${entry.id} in backup (non-canonical id): ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        continue;
      }
      if (!existsSync(src)) continue;
      const legacy = entry.legacy === true;
      const filename = basename(src);
      planned.push({
        src,
        filename,
        fileEntry: legacy
          ? { filename, role: legacyRole(family) }
          : {
              filename,
              role: walletRole(family),
              walletId: entry.id,
              walletFamily: family,
              address: entry.address,
            },
        wallet: {
          id: entry.id,
          family,
          address: entry.address,
          label: entry.label,
          createdAt: entry.createdAt,
          legacy,
        },
      });
    }
  }

  const hasVault = existsSync(SECRETS_VAULT_FILE);
  const hasEnv = existsSync(ENV_FILE);
  const hasConfig = existsSync(CONFIG_FILE);

  if (planned.length === 0 && !hasVault && !hasEnv && !hasConfig) {
    return null;
  }

  try {
    mkdirSync(BACKUPS_DIR, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, "");
    const backupDir = join(BACKUPS_DIR, timestamp);
    mkdirSync(backupDir, { recursive: true });

    const files: BackupFileEntry[] = [];
    const wallets: BackupManifestWallet[] = [];

    // Copy keystores (throws on failure → no manifest written below).
    for (const item of planned) {
      copyBytes(item.src, join(backupDir, item.filename));
      files.push(item.fileEntry);
      wallets.push(item.wallet);
    }

    if (hasVault) {
      copyBytes(SECRETS_VAULT_FILE, join(backupDir, basename(SECRETS_VAULT_FILE)));
      files.push({ filename: basename(SECRETS_VAULT_FILE), role: "vault" });
    }
    if (hasEnv) {
      copyBytes(ENV_FILE, join(backupDir, basename(ENV_FILE)));
      files.push({ filename: basename(ENV_FILE), role: "env" });
    }
    if (hasConfig) {
      copyBytes(CONFIG_FILE, join(backupDir, basename(CONFIG_FILE)));
      files.push({ filename: basename(CONFIG_FILE), role: "config" });
    }

    const manifest: BackupManifestV2 = {
      version: 2,
      cliVersion: getCLIVersion(),
      createdAt: new Date().toISOString(),
      walletAddress: getPrimaryEvmAddress(cfg),
      solanaWalletAddress: getPrimarySolanaAddress(cfg),
      chainId: cfg.chain.chainId,
      wallets,
      files,
    };
    // Write manifest LAST — after every copy above succeeded.
    writeFileSync(
      join(backupDir, "manifest.json"),
      JSON.stringify(manifest, null, 2),
      "utf-8",
    );

    // Protect the snapshot we just created from being evicted by retention —
    // otherwise a pre-restore backup taken when already at MAX (or with
    // future-dated dirs on disk) could be pruned out from under the restore.
    enforceBackupRetention(timestamp);

    logger.debug(`Auto-backup created at ${backupDir}`);
    return backupDir;
  } catch (err) {
    if (err instanceof VexError) throw err;
    throw new VexError(
      ErrorCodes.AUTO_BACKUP_FAILED,
      `Failed to create auto-backup: ${err instanceof Error ? err.message : String(err)}`,
      "Check permissions on the config directory.",
    );
  }
}

/**
 * Byte-for-byte copy via read+write (NOT cpSync, which can preserve links /
 * permissions in surprising ways). Keystore/vault perms are re-applied by the
 * restore primitive on write; here we only need an exact-content copy.
 */
function copyBytes(src: string, dest: string): void {
  writeFileSync(dest, readFileSync(src));
}

/**
 * Prune oldest backups down to MAX_BACKUPS. `protectName` (a backup dir
 * basename) is NEVER evicted — used to guarantee a just-created pre-restore
 * snapshot survives even if other (possibly future-dated) dirs sort "newer".
 */
export function enforceBackupRetention(protectName?: string): void {
  if (!existsSync(BACKUPS_DIR)) return;
  try {
    const all = readdirSync(BACKUPS_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();

    const protectedExists = protectName !== undefined && all.includes(protectName);
    const candidates = all.filter((name) => name !== protectName);
    // If the protected dir is on disk it occupies one retention slot.
    const keep = Math.max(0, MAX_BACKUPS - (protectedExists ? 1 : 0));

    while (candidates.length > keep) {
      const oldest = candidates.shift()!;
      rmSync(join(BACKUPS_DIR, oldest), { recursive: true, force: true });
      logger.debug(`Removed old backup: ${oldest}`);
    }
  } catch {
    // best-effort
  }
}

/**
 * Read + validate a backup archive's `manifest.json`. Returns the parsed
 * (V1 or V2) manifest. Throws `VexError(ARCHIVE_MANIFEST_MALFORMED)` if the
 * file is missing, not JSON, or fails the version-gated schema (incl. v > 2).
 */
export function readArchiveManifest(archiveDir: string): BackupManifest {
  const manifestPath = join(archiveDir, "manifest.json");
  if (!existsSync(manifestPath)) {
    throw new VexError(
      ErrorCodes.ARCHIVE_MANIFEST_MALFORMED,
      "Backup archive has no manifest.json.",
    );
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(manifestPath, "utf-8"));
  } catch {
    throw new VexError(
      ErrorCodes.ARCHIVE_MANIFEST_MALFORMED,
      "Backup manifest is not valid JSON.",
    );
  }
  const parsed = backupManifestSchema.safeParse(raw);
  if (!parsed.success) {
    throw new VexError(
      ErrorCodes.ARCHIVE_MANIFEST_MALFORMED,
      "Backup manifest does not match a supported version (expected v1 or v2).",
    );
  }
  return parsed.data;
}

export interface AvailableBackup {
  /**
   * Opaque archive id = the backup directory's basename (a timestamp). NOT an
   * absolute path: the caller (vex-app main) resolves it under BACKUPS_DIR and
   * the restore primitive re-validates containment via realpath. Keeping the
   * surface path-free avoids leaking the on-disk layout to the renderer.
   */
  readonly id: string;
  readonly timestamp: string;
  readonly walletCount: number;
  readonly addresses: string[];
  readonly vaultIncluded: boolean;
  readonly envIncluded: boolean;
}

/**
 * List backup archives under BACKUPS_DIR with metadata ONLY (no secrets, no
 * absolute paths), sorted newest-first. Tolerates V1 and V2 manifests; a
 * missing/corrupt manifest is skipped with a warning rather than throwing.
 */
export function listAvailableBackups(): AvailableBackup[] {
  if (!existsSync(BACKUPS_DIR)) return [];

  let dirs: string[];
  try {
    dirs = readdirSync(BACKUPS_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch (err) {
    logger.warn(
      `Could not enumerate backups: ${err instanceof Error ? err.message : String(err)}`,
    );
    return [];
  }

  const out: AvailableBackup[] = [];
  for (const timestamp of dirs) {
    const dir = join(BACKUPS_DIR, timestamp);
    let manifest: BackupManifest;
    try {
      manifest = readArchiveManifest(dir);
    } catch {
      logger.warn(`Skipping backup ${timestamp}: missing or invalid manifest.`);
      continue;
    }

    if (manifest.version === 2) {
      const addresses = manifest.wallets.map((w) => w.address);
      out.push({
        id: timestamp,
        timestamp,
        walletCount: manifest.wallets.length,
        addresses,
        vaultIncluded: manifest.files.some((f) => f.role === "vault"),
        envIncluded: manifest.files.some((f) => f.role === "env"),
      });
      continue;
    }

    // V1: no inventory snapshot — derive a best-effort metadata view.
    const addresses: string[] = [];
    if (manifest.walletAddress) addresses.push(manifest.walletAddress);
    if (manifest.solanaWalletAddress) addresses.push(manifest.solanaWalletAddress);
    out.push({
      id: timestamp,
      timestamp,
      walletCount: addresses.length,
      addresses,
      vaultIncluded: false,
      envIncluded: false,
    });
  }

  return out.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}
