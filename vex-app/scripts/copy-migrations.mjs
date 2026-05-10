#!/usr/bin/env node
/**
 * Mirrors the engine's migration SQL files into vex-app/resources/migrations/
 * so electron-builder's `extraResources` rule can pack them into the app
 * bundle. Source of truth stays at src/vex-agent/db/migrations/.
 *
 * Behavior (codex turn 2 must-fix #2):
 *   - File filter MUST match the runner's discovery rule exactly:
 *     `endsWith(".sql") && /^\d{3}_/.test(name)` (see
 *     src/lib/db/migrate-runner.ts listPendingMigrations).
 *   - Orphaned destination SQL files are deleted before copying so a
 *     branch switch that drops/renames migrations cannot leave a stale
 *     SQL file in the packaged resources directory.
 *   - Always overwrite destination files (no mtime/size skip): the copy
 *     is ~50KB total and an mtime skip can preserve stale content after
 *     a force-push or rebase that resets file timestamps.
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
} from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
const SRC_DIR = path.join(REPO_ROOT, "src", "vex-agent", "db", "migrations");
const DEST_DIR = path.resolve(
  import.meta.dirname,
  "..",
  "resources",
  "migrations"
);

function isMigrationFile(name) {
  return name.endsWith(".sql") && /^\d{3}_/.test(name);
}

if (!existsSync(SRC_DIR)) {
  console.error(`[copy-migrations] source dir missing: ${SRC_DIR}`);
  process.exit(1);
}

const sources = readdirSync(SRC_DIR).filter(isMigrationFile).sort();
if (sources.length === 0) {
  console.error(`[copy-migrations] no SQL migrations found in ${SRC_DIR}`);
  process.exit(1);
}

mkdirSync(DEST_DIR, { recursive: true });

const sourceSet = new Set(sources);
let removed = 0;
for (const name of readdirSync(DEST_DIR)) {
  if (isMigrationFile(name) && !sourceSet.has(name)) {
    rmSync(path.join(DEST_DIR, name));
    removed += 1;
  }
}

for (const name of sources) {
  copyFileSync(path.join(SRC_DIR, name), path.join(DEST_DIR, name));
}

console.log(
  `[copy-migrations] ${sources.length} migration(s) copied, ${removed} orphan(s) removed → ${path.relative(REPO_ROOT, DEST_DIR)}/`
);
