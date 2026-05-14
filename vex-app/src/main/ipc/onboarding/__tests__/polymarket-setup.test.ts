/**
 * Tests for the vex.onboarding.polymarketAutoSetup IPC handler (Phase 2 #7).
 *
 * Mocks: electron (ipcMain), secrets/session, env-write-mutex, engine
 * acquire primitive (@vex-lib/polymarket), engine wallet loader
 * (@vex-lib/wallet), vault verify (@vex-lib/local-secret-vault), logger.
 *
 * Exercises:
 *  - Zod input validation at the boundary
 *  - Session lock check
 *  - Keystore-missing branch
 *  - Pre-network overwrite check (when trio already present)
 *  - Vault re-auth failure
 *  - Keystore decrypt failure inside acquire (mismatched password state)
 *  - Acquire mapping for POLYMARKET_AUTH_FAILED + HTTP_REQUEST_FAILED
 *  - Happy path (persisted)
 *  - TOCTOU race re-check INSIDE the env-write lock
 *  - VEX_KEYSTORE_PASSWORD untouched throughout
 *  - Audit log carries only address + correlationId
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createTestWebContents,
  createTrustedSender,
  type TestIpcEvent,
} from "../../__tests__/test-sender.js";

type Handler = (
  event: TestIpcEvent,
  raw: unknown,
) => Promise<unknown>;

const handlers = new Map<string, Handler>();

// ── Mocks (regular Jest-style; loaded before handler import) ──────────────
const mockGetSecretSessionStatus = vi.fn();
const mockGetUnlockedSecretPresence = vi.fn();
const mockWriteUnlockedSecrets = vi.fn();

const mockLoadKeystore = vi.fn();
const mockVerifySecretVaultPassword = vi.fn();

const mockAcquireCredentials = vi.fn();

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

class FakeEngineVexError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "VexError";
  }
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
}));

vi.mock("../../../secrets/session.js", () => ({
  getSecretSessionStatus: () => mockGetSecretSessionStatus(),
  getUnlockedSecretPresence: () => mockGetUnlockedSecretPresence(),
  writeUnlockedSecrets: (updates: unknown) =>
    mockWriteUnlockedSecrets(updates),
}));

vi.mock("../../../onboarding/env-write-mutex.js", () => ({
  withEnvWriteLock: <T>(fn: () => Promise<T>) => fn(),
}));

vi.mock("@vex-lib/polymarket.js", () => ({
  acquirePolymarketCredentialsWithPassword: (password: string) =>
    mockAcquireCredentials(password),
}));

vi.mock("@vex-lib/wallet.js", () => ({
  loadKeystore: () => mockLoadKeystore(),
}));

vi.mock("@vex-lib/local-secret-vault.js", () => ({
  LocalSecretVaultError: LocalSecretVaultErrorMock,
  verifySecretVaultPassword: (...args: unknown[]) =>
    mockVerifySecretVaultPassword(...args),
}));

vi.mock("../../../paths/config-dir.js", () => ({
  SECRETS_VAULT_FILE: "/tmp/vex-test-vault",
}));

const mockLog = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

vi.mock("../../../logger/index.js", () => ({
  log: mockLog,
}));

const { registerPolymarketSetupHandler } = await import(
  "../polymarket-setup.js"
);
const { CH } = await import("@shared/ipc/channels.js");

const trustedSender = createTrustedSender({ sender: createTestWebContents() });

// ── Test fixtures ─────────────────────────────────────────────────────────
const VALID_INPUT = {
  password: "correct-password-12",
  riskAcknowledged: true as const,
  overwriteConfirmed: false,
};

const STUB_KEYSTORE = {
  version: 1,
  ciphertext: "x",
  iv: "y",
  salt: "z",
  tag: "t",
  kdf: { name: "scrypt", N: 16384, r: 8, p: 1, dkLen: 32 },
};

const STUB_ADDRESS = "0xAbCdEf0123456789AbCdEf0123456789AbCdEf01" as const;
const STUB_CREDS = {
  apiKey: "k-secret",
  secret: "s-secret",
  passphrase: "p-secret",
};

// ── Env snapshot guard ────────────────────────────────────────────────────
let envSnapshot: NodeJS.ProcessEnv;

beforeEach(() => {
  envSnapshot = { ...process.env };
  delete process.env.VEX_KEYSTORE_PASSWORD;

  handlers.clear();
  mockGetSecretSessionStatus.mockReset();
  mockGetUnlockedSecretPresence.mockReset();
  mockWriteUnlockedSecrets.mockReset();
  mockLoadKeystore.mockReset();
  mockVerifySecretVaultPassword.mockReset();
  mockAcquireCredentials.mockReset();
  mockLog.info.mockClear();
  mockLog.warn.mockClear();
  mockLog.error.mockClear();
  mockLog.debug.mockClear();
});

afterEach(() => {
  handlers.clear();
  vi.clearAllMocks();
  process.env = envSnapshot;
});

function getHandler(): Handler {
  registerPolymarketSetupHandler();
  const fn = handlers.get(CH.onboarding.polymarketAutoSetup);
  if (!fn) throw new Error("handler not registered");
  return fn;
}

interface ErrResult {
  readonly ok: false;
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly domain: string;
    readonly correlationId?: string;
  };
}

interface OkResult<T> {
  readonly ok: true;
  readonly data: T;
}

function expectVexKeystorePasswordUntouched(): void {
  expect(process.env.VEX_KEYSTORE_PASSWORD).toBeUndefined();
}

// ── Cases ─────────────────────────────────────────────────────────────────

describe("input validation (Zod schema at boundary)", () => {
  it("rejects missing password", async () => {
    const fn = getHandler();
    const result = (await fn(trustedSender, {
      requestId: "v1",
      payload: { riskAcknowledged: true, overwriteConfirmed: false },
    })) as ErrResult;
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("validation.invalid_input");
    expect(mockAcquireCredentials).not.toHaveBeenCalled();
  });

  it("rejects riskAcknowledged: false", async () => {
    const fn = getHandler();
    const result = (await fn(trustedSender, {
      requestId: "v2",
      payload: {
        password: "correct-password-12",
        riskAcknowledged: false,
        overwriteConfirmed: false,
      },
    })) as ErrResult;
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("validation.invalid_input");
  });

  it("rejects extra (strict-mode) properties", async () => {
    const fn = getHandler();
    const result = (await fn(trustedSender, {
      requestId: "v3",
      payload: { ...VALID_INPUT, extra: "smuggle" },
    })) as ErrResult;
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("validation.invalid_input");
  });
});

describe("preconditions", () => {
  it("returns wallet.keystore_locked when the session is locked", async () => {
    mockGetSecretSessionStatus.mockReturnValue({
      vaultConfigured: true,
      unlocked: false,
    });
    const fn = getHandler();
    const result = (await fn(trustedSender, {
      requestId: "pre-1",
      payload: VALID_INPUT,
    })) as ErrResult;
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("wallet.keystore_locked");
    expect(mockVerifySecretVaultPassword).not.toHaveBeenCalled();
    expect(mockAcquireCredentials).not.toHaveBeenCalled();
    expectVexKeystorePasswordUntouched();
  });

  it("returns wallet.keystore_missing when the EVM keystore is absent", async () => {
    mockGetSecretSessionStatus.mockReturnValue({
      vaultConfigured: true,
      unlocked: true,
    });
    mockLoadKeystore.mockReturnValue(null);
    const fn = getHandler();
    const result = (await fn(trustedSender, {
      requestId: "pre-2",
      payload: VALID_INPUT,
    })) as ErrResult;
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("wallet.keystore_missing");
    expect(mockVerifySecretVaultPassword).not.toHaveBeenCalled();
    expect(mockAcquireCredentials).not.toHaveBeenCalled();
    expectVexKeystorePasswordUntouched();
  });

  it("returns wallet.keystore_corrupt when loadKeystore throws KEYSTORE_CORRUPT", async () => {
    mockGetSecretSessionStatus.mockReturnValue({
      vaultConfigured: true,
      unlocked: true,
    });
    mockLoadKeystore.mockImplementation(() => {
      throw new FakeEngineVexError("KEYSTORE_CORRUPT", "malformed JSON");
    });
    const fn = getHandler();
    const result = (await fn(trustedSender, {
      requestId: "pre-3",
      payload: VALID_INPUT,
    })) as ErrResult;
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("wallet.keystore_corrupt");
    expect(mockVerifySecretVaultPassword).not.toHaveBeenCalled();
    expect(mockAcquireCredentials).not.toHaveBeenCalled();
    expectVexKeystorePasswordUntouched();
  });

  it("returns wallet.keystore_locked when the presence probe self-relocks pre-network", async () => {
    mockGetSecretSessionStatus.mockReturnValue({
      vaultConfigured: true,
      unlocked: true,
    });
    mockLoadKeystore.mockReturnValue(STUB_KEYSTORE);
    mockGetUnlockedSecretPresence.mockReturnValue({
      vaultConfigured: true,
      unlocked: false,
      secrets: {},
    });
    const fn = getHandler();
    const result = (await fn(trustedSender, {
      requestId: "pre-4",
      payload: VALID_INPUT,
    })) as ErrResult;
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("wallet.keystore_locked");
    // Critical: we must NOT have made a network call or persisted anything.
    expect(mockVerifySecretVaultPassword).not.toHaveBeenCalled();
    expect(mockAcquireCredentials).not.toHaveBeenCalled();
    expect(mockWriteUnlockedSecrets).not.toHaveBeenCalled();
    expectVexKeystorePasswordUntouched();
  });
});

describe("pre-network overwrite check", () => {
  it("returns wallet.risk_confirmation_required when trio configured + overwriteConfirmed=false", async () => {
    mockGetSecretSessionStatus.mockReturnValue({
      vaultConfigured: true,
      unlocked: true,
    });
    mockLoadKeystore.mockReturnValue(STUB_KEYSTORE);
    mockGetUnlockedSecretPresence.mockReturnValue({
      vaultConfigured: true,
      unlocked: true,
      secrets: {
        POLYMARKET_API_KEY: true,
        POLYMARKET_API_SECRET: true,
        POLYMARKET_PASSPHRASE: true,
      },
    });
    const fn = getHandler();
    const result = (await fn(trustedSender, {
      requestId: "ov-1",
      payload: VALID_INPUT,
    })) as ErrResult;
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("wallet.risk_confirmation_required");
    // No network call should fire when the user has not confirmed overwrite.
    expect(mockVerifySecretVaultPassword).not.toHaveBeenCalled();
    expect(mockAcquireCredentials).not.toHaveBeenCalled();
    expect(mockWriteUnlockedSecrets).not.toHaveBeenCalled();
    expectVexKeystorePasswordUntouched();
  });

  it("proceeds past the pre-network check when overwriteConfirmed=true", async () => {
    mockGetSecretSessionStatus.mockReturnValue({
      vaultConfigured: true,
      unlocked: true,
    });
    mockLoadKeystore.mockReturnValue(STUB_KEYSTORE);
    mockGetUnlockedSecretPresence.mockReturnValue({
      vaultConfigured: true,
      unlocked: true,
      secrets: {
        POLYMARKET_API_KEY: true,
        POLYMARKET_API_SECRET: true,
        POLYMARKET_PASSPHRASE: true,
      },
    });
    mockVerifySecretVaultPassword.mockReturnValue(undefined);
    mockAcquireCredentials.mockResolvedValue({
      address: STUB_ADDRESS,
      credentials: STUB_CREDS,
    });
    mockWriteUnlockedSecrets.mockReturnValue({ ok: true, data: undefined });

    const fn = getHandler();
    const result = (await fn(trustedSender, {
      requestId: "ov-2",
      payload: { ...VALID_INPUT, overwriteConfirmed: true },
    })) as OkResult<{ configured: true; address: string }>;

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.address).toBe(STUB_ADDRESS);
    }
    expect(mockAcquireCredentials).toHaveBeenCalledTimes(1);
  });
});

describe("vault re-auth", () => {
  beforeEach(() => {
    mockGetSecretSessionStatus.mockReturnValue({
      vaultConfigured: true,
      unlocked: true,
    });
    mockLoadKeystore.mockReturnValue(STUB_KEYSTORE);
    mockGetUnlockedSecretPresence.mockReturnValue({
      vaultConfigured: true,
      unlocked: true,
      secrets: {},
    });
  });

  it("returns wallet.password_invalid when the vault password is wrong", async () => {
    mockVerifySecretVaultPassword.mockImplementation(() => {
      throw new LocalSecretVaultErrorMock("wrong", "invalid_password");
    });
    const fn = getHandler();
    const result = (await fn(trustedSender, {
      requestId: "auth-1",
      payload: VALID_INPUT,
    })) as ErrResult;
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("wallet.password_invalid");
    expect(mockAcquireCredentials).not.toHaveBeenCalled();
    expectVexKeystorePasswordUntouched();
  });

  it("returns wallet.vault_not_configured when the vault is missing", async () => {
    mockVerifySecretVaultPassword.mockImplementation(() => {
      throw new LocalSecretVaultErrorMock("absent", "missing");
    });
    const fn = getHandler();
    const result = (await fn(trustedSender, {
      requestId: "auth-2",
      payload: VALID_INPUT,
    })) as ErrResult;
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("wallet.vault_not_configured");
  });
});

describe("acquire mapping", () => {
  beforeEach(() => {
    mockGetSecretSessionStatus.mockReturnValue({
      vaultConfigured: true,
      unlocked: true,
    });
    mockLoadKeystore.mockReturnValue(STUB_KEYSTORE);
    mockGetUnlockedSecretPresence.mockReturnValue({
      vaultConfigured: true,
      unlocked: true,
      secrets: {},
    });
    mockVerifySecretVaultPassword.mockReturnValue(undefined);
  });

  it("maps engine KEYSTORE_DECRYPT_FAILED to wallet.password_invalid", async () => {
    mockAcquireCredentials.mockRejectedValue(
      new FakeEngineVexError("KEYSTORE_DECRYPT_FAILED", "wrong key"),
    );
    const fn = getHandler();
    const result = (await fn(trustedSender, {
      requestId: "acq-1",
      payload: VALID_INPUT,
    })) as ErrResult;
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("wallet.password_invalid");
    expect(mockWriteUnlockedSecrets).not.toHaveBeenCalled();
  });

  it("maps POLYMARKET_AUTH_FAILED to provider.polymarket_setup_failed", async () => {
    mockAcquireCredentials.mockRejectedValue(
      new FakeEngineVexError("POLYMARKET_AUTH_FAILED", "rejected"),
    );
    const fn = getHandler();
    const result = (await fn(trustedSender, {
      requestId: "acq-2",
      payload: VALID_INPUT,
    })) as ErrResult;
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("provider.polymarket_setup_failed");
    expect(result.error.domain).toBe("onboarding");
    expect(mockWriteUnlockedSecrets).not.toHaveBeenCalled();
  });

  it("maps HTTP_REQUEST_FAILED to provider.unavailable", async () => {
    mockAcquireCredentials.mockRejectedValue(
      new FakeEngineVexError("HTTP_REQUEST_FAILED", "timeout"),
    );
    const fn = getHandler();
    const result = (await fn(trustedSender, {
      requestId: "acq-3",
      payload: VALID_INPUT,
    })) as ErrResult;
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("provider.unavailable");
    expect(mockWriteUnlockedSecrets).not.toHaveBeenCalled();
  });

  it("maps engine KEYSTORE_NOT_FOUND to wallet.keystore_missing", async () => {
    mockAcquireCredentials.mockRejectedValue(
      new FakeEngineVexError("KEYSTORE_NOT_FOUND", "absent"),
    );
    const fn = getHandler();
    const result = (await fn(trustedSender, {
      requestId: "acq-4",
      payload: VALID_INPUT,
    })) as ErrResult;
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("wallet.keystore_missing");
  });

  it("maps engine KEYSTORE_CORRUPT to wallet.keystore_corrupt", async () => {
    mockAcquireCredentials.mockRejectedValue(
      new FakeEngineVexError("KEYSTORE_CORRUPT", "bad ciphertext"),
    );
    const fn = getHandler();
    const result = (await fn(trustedSender, {
      requestId: "acq-5",
      payload: VALID_INPUT,
    })) as ErrResult;
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("wallet.keystore_corrupt");
    expect(mockWriteUnlockedSecrets).not.toHaveBeenCalled();
  });
});

describe("happy path", () => {
  it("persists the trio via writeUnlockedSecrets and returns the address", async () => {
    mockGetSecretSessionStatus.mockReturnValue({
      vaultConfigured: true,
      unlocked: true,
    });
    mockLoadKeystore.mockReturnValue(STUB_KEYSTORE);
    mockGetUnlockedSecretPresence.mockReturnValue({
      vaultConfigured: true,
      unlocked: true,
      secrets: {},
    });
    mockVerifySecretVaultPassword.mockReturnValue(undefined);
    mockAcquireCredentials.mockResolvedValue({
      address: STUB_ADDRESS,
      credentials: STUB_CREDS,
    });
    mockWriteUnlockedSecrets.mockReturnValue({ ok: true, data: undefined });

    const fn = getHandler();
    const result = (await fn(trustedSender, {
      requestId: "happy-1",
      payload: VALID_INPUT,
    })) as OkResult<{ configured: true; address: string }>;

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual({
        configured: true,
        address: STUB_ADDRESS,
      });
    }
    expect(mockWriteUnlockedSecrets).toHaveBeenCalledWith({
      POLYMARKET_API_KEY: STUB_CREDS.apiKey,
      POLYMARKET_API_SECRET: STUB_CREDS.secret,
      POLYMARKET_PASSPHRASE: STUB_CREDS.passphrase,
    });
    expectVexKeystorePasswordUntouched();
  });
});

describe("TOCTOU race re-check under the lock", () => {
  it("returns wallet.risk_confirmation_required when presence flips between pre-network check and write", async () => {
    mockGetSecretSessionStatus.mockReturnValue({
      vaultConfigured: true,
      unlocked: true,
    });
    mockLoadKeystore.mockReturnValue(STUB_KEYSTORE);

    // Pre-network: not configured → proceeds. Under the lock: configured → race.
    mockGetUnlockedSecretPresence
      .mockReturnValueOnce({
        vaultConfigured: true,
        unlocked: true,
        secrets: {},
      })
      .mockReturnValueOnce({
        vaultConfigured: true,
        unlocked: true,
        secrets: {
          POLYMARKET_API_KEY: true,
          POLYMARKET_API_SECRET: true,
          POLYMARKET_PASSPHRASE: true,
        },
      });

    mockVerifySecretVaultPassword.mockReturnValue(undefined);
    mockAcquireCredentials.mockResolvedValue({
      address: STUB_ADDRESS,
      credentials: STUB_CREDS,
    });

    const fn = getHandler();
    const result = (await fn(trustedSender, {
      requestId: "race-1",
      payload: { ...VALID_INPUT, overwriteConfirmed: false },
    })) as ErrResult;

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("wallet.risk_confirmation_required");
    // Write must NOT have run when the race re-check fails.
    expect(mockWriteUnlockedSecrets).not.toHaveBeenCalled();
    expectVexKeystorePasswordUntouched();
  });

  it("returns wallet.keystore_locked when presence relocks between acquire and write", async () => {
    mockGetSecretSessionStatus.mockReturnValue({
      vaultConfigured: true,
      unlocked: true,
    });
    mockLoadKeystore.mockReturnValue(STUB_KEYSTORE);

    // Pre-network: unlocked. Under the lock: relocked (probe failed mid-flight).
    mockGetUnlockedSecretPresence
      .mockReturnValueOnce({
        vaultConfigured: true,
        unlocked: true,
        secrets: {},
      })
      .mockReturnValueOnce({
        vaultConfigured: true,
        unlocked: false,
        secrets: {},
      });

    mockVerifySecretVaultPassword.mockReturnValue(undefined);
    mockAcquireCredentials.mockResolvedValue({
      address: STUB_ADDRESS,
      credentials: STUB_CREDS,
    });

    const fn = getHandler();
    const result = (await fn(trustedSender, {
      requestId: "race-locked",
      payload: VALID_INPUT,
    })) as ErrResult;

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("wallet.keystore_locked");
    expect(mockWriteUnlockedSecrets).not.toHaveBeenCalled();
    expectVexKeystorePasswordUntouched();
  });
});

describe("security regressions", () => {
  it("never reads or writes VEX_KEYSTORE_PASSWORD across any branch", async () => {
    // Set a canary the handler must NOT consult.
    process.env.VEX_KEYSTORE_PASSWORD = "SENTINEL-DO-NOT-READ";

    mockGetSecretSessionStatus.mockReturnValue({
      vaultConfigured: true,
      unlocked: true,
    });
    mockLoadKeystore.mockReturnValue(STUB_KEYSTORE);
    mockGetUnlockedSecretPresence.mockReturnValue({
      vaultConfigured: true,
      unlocked: true,
      secrets: {},
    });
    mockVerifySecretVaultPassword.mockReturnValue(undefined);
    mockAcquireCredentials.mockResolvedValue({
      address: STUB_ADDRESS,
      credentials: STUB_CREDS,
    });
    mockWriteUnlockedSecrets.mockReturnValue({ ok: true, data: undefined });

    const fn = getHandler();
    await fn(trustedSender, {
      requestId: "sec-1",
      payload: VALID_INPUT,
    });

    expect(process.env.VEX_KEYSTORE_PASSWORD).toBe("SENTINEL-DO-NOT-READ");
    expect(mockAcquireCredentials).toHaveBeenCalledWith(
      "correct-password-12",
    );
  });

  it("audit log records only address + correlationId on success — never credentials", async () => {
    mockGetSecretSessionStatus.mockReturnValue({
      vaultConfigured: true,
      unlocked: true,
    });
    mockLoadKeystore.mockReturnValue(STUB_KEYSTORE);
    mockGetUnlockedSecretPresence.mockReturnValue({
      vaultConfigured: true,
      unlocked: true,
      secrets: {},
    });
    mockVerifySecretVaultPassword.mockReturnValue(undefined);
    mockAcquireCredentials.mockResolvedValue({
      address: STUB_ADDRESS,
      credentials: STUB_CREDS,
    });
    mockWriteUnlockedSecrets.mockReturnValue({ ok: true, data: undefined });

    const fn = getHandler();
    await fn(trustedSender, {
      requestId: "log-1",
      payload: VALID_INPUT,
    });

    const successLogStrings = mockLog.info.mock.calls.flat().map(String).join(" | ");
    expect(successLogStrings).toContain(STUB_ADDRESS);
    expect(successLogStrings).toContain("log-1");
    // Credentials must NEVER appear anywhere in the log output.
    expect(successLogStrings).not.toContain(STUB_CREDS.apiKey);
    expect(successLogStrings).not.toContain(STUB_CREDS.secret);
    expect(successLogStrings).not.toContain(STUB_CREDS.passphrase);
    // Also assert across warn/error in case future regressions move logs.
    const allLogStrings = [
      ...mockLog.info.mock.calls,
      ...mockLog.warn.mock.calls,
      ...mockLog.error.mock.calls,
      ...mockLog.debug.mock.calls,
    ]
      .flat()
      .map(String)
      .join(" | ");
    expect(allLogStrings).not.toContain(STUB_CREDS.apiKey);
    expect(allLogStrings).not.toContain(STUB_CREDS.secret);
    expect(allLogStrings).not.toContain(STUB_CREDS.passphrase);
    expect(allLogStrings).not.toContain(VALID_INPUT.password);
  });
});
