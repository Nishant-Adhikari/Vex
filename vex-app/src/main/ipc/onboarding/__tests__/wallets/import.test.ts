/**
 * Tests for vex.onboarding.wallet* IPC handlers (M8).
 *
 * Mocks electron + runner + restore + password helpers so we exercise
 * the handler glue (envelope, lock wrapping, dialog flow, path
 * validation) without touching real keystores or filesystem.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createTestWebContents,
  createTrustedSender,
  type TestIpcEvent,
} from "../../../__tests__/test-sender.js";

type Handler = (
  event: TestIpcEvent,
  raw: unknown
) => Promise<unknown>;

const handlers = new Map<string, Handler>();

const mockGenerateEvm = vi.fn();
const mockGenerateSolana = vi.fn();
const mockImportEvm = vi.fn();
const mockImportSolana = vi.fn();
const mockRestore = vi.fn();
const mockAddEvm = vi.fn();
const mockAddSolana = vi.fn();
const mockImportAddEvm = vi.fn();
const mockImportAddSolana = vi.fn();
const mockExportAll = vi.fn();
const mockShowOpenDialog = vi.fn();
const mockShowMessageBox = vi.fn();
const mockShellOpenPath = vi.fn();
const mockBrowserWindowFromWebContents = vi.fn();
const mockRealpath = vi.fn();
const mockStat = vi.fn();
// C2 — full-archive restore mocks.
const mockListAvailableBackups = vi.fn();
const mockRestoreFromBackupArchive = vi.fn();
const mockApplySecretVaultToProcessEnv = vi.fn();
const mockLoadProviderDotenv = vi.fn();
const mockResetProvider = vi.fn();
const mockLockSecretSession = vi.fn();
const mockAdoptUnlockedPassword = vi.fn();

/**
 * Recording logger: real-shaped log surface that captures every formatted
 * string so a test can assert the password never appears in any log line.
 */
const loggedStrings: string[] = [];
function recordLog(...args: unknown[]): void {
  loggedStrings.push(args.map((a) => String(a)).join(" "));
}

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
    fromWebContents: (sender: unknown) => mockBrowserWindowFromWebContents(sender),
  },
  dialog: {
    showOpenDialog: (parent: unknown, opts: unknown) =>
      mockShowOpenDialog(parent, opts),
    showMessageBox: (parent: unknown, opts: unknown) =>
      mockShowMessageBox(parent, opts),
  },
  shell: {
    openPath: (path: string) => mockShellOpenPath(path),
  },
}));

vi.mock("@vex-lib/wallet.js", () => ({
  BACKUPS_DIR: "/home/user/.config/vex/backups",
  listAvailableBackups: () => mockListAvailableBackups(),
  restoreFromBackupArchive: (args: unknown) => mockRestoreFromBackupArchive(args),
}));

vi.mock("@vex-lib/local-secret-vault.js", () => ({
  applySecretVaultToProcessEnv: (password: string, options: unknown) =>
    mockApplySecretVaultToProcessEnv(password, options),
}));

vi.mock("@vex-lib/runtime-env.js", () => ({
  loadProviderDotenv: (options: unknown) => mockLoadProviderDotenv(options),
}));

vi.mock("@vex-agent/inference/registry.js", () => ({
  resetProvider: () => mockResetProvider(),
}));

vi.mock("../../../../secrets/session.js", () => ({
  lockSecretSession: async () => mockLockSecretSession(),
  adoptUnlockedPassword: (password: string) =>
    mockAdoptUnlockedPassword(password),
}));

vi.mock("../../../../paths/config-dir.js", () => ({
  SECRETS_VAULT_FILE: "/home/user/.config/vex/secrets.vault.json",
}));

/**
 * Minimal stand-in for the real `mapWalletEngineError`: maps the engine
 * VexError codes the C2 tests exercise to their public IPC codes. Mirrors the
 * real switch for the tested subset so a regression in the handler's wiring
 * still surfaces here.
 */
