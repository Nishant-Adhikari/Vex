/**
 * Read + validate a backup archive's `manifest.json`.
 * No direct output — caller is responsible for display.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { VexError, ErrorCodes } from "../../../errors.js";
import {
  backupManifestSchema,
  type BackupManifest,
} from "./manifest.js";

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
