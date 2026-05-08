/**
 * Verifies the CONFIG_DIR resolver matches `/mnt/x/Vex/src/config/paths.ts`
 * exactly across the three supported platforms — drift would split the
 * shared user resources between vex-app and vex-shell (main plan §39-43).
 */

import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ELECTRON_STATE_DIR,
  ENV_FILE,
  INSTALL_ID_FILE,
  PG_PASSWORD_FILE,
  SECRETS_DIR,
  SETUP_COMPLETE_FILE,
  resolveConfigDir,
} from "../config-dir.js";

describe("resolveConfigDir", () => {
  it("resolves to %APPDATA%/vex on Windows", () => {
    expect(
      resolveConfigDir({
        platform: "win32",
        homedir: "C:\\Users\\kuba",
        env: { APPDATA: "C:\\Users\\kuba\\AppData\\Roaming" },
      })
    ).toBe(path.join("C:\\Users\\kuba\\AppData\\Roaming", "vex"));
  });

  it("falls back to ~/AppData/Roaming/vex on Windows when %APPDATA% is unset", () => {
    expect(
      resolveConfigDir({
        platform: "win32",
        homedir: "C:\\Users\\kuba",
        env: {},
      })
    ).toBe(path.join("C:\\Users\\kuba", "AppData", "Roaming", "vex"));
  });

  it("resolves to ~/Library/Application Support/vex on macOS", () => {
    expect(
      resolveConfigDir({
        platform: "darwin",
        homedir: "/Users/kuba",
        env: {},
      })
    ).toBe("/Users/kuba/Library/Application Support/vex");
  });

  it("resolves to $XDG_CONFIG_HOME/vex on Linux when set", () => {
    expect(
      resolveConfigDir({
        platform: "linux",
        homedir: "/home/kuba",
        env: { XDG_CONFIG_HOME: "/home/kuba/.config-custom" },
      })
    ).toBe("/home/kuba/.config-custom/vex");
  });

  it("resolves to ~/.config/vex on Linux when XDG_CONFIG_HOME unset", () => {
    expect(
      resolveConfigDir({
        platform: "linux",
        homedir: "/home/kuba",
        env: {},
      })
    ).toBe("/home/kuba/.config/vex");
  });

  it("uses the same lowercase `vex` app name as the engine resolver (parity check)", () => {
    // src/config/paths.ts declares APP_NAME = "vex". If vex-app drifted to
    // "Vex" (capital) or "VexElectron" we'd silently split user state across
    // two directories. This test pins the lowercase contract.
    const dir = resolveConfigDir({
      platform: "linux",
      homedir: "/home/x",
      env: {},
    });
    expect(dir.endsWith("/vex")).toBe(true);
    expect(dir.endsWith("/Vex")).toBe(false);
  });
});

describe("derived path constants", () => {
  it("places the Electron-private state nested under CONFIG_DIR", () => {
    expect(ELECTRON_STATE_DIR.endsWith(path.join("vex", ".electron-state"))).toBe(true);
  });

  it("places shared resources at CONFIG_DIR root, not under .electron-state", () => {
    expect(ENV_FILE.includes(".electron-state")).toBe(false);
    expect(INSTALL_ID_FILE.includes(".electron-state")).toBe(false);
    expect(SETUP_COMPLETE_FILE.includes(".electron-state")).toBe(false);
    expect(SECRETS_DIR.includes(".electron-state")).toBe(false);
    expect(PG_PASSWORD_FILE.includes(".electron-state")).toBe(false);
  });

  it("PG password lives at CONFIG_DIR/local-infra/secrets/pg_password", () => {
    expect(PG_PASSWORD_FILE.endsWith(path.join("local-infra", "secrets", "pg_password"))).toBe(true);
  });
});
