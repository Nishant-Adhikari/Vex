/**
 * Archive read/containment helpers for restore (crypto-sensitive).
 *
 * Phase 1 (VALIDATE) archive stage: resolves the archive + backups root with
 * realpath, enforces that the archive lives INSIDE the backups directory, and
 * (after manifest validation) confirms every referenced file exists as a real
 * regular file resolving inside the archive. No writes happen here.
 *
 * Engine/main only — never imported by the renderer. Throws `VexError`.
 */

import { existsSync, lstatSync, realpathSync } from "node:fs";
import { join, normalize, sep } from "node:path";

import { BACKUPS_DIR } from "../../../config/paths.js";
import { VexError, ErrorCodes } from "../../../errors.js";
import { rejectMalformed, type ValidatedManifest } from "./manifest.js";

export function isInside(child: string, parent: string): boolean {
  const c = normalize(child);
  const p = normalize(parent);
  return c === p || c.startsWith(p.endsWith(sep) ? p : p + sep);
}

/**
 * Resolve the archive dir + backups root with realpath and enforce that the
 * archive lives inside the backups directory. Returns the resolved archive
 * path used by the rest of Phase 1.
 */
export function resolveArchiveInsideBackups(archiveDir: string): string {
  // 1. Path containment: the archive MUST live inside the backups root.
  let resolved: string;
  let backupsRoot: string;
  try {
    resolved = realpathSync(archiveDir);
    backupsRoot = realpathSync(BACKUPS_DIR);
  } catch (err) {
    throw new VexError(
      ErrorCodes.ARCHIVE_RESTORE_FAILED,
      `Backup archive path could not be resolved: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  if (!isInside(resolved, backupsRoot)) {
    throw new VexError(
      ErrorCodes.ARCHIVE_RESTORE_FAILED,
      "Refusing to restore: archive path is outside the backups directory.",
    );
  }
  return resolved;
}

/**
 * Existence + lstat (regular file, not symlink/dir) + realpath containment for
 * every manifest file entry. Aggregates any missing files into a single
 * ARCHIVE_INCOMPLETE error; rejects symlinks/dirs/out-of-archive resolution.
 */
export function verifyArchiveFiles(manifest: ValidatedManifest, resolved: string): void {
  // 4. Existence + lstat (regular file, not symlink/dir) + realpath containment.
  const missing: string[] = [];
  for (const file of manifest.files) {
    const p = join(resolved, file.filename);
    if (!existsSync(p)) {
      missing.push(file.filename);
      continue;
    }
    const st = lstatSync(p);
    if (!st.isFile()) {
      rejectMalformed(`Manifest entry ${file.filename} is not a regular file (symlink/dir rejected).`);
    }
    const realFile = realpathSync(p);
    if (!isInside(realFile, resolved)) {
      rejectMalformed(`Manifest entry ${file.filename} resolves outside the archive.`);
    }
  }
  if (missing.length > 0) {
    throw new VexError(
      ErrorCodes.ARCHIVE_INCOMPLETE,
      `Backup archive is missing referenced files: ${missing.join(", ")}.`,
      "The backup may be corrupt or partially deleted; choose another backup.",
    );
  }
}
