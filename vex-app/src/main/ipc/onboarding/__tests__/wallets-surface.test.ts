/**
 * Surface test for the vex.onboarding.wallet* IPC façade
 * (`onboarding/wallets.ts`) after the structural split into the
 * `onboarding/wallets/` sibling modules.
 *
 * Pins the façade's PUBLIC runtime surface so the split cannot silently add,
 * drop, or rename an export: the only export is `registerWalletHandlers`, a
 * function, and (smoke) calling it returns an array of teardown functions.
 *
 * Mocks mirror `wallets.test.ts` so importing the façade does not touch real
 * Electron, keystores, or the filesystem.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Handler = (event: unknown, raw: unknown) => Promise<unknown>;

const handlers = new Map<string, Handler>();

vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, fn: Handler) => {
      handlers.set(channel, fn);
    },
    removeHandler: (channel: string) => {
      handlers.delete(channel);
    },
  },
  app: { isPackaged: true },
  BrowserWindow: {
    fromWebContents: () => null,
  },
  dialog: {
    showOpenDialog: vi.fn(),
    showMessageBox: vi.fn(),
  },
  shell: {
    openPath: vi.fn(),
  },
}));

vi.mock("@vex-lib/wallet.js", () => ({
  BACKUPS_DIR: "/home/user/.config/vex/backups",
  listAvailableBackups: vi.fn(),
  restoreFromBackupArchive: vi.fn(),
}));

vi.mock("@vex-lib/local-secret-vault.js", () => ({
  applySecretVaultToProcessEnv: vi.fn(),
}));

vi.mock("@vex-lib/runtime-env.js", () => ({
  loadProviderDotenv: vi.fn(),
}));

vi.mock("@vex-agent/inference/registry.js", () => ({
  resetProvider: vi.fn(),
}));

vi.mock("../../../secrets/session.js", () => ({
  lockSecretSession: vi.fn(),
  adoptUnlockedPassword: vi.fn(),
}));

vi.mock("../../../paths/config-dir.js", () => ({
  SECRETS_VAULT_FILE: "/home/user/.config/vex/secrets.vault.json",
}));

vi.mock("../../../onboarding/wallets-runner.js", () => ({
  generateEvmWallet: vi.fn(),
  generateSolanaWallet: vi.fn(),
  importEvmWallet: vi.fn(),
  importSolanaWalletRunner: vi.fn(),
  addEvmWallet: vi.fn(),
  addSolanaWallet: vi.fn(),
  importEvmWalletInventory: vi.fn(),
  importSolanaWalletInventory: vi.fn(),
  exportAllWalletsRunner: vi.fn(),
  mapWalletEngineError: vi.fn(),
}));

vi.mock("../../../onboarding/wallet-restore.js", () => ({
  restoreWalletFromFile: vi.fn(),
}));

vi.mock("../../../onboarding/wallet-password.js", () => ({
  withFreshKeystorePassword: vi.fn(),
  isPasswordSetupError: vi.fn(),
}));

vi.mock("../../../onboarding/wallet-mutex.js", () => ({
  withWalletLock: vi.fn(),
}));

vi.mock("../../../logger/index.js", () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const walletsFacade = await import("../wallets.js");
const { registerWalletHandlers } = walletsFacade;

// Type-only import of an exported type from the façade-adjacent schema surface
// must compile (no runtime effect). Pins that the public types remain importable.
import type { Result } from "@shared/ipc/result.js";
type _ResultProbe = Result<{ ok: true }>;

beforeEach(() => {
  handlers.clear();
});

afterEach(() => {
  handlers.clear();
  vi.clearAllMocks();
});

describe("onboarding/wallets façade surface", () => {
  it("exports registerWalletHandlers as a function", () => {
    expect(typeof registerWalletHandlers).toBe("function");
  });

  it("exposes EXACTLY the expected runtime export keys", () => {
    const runtimeKeys = Object.keys(walletsFacade).sort();
    expect(runtimeKeys).toEqual(["registerWalletHandlers"]);
  });

  it("smoke: registerWalletHandlers() returns an array of teardown functions", () => {
    const teardowns = registerWalletHandlers();
    expect(Array.isArray(teardowns)).toBe(true);
    expect(teardowns.length).toBeGreaterThan(0);
    for (const teardown of teardowns) {
      expect(typeof teardown).toBe("function");
    }
  });
});
