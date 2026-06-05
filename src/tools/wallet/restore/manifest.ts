/**
 * Manifest schema validation for archive restore (crypto-sensitive).
 *
 * Phase 1 (VALIDATE) manifest stage: reads the archive manifest and applies the
 * version-gated + per-file + reconciliation + duplicate-address fail-closed
 * checks. Treats the archive as UNTRUSTED — every check rejects before any
 * write. Returns the validated V2 manifest plus the `walletsById` index reused
 * by the verify stage.
 *
 * Engine/main only — never imported by the renderer. Throws `VexError`.
 */

import { isAbsolute } from "node:path";

import {
  CONFIG_FILE,
  ENV_FILE,
  SECRETS_VAULT_FILE,
} from "../../../config/paths.js";
import { isValidWalletId } from "../../../config/store.js";
import { VexError, ErrorCodes } from "../../../errors.js";
import { readArchiveManifest } from "../backup.js";
import {
  walletAddressesEqual,
  type InventoryFamily,
} from "../inventory.js";

export type ArchiveManifest = ReturnType<typeof readArchiveManifest>;
export type ValidatedManifest = Extract<ArchiveManifest, { version: 2 }>;
export type ManifestWallet = ValidatedManifest["wallets"][number];

const FILENAME_ILLEGAL = /[/\\\0]/;

export function rejectMalformed(message: string): never {
  throw new VexError(ErrorCodes.ARCHIVE_MANIFEST_MALFORMED, message);
}

/** basename without importing path.basename's platform sep handling subtleties. */
export function basenameOf(p: string): string {
  const idxF = p.lastIndexOf("/");
  const idxB = p.lastIndexOf("\\");
  const idx = Math.max(idxF, idxB);
  return idx === -1 ? p : p.slice(idx + 1);
}

/**
 * Read + version-gate + structurally validate the archive manifest. Returns the
 * validated V2 manifest and the `walletsById` index (walletId → wallets[]
 * entry) consumed by the verify stage.
 */
