/**
 * Tests for wallets-runner — the M8 main-side wrapper around engine
 * createWallet/importWallet. Mocks @vex-lib/wallet so we exercise the
 * VexError → public Result mapping without touching real keystore I/O.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockCreateWallet = vi.fn();
const mockCreateSolanaWallet = vi.fn();
const mockImportWallet = vi.fn();
const mockImportSolanaWallet = vi.fn();
const mockCreateEvmEntry = vi.fn();
const mockImportEvmEntry = vi.fn();
const mockCreateSolanaEntry = vi.fn();
const mockImportSolanaEntry = vi.fn();
const mockExportAllWallets = vi.fn();

vi.mock("@vex-lib/wallet.js", () => ({
  createWallet: () => mockCreateWallet(),
  createSolanaWallet: () => mockCreateSolanaWallet(),
  importWallet: (rawKey: string) => mockImportWallet(rawKey),
  importSolanaWallet: (rawKey: string) => mockImportSolanaWallet(rawKey),
  createEvmWalletEntry: (opts: unknown) => mockCreateEvmEntry(opts),
  importEvmWalletEntry: (rawKey: string, opts: unknown) =>
    mockImportEvmEntry(rawKey, opts),
  createSolanaWalletEntry: (opts: unknown) => mockCreateSolanaEntry(opts),
  importSolanaWalletEntry: (rawKey: string, opts: unknown) =>
    mockImportSolanaEntry(rawKey, opts),
  exportAllWallets: (destDir: string) => mockExportAllWallets(destDir),
}));

vi.mock("../../logger/index.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const {
  addEvmWallet,
  addSolanaWallet,
  exportAllWalletsRunner,
  generateEvmWallet,
  generateSolanaWallet,
  importEvmWallet,
  importEvmWalletInventory,
  importSolanaWalletInventory,
  importSolanaWalletRunner,
  mapWalletEngineError,
} = await import("../wallets-runner.js");

class FakeVexError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "VexError";
  }
}

beforeEach(() => {
  mockCreateWallet.mockReset();
  mockCreateSolanaWallet.mockReset();
  mockImportWallet.mockReset();
  mockImportSolanaWallet.mockReset();
  mockCreateEvmEntry.mockReset();
  mockImportEvmEntry.mockReset();
  mockCreateSolanaEntry.mockReset();
  mockImportSolanaEntry.mockReset();
  mockExportAllWallets.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("generateEvmWallet", () => {
  it("returns ok({address}) on engine success", async () => {
    mockCreateWallet.mockResolvedValue({
      address: "0xabcdef0123456789abcdef0123456789abcdef01",
      chainId: 1,
      overwritten: false,
    });
    const result = await generateEvmWallet();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.address).toBe(
        "0xabcdef0123456789abcdef0123456789abcdef01"
      );
    }
  });

  it("maps KEYSTORE_ALREADY_EXISTS to wallet.policy_blocked", async () => {
    mockCreateWallet.mockRejectedValue(
      new FakeVexError("KEYSTORE_ALREADY_EXISTS", "Keystore already exists.")
    );
    const result = await generateEvmWallet();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("wallet.policy_blocked");
      expect(result.error.userActionable).toBe(true);
    }
  });

  it("maps KEYSTORE_PASSWORD_NOT_SET to wallet.password_invalid", async () => {
    mockCreateWallet.mockRejectedValue(
      new FakeVexError("KEYSTORE_PASSWORD_NOT_SET", "Password not set.")
    );
    const result = await generateEvmWallet();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("wallet.password_invalid");
  });
});

describe("generateSolanaWallet", () => {
  it("returns ok({address}) on engine success", async () => {
    mockCreateSolanaWallet.mockResolvedValue({
      address: "DRpbCBMxVnDK7maPM5tGv6MvCsx1WTokJBKVz5Pk5Hxe",
      overwritten: false,
    });
    const result = await generateSolanaWallet();
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(result.data.address).toBe(
        "DRpbCBMxVnDK7maPM5tGv6MvCsx1WTokJBKVz5Pk5Hxe"
      );
  });
});

describe("importEvmWallet", () => {
  it("rejects bad EVM private key format with validation.invalid_input", async () => {
    mockImportWallet.mockRejectedValue(
      new Error("Invalid private key: must be 32 bytes hex")
    );
    const result = await importEvmWallet("garbage");
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error.code).toBe("validation.invalid_input");
  });

  it("returns ok on engine success", async () => {
    mockImportWallet.mockResolvedValue({
      address: "0xabcdef0123456789abcdef0123456789abcdef01",
      chainId: 1,
      overwritten: false,
    });
    const result = await importEvmWallet("0xabc…valid…");
    expect(result.ok).toBe(true);
  });
});

describe("importSolanaWalletRunner", () => {
  it("maps INVALID_PRIVATE_KEY VexError to validation.invalid_input", async () => {
    mockImportSolanaWallet.mockRejectedValue(
      new FakeVexError(
        "INVALID_PRIVATE_KEY",
        "Solana secret key must be base58 or JSON byte array"
      )
    );
    const result = await importSolanaWalletRunner("garbage");
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error.code).toBe("validation.invalid_input");
  });
});

describe("mapWalletEngineError", () => {
  it("maps unrecognised errors to internal.unexpected", () => {
    const result = mapWalletEngineError(new Error("totally unexpected"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("internal.unexpected");
  });

  it("maps AUTO_BACKUP_FAILED to onboarding.env_persist_failed", () => {
    const result = mapWalletEngineError(
      new FakeVexError("AUTO_BACKUP_FAILED", "boom")
    );
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error.code).toBe("onboarding.env_persist_failed");
  });

  it("maps KEYSTORE_DECRYPT_FAILED to wallet.password_invalid", () => {
    const result = mapWalletEngineError(
      new FakeVexError("KEYSTORE_DECRYPT_FAILED", "wrong pass")
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("wallet.password_invalid");
  });

  it("maps KEYSTORE_NOT_FOUND to wallet.keystore_missing (distinct from corrupt)", () => {
    const result = mapWalletEngineError(
      new FakeVexError("KEYSTORE_NOT_FOUND", "file missing")
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("wallet.keystore_missing");
  });

  it("maps KEYSTORE_CORRUPT to wallet.keystore_corrupt (file present but bad)", () => {
    const result = mapWalletEngineError(
      new FakeVexError("KEYSTORE_CORRUPT", "bad schema")
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("wallet.keystore_corrupt");
  });

  // ── Multi-wallet inventory codes (puzzle 5 phase 5D) ──────────────────────
  it("maps WALLET_INVENTORY_FULL to wallet.cap_reached", () => {
    const result = mapWalletEngineError(
      new FakeVexError("WALLET_INVENTORY_FULL", "cap")
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("wallet.cap_reached");
      expect(result.error.userActionable).toBe(true);
    }
  });

  it("maps WALLET_DUPLICATE_ADDRESS to wallet.address_exists", () => {
    const result = mapWalletEngineError(
      new FakeVexError("WALLET_DUPLICATE_ADDRESS", "dup")
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("wallet.address_exists");
  });

  it("maps AGENT_VALIDATION_ERROR to validation.invalid_input", () => {
    const result = mapWalletEngineError(
      new FakeVexError("AGENT_VALIDATION_ERROR", "label too long")
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("validation.invalid_input");
  });
});

describe("addEvmWallet (inventory generate-add)", () => {
  it("returns ok({id,address,label}) on success", async () => {
    mockCreateEvmEntry.mockReturnValue({
      id: "evm_abc",
      address: "0xabcdef0123456789abcdef0123456789abcdef01",
      label: "EVM 2",
    });
    const result = await addEvmWallet("EVM 2");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual({
        id: "evm_abc",
        address: "0xabcdef0123456789abcdef0123456789abcdef01",
        label: "EVM 2",
      });
    }
    expect(mockCreateEvmEntry).toHaveBeenCalledWith({ label: "EVM 2" });
  });

  it("maps the cap throw to wallet.cap_reached", async () => {
    mockCreateEvmEntry.mockImplementation(() => {
      throw new FakeVexError("WALLET_INVENTORY_FULL", "cap");
    });
    const result = await addEvmWallet();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("wallet.cap_reached");
  });
});

describe("importEvmWalletInventory (inventory import-add)", () => {
  it("maps the duplicate throw to wallet.address_exists", async () => {
    mockImportEvmEntry.mockImplementation(() => {
      throw new FakeVexError("WALLET_DUPLICATE_ADDRESS", "dup");
    });
    const result = await importEvmWalletInventory("0xkey", "EVM 2");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("wallet.address_exists");
    expect(mockImportEvmEntry).toHaveBeenCalledWith("0xkey", { label: "EVM 2" });
  });
});

describe("addSolanaWallet / importSolanaWalletInventory", () => {
  it("maps the label-too-long throw to validation.invalid_input", async () => {
    mockCreateSolanaEntry.mockImplementation(() => {
      throw new FakeVexError("AGENT_VALIDATION_ERROR", "label too long");
    });
    const result = await addSolanaWallet("x".repeat(200));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("validation.invalid_input");
  });

  it("import-add returns ok({id,address,label}) on success", async () => {
    mockImportSolanaEntry.mockReturnValue({
      id: "sol_xyz",
      address: "DRpbCBMxVnDK7maPM5tGv6MvCsx1WTokJBKVz5Pk5Hxe",
      label: "Solana 2",
    });
    const result = await importSolanaWalletInventory("base58key");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.id).toBe("sol_xyz");
  });
});

describe("exportAllWalletsRunner", () => {
  it("returns ok({files}) on success", async () => {
    mockExportAllWallets.mockReturnValue({
      files: ["wallet-evm_a.json", "manifest.json"],
    });
    const result = await exportAllWalletsRunner("/tmp/export");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.files).toContain("manifest.json");
    expect(mockExportAllWallets).toHaveBeenCalledWith("/tmp/export");
  });

  it("maps an unexpected throw to internal.unexpected", async () => {
    mockExportAllWallets.mockImplementation(() => {
      throw new Error("disk full");
    });
    const result = await exportAllWalletsRunner("/tmp/export");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("internal.unexpected");
  });
});
