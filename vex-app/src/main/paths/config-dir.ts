/**
 * Pure CONFIG_DIR resolver — mirrors `/mnt/x/Vex/src/config/paths.ts`
 * exactly so vex-app and vex-shell agree on a single `~/.config/vex`
 * (Linux) / `~/Library/Application Support/vex` (macOS) / `%APPDATA%/vex`
 * (Windows) shared between both clients (main plan §39-43).
 *
 * No Electron imports here — must remain consumable from plain Node /
 * tsx contexts so the future M5 compose render module (also pure)
 * can derive shared paths without dragging Electron in.
 */

import { homedir } from "node:os";
import path from "node:path";

const APP_NAME = "vex";

interface ResolveDeps {
  readonly platform: NodeJS.Platform;
  readonly homedir: string;
  readonly env: NodeJS.ProcessEnv;
}

export function resolveConfigDir(deps: ResolveDeps): string {
  const { platform, homedir: home, env } = deps;

  if (platform === "win32") {
    const appData = env["APPDATA"] ?? path.join(home, "AppData", "Roaming");
    return path.join(appData, APP_NAME);
  }

  if (platform === "darwin") {
    return path.join(home, "Library", "Application Support", APP_NAME);
  }

  // Linux + every other unix
  const xdgConfig = env["XDG_CONFIG_HOME"] ?? path.join(home, ".config");
  return path.join(xdgConfig, APP_NAME);
}

export const CONFIG_DIR = resolveConfigDir({
  platform: process.platform,
  homedir: homedir(),
  env: process.env,
});

/**
 * Electron-private state lives nested under CONFIG_DIR so the directory
 * tree stays one place but Chromium's session cache, our preferences
 * store, and electron-log files do not pollute paths that vex-shell
 * also reads from (`.env`, `keystore.json`, `config.json`, …).
 */
export const ELECTRON_STATE_DIR = path.join(CONFIG_DIR, ".electron-state");

/**
 * Shared resources (vex-app + vex-shell both touch these):
 *
 *   CONFIG_DIR/
 *     .env                              shared TRACKED_ENV_KEYS
 *     secrets.vault.json                encrypted API/provider credentials
 *     .install-id                       per-install uuid (M5)
 *     .setup-complete                   wizard completion flag
 *     keystore.json                     EVM keystore
 *     solana-keystore.json              Solana keystore
 *     config.json                       wallet addresses, chain config
 *     compose/docker-compose.yml        rendered compose (M5)
 *     local-infra/secrets/pg_password   PG password (M5)
 *     .electron-state/                  Electron-only (window state, cache)
 */
export const ENV_FILE = path.join(CONFIG_DIR, ".env");
export const SECRETS_VAULT_FILE = path.join(CONFIG_DIR, "secrets.vault.json");
export const INSTALL_ID_FILE = path.join(CONFIG_DIR, ".install-id");
export const SETUP_COMPLETE_FILE = path.join(CONFIG_DIR, ".setup-complete");
export const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");
export const COMPOSE_OUTPUT_DIR = path.join(CONFIG_DIR, "compose");
export const SECRETS_DIR = path.join(CONFIG_DIR, "local-infra", "secrets");
export const PG_PASSWORD_FILE = path.join(SECRETS_DIR, "pg_password");
