/**
 * Unit tests for the env-free Polymarket credential acquire primitive.
 *
 * Mocks viem (account/sign), the keystore loader, and `fetchWithTimeout` so
 * the test exercises the full decision tree (derive vs create, 4xx vs 5xx,
 * timeout) without touching the network or the on-disk keystore.
 *
 * Key invariant: the primitive MUST NOT mutate `process.env`. The test
 * snapshots the env before each case and asserts the snapshot is restored.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VexError, ErrorCodes } from "../../errors.js";

// ── Mocks (hoisted) ───────────────────────────────────────────────────────
const keystoreMocks = vi.hoisted(() => ({
  loadKeystore: vi.fn(),
  decryptPrivateKey: vi.fn(),
}));

const httpMocks = vi.hoisted(() => ({
  fetchWithTimeout: vi.fn(),
  readJson: vi.fn(),
}));

const viemMocks = vi.hoisted(() => ({
  privateKeyToAccount: vi.fn(),
  createWalletClient: vi.fn(),
  http: vi.fn(),
}));

vi.mock("../../tools/wallet/keystore.js", () => ({
  loadKeystore: keystoreMocks.loadKeystore,
  decryptPrivateKey: keystoreMocks.decryptPrivateKey,
}));

vi.mock("../../utils/http.js", () => ({
  fetchWithTimeout: httpMocks.fetchWithTimeout,
  readJson: httpMocks.readJson,
}));

vi.mock("viem", () => ({
  createWalletClient: viemMocks.createWalletClient,
  http: viemMocks.http,
}));

vi.mock("viem/accounts", () => ({
  privateKeyToAccount: viemMocks.privateKeyToAccount,
}));

vi.mock("viem/chains", () => ({
  polygon: { id: 137, name: "Polygon" },
}));

const { acquirePolymarketCredentialsWithPassword } = await import(
  "../../tools/wallet/polymarket-credentials.js"
);

const VALID_KEYSTORE = {
  version: 1,
  ciphertext: "x",
  iv: "y",
  salt: "z",
  tag: "t",
  kdf: { name: "scrypt", N: 16384, r: 8, p: 1, dkLen: 32 },
};

const VALID_PRIVATE_KEY = `0x${"ab".repeat(32)}` as `0x${string}`;
const VALID_ADDRESS = "0xAbCdEf0123456789AbCdEf0123456789AbCdEf01";

function setupHappyPath(): void {
  keystoreMocks.loadKeystore.mockReturnValue(VALID_KEYSTORE);
  keystoreMocks.decryptPrivateKey.mockReturnValue(VALID_PRIVATE_KEY);

  viemMocks.privateKeyToAccount.mockReturnValue({
    address: VALID_ADDRESS,
  });
  viemMocks.http.mockReturnValue(() => undefined);
  viemMocks.createWalletClient.mockReturnValue({
    signTypedData: vi.fn().mockResolvedValue("0xsignature"),
  });
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ── Env snapshot guard ────────────────────────────────────────────────────
// The acquire primitive MUST NOT touch process.env. We snapshot before each
// case and assert the snapshot is identical afterwards.
let envSnapshot: NodeJS.ProcessEnv;

beforeEach(() => {
  envSnapshot = { ...process.env };
  // Ensure VEX_KEYSTORE_PASSWORD is absent so a regression that reads it
  // would behave deterministically (and the assertion below catches a write).
  delete process.env.VEX_KEYSTORE_PASSWORD;
  delete process.env.POLYMARKET_API_KEY;
  delete process.env.POLYMARKET_API_SECRET;
  delete process.env.POLYMARKET_PASSPHRASE;

  keystoreMocks.loadKeystore.mockReset();
  keystoreMocks.decryptPrivateKey.mockReset();
  httpMocks.fetchWithTimeout.mockReset();
  httpMocks.readJson.mockReset();
  viemMocks.privateKeyToAccount.mockReset();
  viemMocks.createWalletClient.mockReset();
  viemMocks.http.mockReset();
});

afterEach(() => {
  process.env = envSnapshot;
});

function expectEnvUntouched(): void {
  // VEX_KEYSTORE_PASSWORD is the canary — the primitive must never read or
  // write it. We also assert no POLYMARKET_* var leaked into env from the
  // acquire path (those are the persistence wrapper's job, not acquire's).
  expect(process.env.VEX_KEYSTORE_PASSWORD).toBeUndefined();
  expect(process.env.POLYMARKET_API_KEY).toBeUndefined();
  expect(process.env.POLYMARKET_API_SECRET).toBeUndefined();
  expect(process.env.POLYMARKET_PASSPHRASE).toBeUndefined();
}

// ── Cases ─────────────────────────────────────────────────────────────────

describe("acquirePolymarketCredentialsWithPassword", () => {
  it("throws KEYSTORE_NOT_FOUND when the keystore file is missing", async () => {
    keystoreMocks.loadKeystore.mockReturnValue(null);

    await expect(
      acquirePolymarketCredentialsWithPassword("password-12"),
    ).rejects.toMatchObject({
      code: ErrorCodes.KEYSTORE_NOT_FOUND,
    });
    expect(keystoreMocks.decryptPrivateKey).not.toHaveBeenCalled();
    expect(httpMocks.fetchWithTimeout).not.toHaveBeenCalled();
    expectEnvUntouched();
  });

  it("propagates KEYSTORE_DECRYPT_FAILED when the keystore password is wrong", async () => {
    keystoreMocks.loadKeystore.mockReturnValue(VALID_KEYSTORE);
    keystoreMocks.decryptPrivateKey.mockImplementation(() => {
      throw new VexError(
        ErrorCodes.KEYSTORE_DECRYPT_FAILED,
        "Decryption failed: wrong password or corrupted keystore",
      );
    });

    await expect(
      acquirePolymarketCredentialsWithPassword("wrong-password"),
    ).rejects.toMatchObject({
      code: ErrorCodes.KEYSTORE_DECRYPT_FAILED,
    });
    expect(httpMocks.fetchWithTimeout).not.toHaveBeenCalled();
    expectEnvUntouched();
  });

  it("returns credentials from /auth/derive-api-key when the GET succeeds", async () => {
    setupHappyPath();
    httpMocks.fetchWithTimeout.mockResolvedValueOnce(
      jsonResponse(200, {
        apiKey: "k-derived",
        secret: "s-derived",
        passphrase: "p-derived",
      }),
    );
    httpMocks.readJson.mockResolvedValueOnce({
      apiKey: "k-derived",
      secret: "s-derived",
      passphrase: "p-derived",
    });

    const result = await acquirePolymarketCredentialsWithPassword(
      "correct-password-12",
    );

    expect(result.address).toBe(VALID_ADDRESS);
    expect(result.credentials).toEqual({
      apiKey: "k-derived",
      secret: "s-derived",
      passphrase: "p-derived",
    });
    expect(httpMocks.fetchWithTimeout).toHaveBeenCalledTimes(1);
    expect(httpMocks.fetchWithTimeout).toHaveBeenCalledWith(
      expect.stringContaining("/auth/derive-api-key"),
      expect.objectContaining({ method: "GET" }),
    );
    expectEnvUntouched();
  });

  it("falls back to POST /auth/api-key when derive returns null and create succeeds", async () => {
    setupHappyPath();
    // derive: 200 but empty body → parseCredentials returns null → fallback
    httpMocks.fetchWithTimeout.mockResolvedValueOnce(jsonResponse(200, {}));
    httpMocks.readJson.mockResolvedValueOnce({});
    // create: 200 with trio
    httpMocks.fetchWithTimeout.mockResolvedValueOnce(
      jsonResponse(200, {
        apiKey: "k-created",
        secret: "s-created",
        passphrase: "p-created",
      }),
    );
    httpMocks.readJson.mockResolvedValueOnce({
      apiKey: "k-created",
      secret: "s-created",
      passphrase: "p-created",
    });

    const result = await acquirePolymarketCredentialsWithPassword(
      "correct-password-12",
    );

    expect(result.credentials).toEqual({
      apiKey: "k-created",
      secret: "s-created",
      passphrase: "p-created",
    });
    expect(httpMocks.fetchWithTimeout).toHaveBeenCalledTimes(2);
    expect(httpMocks.fetchWithTimeout).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("/auth/api-key"),
      expect.objectContaining({ method: "POST" }),
    );
    expectEnvUntouched();
  });

  it("maps POST /auth/api-key 4xx to POLYMARKET_AUTH_FAILED", async () => {
    setupHappyPath();
    httpMocks.fetchWithTimeout.mockResolvedValueOnce(jsonResponse(200, {}));
    httpMocks.readJson.mockResolvedValueOnce({});
    httpMocks.fetchWithTimeout.mockResolvedValueOnce(
      jsonResponse(403, { error: "address-not-allowed" }),
    );
    httpMocks.readJson.mockResolvedValueOnce({ error: "address-not-allowed" });

    await expect(
      acquirePolymarketCredentialsWithPassword("correct-password-12"),
    ).rejects.toMatchObject({
      code: ErrorCodes.POLYMARKET_AUTH_FAILED,
    });
    expectEnvUntouched();
  });

  it("maps POST /auth/api-key 5xx to HTTP_REQUEST_FAILED", async () => {
    setupHappyPath();
    httpMocks.fetchWithTimeout.mockResolvedValueOnce(jsonResponse(200, {}));
    httpMocks.readJson.mockResolvedValueOnce({});
    httpMocks.fetchWithTimeout.mockResolvedValueOnce(
      jsonResponse(503, { error: "upstream-temporarily-unavailable" }),
    );
    httpMocks.readJson.mockResolvedValueOnce({
      error: "upstream-temporarily-unavailable",
    });

    await expect(
      acquirePolymarketCredentialsWithPassword("correct-password-12"),
    ).rejects.toMatchObject({
      code: ErrorCodes.HTTP_REQUEST_FAILED,
    });
    expectEnvUntouched();
  });

  it("maps a network timeout from create to HTTP_REQUEST_FAILED", async () => {
    setupHappyPath();
    // derive: best-effort → swallow any error & return null
    httpMocks.fetchWithTimeout.mockRejectedValueOnce(
      new VexError(ErrorCodes.HTTP_TIMEOUT, "Request timed out"),
    );
    // create: rejects with HTTP_TIMEOUT → primitive remaps to HTTP_REQUEST_FAILED
    httpMocks.fetchWithTimeout.mockRejectedValueOnce(
      new VexError(ErrorCodes.HTTP_TIMEOUT, "Request timed out"),
    );

    await expect(
      acquirePolymarketCredentialsWithPassword("correct-password-12"),
    ).rejects.toMatchObject({
      code: ErrorCodes.HTTP_REQUEST_FAILED,
    });
    expectEnvUntouched();
  });

  it("maps a malformed 200 from create to POLYMARKET_AUTH_FAILED", async () => {
    setupHappyPath();
    httpMocks.fetchWithTimeout.mockResolvedValueOnce(jsonResponse(200, {}));
    httpMocks.readJson.mockResolvedValueOnce({});
    // create: 200 but missing `secret` & `passphrase`
    httpMocks.fetchWithTimeout.mockResolvedValueOnce(
      jsonResponse(200, { apiKey: "k-only" }),
    );
    httpMocks.readJson.mockResolvedValueOnce({ apiKey: "k-only" });

    await expect(
      acquirePolymarketCredentialsWithPassword("correct-password-12"),
    ).rejects.toMatchObject({
      code: ErrorCodes.POLYMARKET_AUTH_FAILED,
    });
    expectEnvUntouched();
  });

  it("never reads or writes VEX_KEYSTORE_PASSWORD even on the happy path", async () => {
    // Set a sentinel value that the primitive must not consult. If it ever
    // resolved the password via env we would expect the call to succeed
    // when invoked with an empty string; here we verify the explicit-arg
    // password is the only thing decryptPrivateKey receives.
    process.env.VEX_KEYSTORE_PASSWORD = "SENTINEL-DO-NOT-READ";

    setupHappyPath();
    httpMocks.fetchWithTimeout.mockResolvedValueOnce(
      jsonResponse(200, {
        apiKey: "k",
        secret: "s",
        passphrase: "p",
      }),
    );
    httpMocks.readJson.mockResolvedValueOnce({
      apiKey: "k",
      secret: "s",
      passphrase: "p",
    });

    await acquirePolymarketCredentialsWithPassword("explicit-arg-password");

    expect(keystoreMocks.decryptPrivateKey).toHaveBeenCalledWith(
      VALID_KEYSTORE,
      "explicit-arg-password",
    );
    // Env unchanged — sentinel is still in place, not consumed.
    expect(process.env.VEX_KEYSTORE_PASSWORD).toBe("SENTINEL-DO-NOT-READ");
    expect(process.env.POLYMARKET_API_KEY).toBeUndefined();
  });
});