function mapEngineCode(cause: unknown): unknown {
  const code =
    typeof cause === "object" && cause !== null && "code" in cause
      ? (cause as { code: unknown }).code
      : undefined;
  const ipcCode =
    code === "SIGNER_MISMATCH"
      ? "wallet.signer_mismatch"
      : code === "KEYSTORE_DECRYPT_FAILED"
        ? "wallet.password_invalid"
        : code === "ARCHIVE_INCOMPLETE"
          ? "validation.archive_incomplete"
          : code === "ARCHIVE_MANIFEST_MALFORMED"
            ? "validation.archive_manifest_malformed"
            : "internal.unexpected";
  return {
    ok: false,
    error: {
      code: ipcCode,
      domain: ipcCode.startsWith("wallet.") ? "wallet" : "onboarding",
      message: "mapped",
      retryable: false,
      userActionable: true,
      redacted: true,
    },
  };
}

vi.mock("../../../../onboarding/wallets-runner.js", () => ({
  generateEvmWallet: () => mockGenerateEvm(),
  generateSolanaWallet: () => mockGenerateSolana(),
  importEvmWallet: (rawKey: string) => mockImportEvm(rawKey),
  importSolanaWalletRunner: (rawKey: string) => mockImportSolana(rawKey),
  addEvmWallet: (label?: string) => mockAddEvm(label),
  addSolanaWallet: (label?: string) => mockAddSolana(label),
  importEvmWalletInventory: (rawKey: string, label?: string) =>
    mockImportAddEvm(rawKey, label),
  importSolanaWalletInventory: (rawKey: string, label?: string) =>
    mockImportAddSolana(rawKey, label),
  exportAllWalletsRunner: (destDir: string) => mockExportAll(destDir),
  mapWalletEngineError: (cause: unknown) => mapEngineCode(cause),
}));

vi.mock("../../../../onboarding/wallet-restore.js", () => ({
  restoreWalletFromFile: (args: unknown) => mockRestore(args),
}));

vi.mock("../../../../onboarding/wallet-password.js", () => ({
  withFreshKeystorePassword: async <T>(
    fn: (ctx: { password: string }) => Promise<T>
  ): Promise<T> => fn({ password: "test-password-12" }),
  isPasswordSetupError: (v: unknown) =>
    typeof v === "object" &&
    v !== null &&
    "ok" in v &&
    (v as { ok: unknown }).ok === false,
}));

vi.mock("../../../../onboarding/wallet-mutex.js", () => ({
  withWalletLock: <T>(fn: () => Promise<T>) => fn(),
}));

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    promises: {
      ...actual.promises,
      realpath: (p: string) => mockRealpath(p),
      stat: (p: string) => mockStat(p),
    },
  };
});

vi.mock("../../../../logger/index.js", () => ({
  log: {
    info: (...args: unknown[]) => recordLog(...args),
    warn: (...args: unknown[]) => recordLog(...args),
    error: (...args: unknown[]) => recordLog(...args),
    debug: (...args: unknown[]) => recordLog(...args),
  },
}));

const { registerWalletHandlers } = await import("../../wallets.js");
const { CH } = await import("@shared/ipc/channels.js");
const {
  walletRestoreArchiveInputSchema,
  walletRestoreArchiveResultSchema,
} = await import("@shared/schemas/wallets.js");

const trustedSender = createTrustedSender({ sender: createTestWebContents() });

beforeEach(() => {
  handlers.clear();
  mockGenerateEvm.mockReset();
  mockGenerateSolana.mockReset();
  mockImportEvm.mockReset();
  mockImportSolana.mockReset();
  mockRestore.mockReset();
  mockAddEvm.mockReset();
  mockAddSolana.mockReset();
  mockImportAddEvm.mockReset();
  mockImportAddSolana.mockReset();
  mockExportAll.mockReset();
  mockShowOpenDialog.mockReset();
  mockShowMessageBox.mockReset();
  mockShellOpenPath.mockReset();
  mockBrowserWindowFromWebContents.mockReturnValue(null);
  mockRealpath.mockReset();
  mockStat.mockReset();
  mockListAvailableBackups.mockReset();
  mockRestoreFromBackupArchive.mockReset();
  mockApplySecretVaultToProcessEnv.mockReset();
  mockLoadProviderDotenv.mockReset();
  mockResetProvider.mockReset();
  mockLockSecretSession.mockReset();
  mockAdoptUnlockedPassword.mockReset();
  loggedStrings.length = 0;
});

afterEach(() => {
  handlers.clear();
  vi.clearAllMocks();
});

