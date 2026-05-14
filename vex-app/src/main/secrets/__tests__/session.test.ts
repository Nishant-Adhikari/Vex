/**
 * Tests for the secret-vault session module.
 *
 * Focuses on the lock/unlock state machine without exercising real scrypt or
 * filesystem IO — the underlying vault library is mocked so we can assert
 * exactly what `lockSecretSession()` zeros out and what `getSecretSessionStatus()`
 * reports.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockApplySecretVaultToProcessEnv = vi.fn();
const mockCreateSecretVault = vi.fn();
const mockGetSecretVaultStatus = vi.fn();
const mockStripManagedSecretsFromDotenvFile = vi.fn();
const mockUnlockSecretVault = vi.fn();
const mockWriteSecretVaultSecrets = vi.fn();

class LocalSecretVaultErrorMock extends Error {
  constructor(
    message: string,
    readonly code: "missing" | "invalid_password" | "corrupt" | "io",
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "LocalSecretVaultError";
  }
}

vi.mock("@vex-lib/local-secret-vault.js", () => ({
  applySecretVaultToProcessEnv: (...args: unknown[]) =>
    mockApplySecretVaultToProcessEnv(...args),
  createSecretVault: (...args: unknown[]) => mockCreateSecretVault(...args),
  getSecretVaultStatus: (...args: unknown[]) =>
    mockGetSecretVaultStatus(...args),
  LocalSecretVaultError: LocalSecretVaultErrorMock,
  stripManagedSecretsFromDotenvFile: (...args: unknown[]) =>
    mockStripManagedSecretsFromDotenvFile(...args),
  unlockSecretVault: (...args: unknown[]) => mockUnlockSecretVault(...args),
  writeSecretVaultSecrets: (...args: unknown[]) =>
    mockWriteSecretVaultSecrets(...args),
}));

vi.mock("@vex-lib/secret-keys.js", () => ({
  MASTER_PASSWORD_ENV_KEY: "VEX_MASTER_PASSWORD",
  VAULT_SECRET_KEYS: ["JUPITER_API_KEY"] as const,
}));

vi.mock("../../paths/config-dir.js", () => ({
  ENV_FILE: "/tmp/vex-test-env",
  SECRETS_VAULT_FILE: "/tmp/vex-test-vault",
}));

vi.mock("../../logger/index.js", () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

async function loadSession(): Promise<typeof import("../session.js")> {
  vi.resetModules();
  return import("../session.js");
}

beforeEach(() => {
  mockApplySecretVaultToProcessEnv.mockReset();
  mockCreateSecretVault.mockReset();
  mockGetSecretVaultStatus.mockReset();
  mockStripManagedSecretsFromDotenvFile.mockReset();
  mockUnlockSecretVault.mockReset();
  mockWriteSecretVaultSecrets.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("lockSecretSession", () => {
  it("flips status.unlocked back to false after a successful unlock", async () => {
    mockGetSecretVaultStatus.mockReturnValue({ configured: true });
    mockUnlockSecretVault.mockReturnValue({
      version: 1,
      secrets: {},
    });

    const session = await loadSession();
    const unlock = session.unlockSecretSession("correct-password");
    expect(unlock.ok).toBe(true);
    expect(session.getSecretSessionStatus()).toEqual({
      vaultConfigured: true,
      unlocked: true,
    });

    session.lockSecretSession();
    expect(session.getSecretSessionStatus()).toEqual({
      vaultConfigured: true,
      unlocked: false,
    });
  });

  it("locks even when never unlocked (idempotent at rest)", async () => {
    mockGetSecretVaultStatus.mockReturnValue({ configured: true });
    const session = await loadSession();
    expect(session.getSecretSessionStatus().unlocked).toBe(false);
    session.lockSecretSession();
    expect(session.getSecretSessionStatus().unlocked).toBe(false);
  });

  it("is idempotent across repeated calls", async () => {
    mockGetSecretVaultStatus.mockReturnValue({ configured: true });
    mockUnlockSecretVault.mockReturnValue({ version: 1, secrets: {} });

    const session = await loadSession();
    session.unlockSecretSession("correct-password");
    session.lockSecretSession();
    session.lockSecretSession();
    session.lockSecretSession();
    expect(session.getSecretSessionStatus().unlocked).toBe(false);
  });

  it("requireUnlockedMasterPassword fails after lock", async () => {
    mockGetSecretVaultStatus.mockReturnValue({ configured: true });
    mockUnlockSecretVault.mockReturnValue({ version: 1, secrets: {} });

    const session = await loadSession();
    session.unlockSecretSession("correct-password");
    expect(session.requireUnlockedMasterPassword().ok).toBe(true);

    session.lockSecretSession();
    const result = session.requireUnlockedMasterPassword();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("wallet.keystore_locked");
    }
  });
});

describe("unlockSecretSession error mapping", () => {
  it("maps LocalSecretVaultError('missing') to wallet.vault_not_configured", async () => {
    mockGetSecretVaultStatus.mockReturnValue({ configured: false });
    mockUnlockSecretVault.mockImplementation(() => {
      throw new LocalSecretVaultErrorMock("vault file missing", "missing");
    });

    const session = await loadSession();
    const result = session.unlockSecretSession("anypassword");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("wallet.vault_not_configured");
      expect(result.error.retryable).toBe(false);
    }
  });

  it("maps LocalSecretVaultError('invalid_password') to wallet.password_invalid", async () => {
    mockGetSecretVaultStatus.mockReturnValue({ configured: true });
    mockUnlockSecretVault.mockImplementation(() => {
      throw new LocalSecretVaultErrorMock("wrong password", "invalid_password");
    });

    const session = await loadSession();
    const result = session.unlockSecretSession("wrong");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("wallet.password_invalid");
      expect(result.error.retryable).toBe(true);
    }
  });
});