export function readAndValidateManifest(resolved: string): {
  manifest: ValidatedManifest;
  walletsById: Map<string, ManifestWallet>;
} {
  // 2. Manifest: read + version-gated Zod validation (rejects v > 2 / malformed).
  const manifest = readArchiveManifest(resolved);
  if (manifest.version !== 2) {
    // V1 archives have no per-file roles → not a supported restore source.
    rejectMalformed(
      "Backup archive uses the legacy v1 manifest, which cannot be restored. Create a fresh backup.",
    );
  }

  // 3. Per-file structural validation (UNTRUSTED → fail-closed, no skip).
  const seenFilenames = new Set<string>();
  let vaultCount = 0;
  let envCount = 0;
  let configCount = 0;
  // walletId → the single wallets[] entry it must map to.
  const walletsById = new Map<string, (typeof manifest.wallets)[number]>();
  for (const w of manifest.wallets) {
    if (walletsById.has(w.id)) {
      rejectMalformed(`Manifest lists wallet id "${w.id}" more than once.`);
    }
    walletsById.set(w.id, w);
  }

  for (const file of manifest.files) {
    const { filename, role } = file;
    if (
      filename === "" ||
      filename === "." ||
      filename === ".." ||
      isAbsolute(filename) ||
      FILENAME_ILLEGAL.test(filename) ||
      basenameOf(filename) !== filename
    ) {
      rejectMalformed(`Manifest references an unsafe filename: ${JSON.stringify(filename)}`);
    }
    if (seenFilenames.has(filename)) {
      rejectMalformed(`Manifest references duplicate filename: ${filename}`);
    }
    seenFilenames.add(filename);

    // Singleton system files MUST use their canonical basename. This makes the
    // vault/env/config decision role-based AND filename-stable: an untrusted
    // archive cannot, e.g., declare role:"vault" under a different filename to
    // swap the live vault while a filename-based caller misses it.
    if (role === "vault") {
      if (filename !== basenameOf(SECRETS_VAULT_FILE)) {
        rejectMalformed(`Vault file must be named ${basenameOf(SECRETS_VAULT_FILE)}.`);
      }
      vaultCount += 1;
    } else if (role === "env") {
      if (filename !== basenameOf(ENV_FILE)) {
        rejectMalformed(`Env file must be named ${basenameOf(ENV_FILE)}.`);
      }
      envCount += 1;
    } else if (role === "config") {
      if (filename !== basenameOf(CONFIG_FILE)) {
        rejectMalformed(`Config file must be named ${basenameOf(CONFIG_FILE)}.`);
      }
      configCount += 1;
    } else if (role === "wallet-evm" || role === "wallet-solana") {
      const family: InventoryFamily = role === "wallet-solana" ? "solana" : "evm";
      if (!file.walletId || !file.walletFamily || !file.address) {
        rejectMalformed(`Wallet file ${filename} is missing walletId/walletFamily/address.`);
      }
      if (file.walletFamily !== family) {
        rejectMalformed(`Wallet file ${filename} family does not match its role.`);
      }
      if (!isValidWalletId(family, file.walletId, false)) {
        rejectMalformed(`Wallet file ${filename} has a non-canonical wallet id.`);
      }
      const w = walletsById.get(file.walletId);
      if (!w) {
        rejectMalformed(`Wallet file ${filename} references unknown wallet id ${file.walletId}.`);
      }
      if (w.family !== family || !walletAddressesEqual(family, w.address, file.address)) {
        rejectMalformed(`Wallet file ${filename} does not match its wallets[] entry.`);
      }
    }
    // legacy-evm / legacy-solana need no extra structural fields here; their
    // wallets[] entry is matched below.
  }
  if (vaultCount > 1) rejectMalformed("Manifest references more than one vault file.");
  if (envCount > 1) rejectMalformed("Manifest references more than one .env file.");
  if (configCount > 1) rejectMalformed("Manifest references more than one config file.");

  // 3b. Full wallets[] <-> keystore-file reconciliation (EXACTLY 1:1). Catches
  //     orphan wallets[] entries (no keystore), duplicate legacy roles, and
  //     per-wallet files referencing unknown ids. Every wallet id is validated
  //     up front (UNTRUSTED → fail-closed) regardless of whether it's reached
  //     by the decrypt loop below.
  let legacyEvmFiles = 0;
  let legacySolanaFiles = 0;
  const fileCountByWalletId = new Map<string, number>();
  for (const file of manifest.files) {
    if (file.role === "wallet-evm" || file.role === "wallet-solana") {
      // walletId presence was asserted in the per-file loop above.
      const id = file.walletId as string;
      fileCountByWalletId.set(id, (fileCountByWalletId.get(id) ?? 0) + 1);
    } else if (file.role === "legacy-evm") {
      legacyEvmFiles += 1;
    } else if (file.role === "legacy-solana") {
      legacySolanaFiles += 1;
    }
  }
  if (legacyEvmFiles > 1) rejectMalformed("Manifest references more than one legacy EVM keystore.");
  if (legacySolanaFiles > 1) rejectMalformed("Manifest references more than one legacy Solana keystore.");
  // Every per-wallet keystore file must reference a known wallets[] id, exactly once.
  for (const [id, count] of fileCountByWalletId) {
    if (!walletsById.has(id)) rejectMalformed(`Keystore file references unknown wallet id ${id}.`);
    if (count !== 1) rejectMalformed(`Wallet id ${id} is referenced by ${count} keystore files (expected 1).`);
  }
  // Every wallets[] entry must have a canonical id AND exactly one keystore file.
  for (const w of manifest.wallets) {
    if (!isValidWalletId(w.family, w.id, w.legacy)) {
      rejectMalformed(`Manifest wallet "${w.id}" has a non-canonical id for family ${w.family} (legacy=${w.legacy}).`);
    }
    if (w.legacy) {
      const have = w.family === "solana" ? legacySolanaFiles : legacyEvmFiles;
      if (have !== 1) {
        rejectMalformed(`Legacy ${w.family} wallet ${w.id} must have exactly one keystore file (found ${have}).`);
      }
    } else if ((fileCountByWalletId.get(w.id) ?? 0) !== 1) {
      rejectMalformed(`Wallet ${w.id} has no matching keystore file in the manifest.`);
    }
  }
  // A legacy keystore file with no matching legacy wallets[] entry is also invalid.
  if (legacyEvmFiles === 1 && !manifest.wallets.some((w) => w.family === "evm" && w.legacy)) {
    rejectMalformed("Manifest has a legacy EVM keystore file but no matching wallets[] entry.");
  }
  if (legacySolanaFiles === 1 && !manifest.wallets.some((w) => w.family === "solana" && w.legacy)) {
    rejectMalformed("Manifest has a legacy Solana keystore file but no matching wallets[] entry.");
  }

  // 3c. Preserve the inventory duplicate-address invariant (assertCanAddWallet
  //     enforces it for normal add/import). The rebuild below replaces the
  //     arrays wholesale, so two manifest entries with different ids but the
  //     same address would smuggle a duplicate past that guard — reject here,
  //     before any decrypt/write.
  for (const family of ["evm", "solana"] as const) {
    const seen = new Set<string>();
    for (const w of manifest.wallets) {
      if (w.family !== family) continue;
      const key = family === "evm" ? w.address.toLowerCase() : w.address;
      if (seen.has(key)) {
        rejectMalformed(`Manifest lists the same ${family} address more than once.`);
      }
      seen.add(key);
    }
  }

  return { manifest, walletsById };
}
