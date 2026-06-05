/**
 * vex.onboarding.wallet* — dialog/address formatting + fs.realpath containment
 * helpers shared by the per-family handler registers.
 *
 * `truncateAddress` shortens an address for a single dialog line; `resolveBackupDir`
 * performs the realpath containment check that keeps `shell.openPath` inside
 * `${CONFIG_DIR}/backups/`. Electron `dialog`/`shell` authority stays main-only;
 * these helpers carry the fs.realpath containment used by that authority.
 */

import path from "node:path";
import { promises as fs } from "node:fs";
import { BACKUPS_DIR } from "@vex-lib/wallet.js";

/**
 * Truncate an address for the dialog message — short enough to fit
 * a single dialog line on every platform without horizontal scroll.
 */
export function truncateAddress(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/**
 * Resolve `candidate` to its real on-disk path and confirm it is a
 * directory inside `${CONFIG_DIR}/backups/` even after symlink
 * resolution (codex turn 8 answer #5 + turn 9 STILL-OPEN). Returns
 * the resolved real path on success — the handler MUST pass that
 * resolved path (not the renderer-supplied one) to `shell.openPath`
 * to close the symlink-swap TOCTOU window between validation and open.
 */
export async function resolveBackupDir(candidate: string): Promise<string | null> {
  try {
    const baseReal = await fs.realpath(BACKUPS_DIR);
    const candidateReal = await fs.realpath(candidate);
    const stat = await fs.stat(candidateReal);
    if (!stat.isDirectory()) return null;
    if (
      candidateReal === baseReal ||
      candidateReal.startsWith(baseReal + path.sep)
    ) {
      return candidateReal;
    }
    return null;
  } catch {
    return null;
  }
}
