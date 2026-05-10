/**
 * Tests for vex.onboarding.wallet* IPC handlers (M8).
 *
 * Mocks electron + runner + restore + password helpers so we exercise
 * the handler glue (envelope, lock wrapping, dialog flow, path
 * validation) without touching real keystores or filesystem.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Handler = (
  event: { senderFrame?: { url?: string }; sender?: unknown },
  raw: unknown
) => Promise<unknown>;

const handlers = new Map<string, Handler>();

const mockGenerateEvm = vi.fn();
const mockGenerateSolana = vi.fn();
const mockImportEvm = vi.fn();
const mockImportSolana = vi.fn();
const mockRestore = vi.fn();
const mockShowOpenDialog = vi.fn();
const mockShowMessageBox = vi.fn();
const mockShellOpenPath = vi.fn();
const mockBrowserWindowFromWebContents = vi.fn();
const mockRealpath = vi.fn();
const mockStat = vi.fn();

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
}));

vi.mock("../../../onboarding/wallets-runner.js", () => ({
  generateEvmWallet: () => mockGenerateEvm(),
  generateSolanaWallet: () => mockGenerateSolana(),
  importEvmWallet: (rawKey: string) => mockImportEvm(rawKey),
  importSolanaWalletRunner: (rawKey: string) => mockImportSolana(rawKey),
}));

vi.mock("../../../onboarding/wallet-restore.js", () => ({
  restoreWalletFromFile: (args: unknown) => mockRestore(args),
}));

vi.mock("../../../onboarding/wallet-password.js", () => ({
  withFreshKeystorePassword: async <T>(
    fn: (ctx: { password: string }) => Promise<T>
  ): Promise<T> => fn({ password: "test-password-12" }),
  isPasswordSetupError: (v: unknown) =>
    typeof v === "object" &&
    v !== null &&
    "ok" in v &&
    (v as { ok: unknown }).ok === false,
}));

vi.mock("../../../onboarding/wallet-mutex.js", () => ({
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

vi.mock("../../../logger/index.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { registerWalletHandlers } = await import("../wallets.js");
const { CH } = await import("@shared/ipc/channels.js");

const trustedSender = {
  senderFrame: { url: "app://vex/index.html" },
  sender: { send: vi.fn(), isDestroyed: () => false },
};

beforeEach(() => {
  handlers.clear();
  mockGenerateEvm.mockReset();
  mockGenerateSolana.mockReset();
  mockImportEvm.mockReset();
  mockImportSolana.mockReset();
  mockRestore.mockReset();
  mockShowOpenDialog.mockReset();
  mockShowMessageBox.mockReset();
  mockShellOpenPath.mockReset();
  mockBrowserWindowFromWebContents.mockReturnValue(null);
  mockRealpath.mockReset();
  mockStat.mockReset();
});

afterEach(() => {
  handlers.clear();
  vi.clearAllMocks();
});

describe("walletGenerateEvm handler", () => {
  it("returns ok({address}) on runner success", async () => {
    mockGenerateEvm.mockResolvedValue({
      ok: true,
      data: { address: "0xabcdef0123456789abcdef0123456789abcdef01" },
    });
    registerWalletHandlers();
    const fn = handlers.get(CH.onboarding.walletGenerateEvm)!;
    const result = (await fn(trustedSender, {
      requestId: "r1",
      payload: {},
    })) as { ok: boolean; data?: { address: string } };
    expect(result.ok).toBe(true);
    expect(result.data?.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  it("propagates runner err unchanged", async () => {
    mockGenerateEvm.mockResolvedValue({
      ok: false,
      error: {
        code: "wallet.policy_blocked",
        domain: "wallet",
        message: "Already exists",
        retryable: false,
        userActionable: true,
        redacted: true,
      },
    });
    registerWalletHandlers();
    const fn = handlers.get(CH.onboarding.walletGenerateEvm)!;
    const result = (await fn(trustedSender, {
      requestId: "r2",
      payload: {},
    })) as { ok: boolean; error?: { code: string } };
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("wallet.policy_blocked");
  });
});

describe("walletGenerateSolana handler", () => {
  it("returns ok({address}) on runner success", async () => {
    mockGenerateSolana.mockResolvedValue({
      ok: true,
      data: { address: "DRpbCBMxVnDK7maPM5tGv6MvCsx1WTokJBKVz5Pk5Hxe" },
    });
    registerWalletHandlers();
    const fn = handlers.get(CH.onboarding.walletGenerateSolana)!;
    const result = (await fn(trustedSender, {
      requestId: "r3",
      payload: {},
    })) as { ok: boolean; data?: { address: string } };
    expect(result.ok).toBe(true);
  });
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

describe("walletRestoreFromBackup handler", () => {
  it("returns internal.cancelled when user cancels file picker", async () => {
    mockShowOpenDialog.mockResolvedValue({
      canceled: true,
      filePaths: [],
    });
    registerWalletHandlers();
    const fn = handlers.get(CH.onboarding.walletRestoreFromBackup)!;
    const result = (await fn(trustedSender, {
      requestId: "r6",
      payload: { chain: "evm" },
    })) as { ok: boolean; error?: { code: string } };
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("internal.cancelled");
    expect(mockRestore).not.toHaveBeenCalled();
  });

  it("calls restoreWalletFromFile with picked path on success", async () => {
    mockShowOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: ["/tmp/keystore.json"],
    });
    mockRestore.mockResolvedValue({
      ok: true,
      data: {
        chain: "evm",
        address: "0xabcdef0123456789abcdef0123456789abcdef01",
        replacedAddress: null,
        backupDir: null,
      },
    });
    registerWalletHandlers();
    const fn = handlers.get(CH.onboarding.walletRestoreFromBackup)!;
    const result = (await fn(trustedSender, {
      requestId: "r7",
      payload: { chain: "evm" },
    })) as { ok: boolean };
    expect(result.ok).toBe(true);
    expect(mockRestore).toHaveBeenCalledWith(
      expect.objectContaining({
        chain: "evm",
        sourcePath: "/tmp/keystore.json",
        password: "test-password-12",
      })
    );
  });
});

describe("walletOpenBackupFolder handler", () => {
  it("rejects paths outside ${CONFIG_DIR}/backups (realpath-safe)", async () => {
    mockRealpath
      .mockResolvedValueOnce("/home/user/.config/vex/backups")
      .mockResolvedValueOnce("/etc/passwd-secret");
    registerWalletHandlers();
    const fn = handlers.get(CH.onboarding.walletOpenBackupFolder)!;
    const result = (await fn(trustedSender, {
      requestId: "r8",
      payload: { backupDir: "/etc/passwd-secret" },
    })) as { ok: boolean; error?: { code: string } };
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("validation.invalid_input");
    expect(mockShellOpenPath).not.toHaveBeenCalled();
  });

  it("opens the path when realpath stays inside the backups base + is a directory", async () => {
    mockRealpath
      .mockResolvedValueOnce("/home/user/.config/vex/backups")
      .mockResolvedValueOnce("/home/user/.config/vex/backups/T123");
    mockStat.mockResolvedValue({ isDirectory: () => true });
    mockShellOpenPath.mockResolvedValue("");
    registerWalletHandlers();
    const fn = handlers.get(CH.onboarding.walletOpenBackupFolder)!;
    const result = (await fn(trustedSender, {
      requestId: "r9",
      payload: { backupDir: "/home/user/.config/vex/backups/T123" },
    })) as { ok: boolean; data?: { ok: boolean } };
    expect(result.ok).toBe(true);
    expect(result.data?.ok).toBe(true);
    expect(mockShellOpenPath).toHaveBeenCalledWith(
      "/home/user/.config/vex/backups/T123"
    );
  });

  it("passes the realpath-resolved candidate to shell.openPath, not the raw input (codex turn 10)", async () => {
    // User picked a symlinked path; resolved realpath differs but
    // still points inside backups base. Handler MUST hand the
    // resolved path to shell.openPath to avoid the TOCTOU swap.
    mockRealpath
      .mockResolvedValueOnce("/home/user/.config/vex/backups")
      .mockResolvedValueOnce("/home/user/.config/vex/backups/T-real");
    mockStat.mockResolvedValue({ isDirectory: () => true });
    mockShellOpenPath.mockResolvedValue("");
    registerWalletHandlers();
    const fn = handlers.get(CH.onboarding.walletOpenBackupFolder)!;
    const result = (await fn(trustedSender, {
      requestId: "r10",
      payload: {
        backupDir: "/home/user/.config/vex/backups/symlink-alias",
      },
    })) as { ok: boolean };
    expect(result.ok).toBe(true);
    expect(mockShellOpenPath).toHaveBeenCalledWith(
      "/home/user/.config/vex/backups/T-real"
    );
    expect(mockShellOpenPath).not.toHaveBeenCalledWith(
      "/home/user/.config/vex/backups/symlink-alias"
    );
  });
});
