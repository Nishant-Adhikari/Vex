/**
 * Lock-nesting guard for vex.onboarding.polymarketAutoSetup (invariant 3).
 *
 * The existing 921-LOC `polymarket-setup.test.ts` mocks `withEnvWriteLock` so
 * it runs `fn()` inline — that proves the under-lock TOCTOU re-check + the
 * write PRODUCE the right values, but NOT that they execute INSIDE the lock.
 * Moving the second configured-probe (or the write) before the lock would
 * still pass there.
 *
 * This dedicated test wraps the `withEnvWriteLock` mock so it sets a
 * module-scoped `inLock = true` for the duration of `fn()` and `false` after,
 * then stubs the configured-probe (`getConfiguredPolymarketAddresses`) and
 * `writeUnlockedSecrets` to record the `inLock` value observed at call time.
 * Driving ONE happy-path overwrite-confirmed setup, it asserts that BOTH the
 * under-lock probe AND the write observed `inLock === true`.
 *
 * Mock factories mirror `polymarket-setup.test.ts` (the real
 * `buildPolymarketVaultUpdates` runs via importActual; acquire/wallet/vault
 * are stubbed). Do NOT modify that 921-LOC file (it is T-005, a separate phase).
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

// ── Lock-nesting instrumentation ──────────────────────────────────────────
// `inLock` is flipped true ONLY for the duration of the `withEnvWriteLock`
// callback. The configured-probe + write stubs snapshot it at call time.
let inLock = false;
const probeInLockObservations: boolean[] = [];
let writeInLockObserved: boolean | null = null;

// ── Mocks (regular Jest-style; loaded before handler import) ──────────────
const mockGetSecretSessionStatus = vi.fn();
const mockGetConfiguredPolymarketAddresses = vi.fn();
const mockWriteUnlockedSecrets = vi.fn();

const mockGetWalletById = vi.fn();
const mockGetPrimaryEvmEntry = vi.fn();
const mockGetPrimaryEvmAddress = vi.fn();
const mockVerifySecretVaultPassword = vi.fn();

const mockAcquireCredentials = vi.fn();

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
  getConfiguredPolymarketAddresses: () => {
    // Snapshot the lock state at EVERY probe call so the under-lock call
    // (step 7 re-check) can be distinguished from the pre-network call.
    probeInLockObservations.push(inLock);
    return mockGetConfiguredPolymarketAddresses();
  },
  writeUnlockedSecrets: (updates: unknown) => {
    writeInLockObserved = inLock;
    return mockWriteUnlockedSecrets(updates);
  },
}));

// Wrap the lock so `inLock` is true ONLY while the callback runs.
vi.mock("../../../onboarding/env-write-mutex.js", () => ({
  withEnvWriteLock: async <T>(fn: () => Promise<T>): Promise<T> => {
    inLock = true;
    try {
      return await fn();
    } finally {
      inLock = false;
    }
  },
}));

// The acquire primitive is mocked; the PURE credential-map helpers
// (`buildPolymarketVaultUpdates`, the ENV constant) run for real.
vi.mock("@vex-lib/polymarket.js", async () => {
  const actual = await vi.importActual<
    typeof import("@vex-lib/polymarket.js")
  >("@vex-lib/polymarket.js");
  return {
    acquirePolymarketCredentialsWithPassword: (
      password: string,
      entry?: unknown,
    ) => mockAcquireCredentials(password, entry),
    buildPolymarketVaultUpdates: actual.buildPolymarketVaultUpdates,
    ENV_POLYMARKET_CLOB_CREDENTIALS_BY_ADDRESS:
      actual.ENV_POLYMARKET_CLOB_CREDENTIALS_BY_ADDRESS,
  };
});

vi.mock("@vex-lib/wallet.js", () => ({
  getWalletById: (family: string, id: string) =>
    mockGetWalletById(family, id),
  getPrimaryEvmEntry: () => mockGetPrimaryEvmEntry(),
  getPrimaryEvmAddress: () => mockGetPrimaryEvmAddress(),
}));

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
const { ENV_POLYMARKET_CLOB_CREDENTIALS_BY_ADDRESS } = await import(
  "@vex-lib/polymarket.js"
);

const trustedSender = createTrustedSender({ sender: createTestWebContents() });

// ── Test fixtures ─────────────────────────────────────────────────────────
const VALID_INPUT = {
  password: "correct-password-12",
  riskAcknowledged: true as const,
  overwriteConfirmed: true,
};

const STUB_ADDRESS = "0xAbCdEf0123456789AbCdEf0123456789AbCdEf01" as const;
const STUB_LC = STUB_ADDRESS.toLowerCase();
const STUB_CREDS = {
  apiKey: "k-secret",
  secret: "s-secret",
  passphrase: "p-secret",
};

const PRIMARY_ENTRY = {
  id: "evm_legacy",
  address: STUB_ADDRESS,
  label: "Primary",
  createdAt: new Date(0).toISOString(),
  legacy: true,
};

function configuredOk(addresses: readonly string[]): {
  ok: true;
  data: readonly string[];
} {
  return { ok: true, data: addresses };
}

let envSnapshot: NodeJS.ProcessEnv;

beforeEach(() => {
  envSnapshot = { ...process.env };
  delete process.env.VEX_KEYSTORE_PASSWORD;
  delete process.env[ENV_POLYMARKET_CLOB_CREDENTIALS_BY_ADDRESS];

  inLock = false;
  probeInLockObservations.length = 0;
  writeInLockObserved = null;

  handlers.clear();
  mockGetSecretSessionStatus.mockReset();
  mockGetConfiguredPolymarketAddresses.mockReset();
  mockWriteUnlockedSecrets.mockReset();
  mockGetWalletById.mockReset();
  mockGetPrimaryEvmEntry.mockReset();
  mockGetPrimaryEvmAddress.mockReset();
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

describe("lock nesting (invariant 3) — probe + write run INSIDE withEnvWriteLock", () => {
  it("observes inLock===true for BOTH the under-lock configured-probe AND the write", async () => {
    mockGetSecretSessionStatus.mockReturnValue({
      vaultConfigured: true,
      unlocked: true,
    });
    mockGetPrimaryEvmEntry.mockReturnValue(PRIMARY_ENTRY);
    // Pre-network probe (outside lock) AND under-lock probe both see the
    // selected wallet as already configured; overwriteConfirmed=true lets
    // the flow reach the write so we can observe its lock state.
    mockGetConfiguredPolymarketAddresses.mockReturnValue(
      configuredOk([STUB_LC]),
    );
    mockVerifySecretVaultPassword.mockReturnValue(undefined);
    mockGetPrimaryEvmAddress.mockReturnValue(STUB_ADDRESS);
    mockAcquireCredentials.mockResolvedValue({
      address: STUB_ADDRESS,
      credentials: STUB_CREDS,
    });
    mockWriteUnlockedSecrets.mockReturnValue({ ok: true, data: undefined });

    const fn = getHandler();
    const result = (await fn(trustedSender, {
      requestId: "lock-1",
      payload: VALID_INPUT,
    })) as { ok: boolean };

    expect(result.ok).toBe(true);

    // Two probe calls: step-4 pre-network (outside lock) then step-7
    // under-lock re-check. The under-lock one (the LAST call) MUST be true.
    expect(probeInLockObservations.length).toBe(2);
    expect(probeInLockObservations[0]).toBe(false);
    expect(probeInLockObservations[1]).toBe(true);

    // The write MUST have executed inside the lock.
    expect(writeInLockObserved).toBe(true);
    expect(mockWriteUnlockedSecrets).toHaveBeenCalledTimes(1);

    // The lock flag is released after the callback returns.
    expect(inLock).toBe(false);
  });
});
