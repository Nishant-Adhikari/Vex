/**
 * Resolves `/<repo>/local/` from this file's location at runtime.
 *
 * Used by debug-only writers in this folder (session-report.ts, log.ts) so
 * their artefacts land next to the shell that produced them, not inside the
 * user's CONFIG_DIR alongside real config (keystore, jwt, .env, connectors).
 *
 * Layout assumption: `local/vex-shell/platform/<file>` → two `..` reaches
 * `local/`. Same assumption already encoded by the relative `../../../src/...`
 * imports elsewhere in this folder.
 */

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const LOCAL_DEBUG_DIR: string = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
