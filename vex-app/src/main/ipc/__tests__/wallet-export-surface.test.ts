/**
 * Surface test for the vex.wallet.exportPrivateKey IPC façade
 * (`wallet-export.ts`) after the structural split into the `wallet-export/`
 * sibling modules (`handler.ts`, `errors.ts`).
 *
 * Pins the façade's PUBLIC runtime surface so the split cannot silently add,
 * drop, or rename an export: the production handler factory
 * `registerWalletExportHandler` (a function) plus the two test-only lease
 * helpers re-exported VERBATIM from `./wallet-export-clipboard-lease.js`
 * (`__getActiveLeaseTokenForTests`, `__resetWalletExportStateForTests`).
 *
 * Mocks mirror `wallet-export.test.ts` so importing the façade does not touch
 * real Electron, the secret vault, the engine wallet inventory, or the OS
 * clipboard.
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
  clipboard: {
    writeText: vi.fn(),
    readText: vi.fn(() => ""),
    clear: vi.fn(),
  },
}));

vi.mock("../../secrets/session.js", () => ({
  getSecretSessionStatus: vi.fn(),
  lockSecretSession: vi.fn(),
}));

vi.mock("../../wallet/export-throttle.js", () => ({
  checkExportAllowed: vi.fn(),
  recordExportFailure: vi.fn(),
  recordExportSuccess: vi.fn(),
}));

vi.mock("@vex-lib/local-secret-vault.js", () => ({
  LocalSecretVaultError: class extends Error {},
  verifySecretVaultPassword: vi.fn(),
}));

vi.mock("@vex-lib/wallet.js", () => ({
  getWalletById: vi.fn(),
  decryptExportSecret: vi.fn(),
}));

vi.mock("../../paths/config-dir.js", () => ({
  SECRETS_VAULT_FILE: "/tmp/vex-test-vault",
}));

vi.mock("../../lifecycle/cleanup-registry.js", () => ({
  globalCleanup: {
    add: vi.fn(() => async (): Promise<void> => undefined),
  },
}));

vi.mock("../../logger/index.js", () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const walletExportFacade = await import("../wallet-export.js");
const {
  registerWalletExportHandler,
  __getActiveLeaseTokenForTests,
  __resetWalletExportStateForTests,
} = walletExportFacade;

// Type-only import of an exported type from the façade-adjacent schema surface
// must compile (no runtime effect). Pins that the public types remain importable.
import type { WalletExportPrivateKeyResult } from "@shared/schemas/wallets.js";
type _ResultProbe = WalletExportPrivateKeyResult;

beforeEach(() => {
  handlers.clear();
});

afterEach(() => {
  handlers.clear();
  vi.clearAllMocks();
});

describe("wallet-export façade surface", () => {
  it("exports registerWalletExportHandler as a function", () => {
    expect(typeof registerWalletExportHandler).toBe("function");
  });

  it("re-exports the two test-only lease helpers as functions", () => {
    expect(typeof __getActiveLeaseTokenForTests).toBe("function");
    expect(typeof __resetWalletExportStateForTests).toBe("function");
  });

  it("exposes EXACTLY the expected runtime export keys", () => {
    const runtimeKeys = Object.keys(walletExportFacade).sort();
    expect(runtimeKeys).toEqual([
      "__getActiveLeaseTokenForTests",
      "__resetWalletExportStateForTests",
      "registerWalletExportHandler",
    ]);
  });
});