describe("walletImportEvm handler", () => {
  it("passes rawKey to the runner and returns the result", async () => {
    mockImportEvm.mockResolvedValue({
      ok: true,
      data: { address: "0xabcdef0123456789abcdef0123456789abcdef01" },
    });
    registerWalletHandlers();
    const fn = handlers.get(CH.onboarding.walletImportEvm)!;
    const result = (await fn(trustedSender, {
      requestId: "r4",
      payload: { rawKey: "0xprivkey" },
    })) as { ok: boolean };
    expect(result.ok).toBe(true);
    expect(mockImportEvm).toHaveBeenCalledWith("0xprivkey");
  });

  it("rejects empty rawKey at the input schema", async () => {
    registerWalletHandlers();
    const fn = handlers.get(CH.onboarding.walletImportEvm)!;
    const result = (await fn(trustedSender, {
      requestId: "r5",
      payload: { rawKey: "" },
    })) as { ok: boolean; error?: { code: string } };
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("validation.invalid_input");
    expect(mockImportEvm).not.toHaveBeenCalled();
  });
});

// ── Multi-wallet inventory handlers (puzzle 5 phase 5D) ─────────────────────

describe("walletAddEvm handler (inventory generate-add)", () => {
  it("returns ok({id,address,label}) and forwards the label", async () => {
    mockAddEvm.mockResolvedValue({
      ok: true,
      data: {
        id: "evm_abc",
        address: "0xabcdef0123456789abcdef0123456789abcdef01",
        label: "EVM 2",
      },
    });
    registerWalletHandlers();
    const fn = handlers.get(CH.onboarding.walletAddEvm)!;
    const result = (await fn(trustedSender, {
      requestId: "ra1",
      payload: { label: "EVM 2" },
    })) as { ok: boolean; data?: { id: string } };
    expect(result.ok).toBe(true);
    expect(result.data?.id).toBe("evm_abc");
    expect(mockAddEvm).toHaveBeenCalledWith("EVM 2");
  });

  it("propagates wallet.cap_reached unchanged", async () => {
    mockAddEvm.mockResolvedValue({
      ok: false,
      error: {
        code: "wallet.cap_reached",
        domain: "wallet",
        message: "cap",
        retryable: false,
        userActionable: true,
        redacted: true,
      },
    });
    registerWalletHandlers();
    const fn = handlers.get(CH.onboarding.walletAddEvm)!;
    const result = (await fn(trustedSender, {
      requestId: "ra2",
      payload: {},
    })) as { ok: boolean; error?: { code: string } };
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("wallet.cap_reached");
  });

  it("rejects a label longer than 120 chars at the input schema", async () => {
    registerWalletHandlers();
    const fn = handlers.get(CH.onboarding.walletAddEvm)!;
    const result = (await fn(trustedSender, {
      requestId: "ra2b",
      payload: { label: "x".repeat(121) },
    })) as { ok: boolean; error?: { code: string } };
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("validation.invalid_input");
    expect(mockAddEvm).not.toHaveBeenCalled();
  });
});

describe("walletImportAddSolana handler (inventory import-add)", () => {
  it("forwards rawKey + label to the inventory import runner", async () => {
    mockImportAddSolana.mockResolvedValue({
      ok: true,
      data: {
        id: "sol_xyz",
        address: "DRpbCBMxVnDK7maPM5tGv6MvCsx1WTokJBKVz5Pk5Hxe",
        label: "Solana 2",
      },
    });
    registerWalletHandlers();
    const fn = handlers.get(CH.onboarding.walletImportAddSolana)!;
    const result = (await fn(trustedSender, {
      requestId: "ra3",
      payload: { rawKey: "base58key", label: "Solana 2" },
    })) as { ok: boolean };
    expect(result.ok).toBe(true);
    expect(mockImportAddSolana).toHaveBeenCalledWith("base58key", "Solana 2");
  });

  it("rejects empty rawKey at the input schema", async () => {
    registerWalletHandlers();
    const fn = handlers.get(CH.onboarding.walletImportAddSolana)!;
    const result = (await fn(trustedSender, {
      requestId: "ra4",
      payload: { rawKey: "" },
    })) as { ok: boolean; error?: { code: string } };
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("validation.invalid_input");
    expect(mockImportAddSolana).not.toHaveBeenCalled();
  });
});
