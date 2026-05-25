/**
 * Per-wallet Polymarket credential derivation + persistence (puzzle 5 B-core).
 *
 * Covers the write side that `polymarket-auth.test.ts` (read) and
 * `credential-map.test.ts` (pure map ops) don't:
 *   - acquire(password, entry) loads the SELECTED wallet's keystore and asserts
 *     the decrypted key derives entry.address BEFORE signing (fail closed);
 *   - deriveAndSave merges creds into the per-address map (preserving other
 *     wallets) and writes the fixed keys ONLY for the primary wallet.
 *
 * viem `getAddress` is mocked to identity so address comparisons are
 * deterministic; the REAL normalization is covered in credential-map.test.ts.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorCodes } from "../../errors.js";

const keystoreMocks = vi.hoisted(() => ({
  loadKeystore: vi.fn(),
  loadKeystoreFile: vi.fn(),
  decryptPrivateKey: vi.fn(),
}));
const invMocks = vi.hoisted(() => ({
  derivePath: vi.fn(),
  getPrimaryEvmAddress: vi.fn(),
  getPrimaryEvmEntry: vi.fn(),
  getWalletById: vi.fn(),
}));
const httpMocks = vi.hoisted(() => ({ fetchWithTimeout: vi.fn(), readJson: vi.fn() }));
const viemMocks = vi.hoisted(() => ({
  createWalletClient: vi.fn(),
  http: vi.fn(),
  getAddress: vi.fn((a: string) => a),
  privateKeyToAccount: vi.fn(),
  privateKeyToAddress: vi.fn(),
}));
const vaultMocks = vi.hoisted(() => ({
  writeSecretVaultSecrets: vi.fn(),
  stripManagedSecretsFromDotenvFile: vi.fn(),
}));
const envMocks = vi.hoisted(() => ({ requireKeystorePassword: vi.fn(() => "master-pw") }));

vi.mock("../../tools/wallet/keystore.js", () => keystoreMocks);
vi.mock("../../tools/wallet/inventory.js", () => invMocks);
vi.mock("../../utils/http.js", () => httpMocks);
vi.mock("../../config/store.js", () => ({ loadConfig: () => ({}) }));
vi.mock("../../utils/env.js", () => envMocks);
vi.mock("../../lib/local-secret-vault.js", () => vaultMocks);
vi.mock("viem", () => ({
  createWalletClient: viemMocks.createWalletClient,
  http: viemMocks.http,
  getAddress: viemMocks.getAddress,
}));
vi.mock("viem/accounts", () => ({
  privateKeyToAccount: viemMocks.privateKeyToAccount,
  privateKeyToAddress: viemMocks.privateKeyToAddress,
}));
vi.mock("viem/chains", () => ({ polygon: { id: 137, name: "Polygon" } }));

const { acquirePolymarketCredentialsWithPassword, deriveAndSavePolymarketCredentials } =
  await import("../../tools/wallet/polymarket-credentials.js");

const MAP_KEY = "POLYMARKET_CLOB_CREDENTIALS_BY_ADDRESS";
const ADDR_PRIMARY = `0x${"11".repeat(20)}`;
const ADDR_SESSION = `0x${"22".repeat(20)}`;
const VALID_KEYSTORE = { version: 1, ciphertext: "x", iv: "y", salt: "z", tag: "t", kdf: { name: "scrypt", N: 16384, r: 8, p: 1, dkLen: 32 } };
const KEY = `0x${"ab".repeat(32)}`;

function entry(id: string, address: string) {
  return { id, address, label: id, createdAt: "2026-01-01T00:00:00Z" };
}

/** Wire acquire's deps so it derives `creds` for a wallet whose key matches `address`. */
function stubAcquire(address: string, creds: { apiKey: string; secret: string; passphrase: string }): void {
  keystoreMocks.loadKeystoreFile.mockReturnValue(VALID_KEYSTORE);
  keystoreMocks.loadKeystore.mockReturnValue(VALID_KEYSTORE);
  keystoreMocks.decryptPrivateKey.mockReturnValue(KEY);
  invMocks.derivePath.mockReturnValue(`/cfg/wallet-${address}.json`);
  viemMocks.privateKeyToAddress.mockReturnValue(address);
  viemMocks.privateKeyToAccount.mockReturnValue({ address });
  viemMocks.http.mockReturnValue(() => undefined);
  viemMocks.createWalletClient.mockReturnValue({ signTypedData: vi.fn().mockResolvedValue("0xsig") });
  httpMocks.fetchWithTimeout.mockResolvedValue(new Response(JSON.stringify(creds), { status: 200 }));
  httpMocks.readJson.mockResolvedValue(creds);
}

let envSnapshot: NodeJS.ProcessEnv;
beforeEach(() => {
  envSnapshot = { ...process.env };
  delete process.env[MAP_KEY];
  delete process.env.POLYMARKET_API_KEY;
  delete process.env.POLYMARKET_API_SECRET;
  delete process.env.POLYMARKET_PASSPHRASE;
  vi.clearAllMocks();
  viemMocks.getAddress.mockImplementation((a: string) => a);
  envMocks.requireKeystorePassword.mockReturnValue("master-pw");
});
afterEach(() => {
  process.env = envSnapshot;
});

describe("acquirePolymarketCredentialsWithPassword(password, entry)", () => {
  it("loads the SELECTED wallet's keystore via derivePath + loadKeystoreFile (not the primary)", async () => {
    stubAcquire(ADDR_SESSION, { apiKey: "k", secret: "s", passphrase: "p" });
    const e = entry("evm_session", ADDR_SESSION);

    const result = await acquirePolymarketCredentialsWithPassword("pw", e);

    expect(invMocks.derivePath).toHaveBeenCalledWith("evm", e);
    expect(keystoreMocks.loadKeystoreFile).toHaveBeenCalledWith(`/cfg/wallet-${ADDR_SESSION}.json`);
    expect(keystoreMocks.loadKeystore).not.toHaveBeenCalled();
    expect(result.address).toBe(ADDR_SESSION);
  });

  it("throws SIGNER_MISMATCH and never signs when the key doesn't derive entry.address", async () => {
    stubAcquire(ADDR_SESSION, { apiKey: "k", secret: "s", passphrase: "p" });
    // Decrypted key derives a DIFFERENT address than the recorded entry.
    viemMocks.privateKeyToAddress.mockReturnValue(ADDR_PRIMARY);
    const signTypedData = vi.fn();
    viemMocks.createWalletClient.mockReturnValue({ signTypedData });

    await expect(
      acquirePolymarketCredentialsWithPassword("pw", entry("evm_session", ADDR_SESSION)),
    ).rejects.toMatchObject({ code: ErrorCodes.SIGNER_MISMATCH });

    expect(signTypedData).not.toHaveBeenCalled();
    expect(httpMocks.fetchWithTimeout).not.toHaveBeenCalled();
  });
});

describe("deriveAndSavePolymarketCredentials", () => {
  it("merges a NON-primary wallet into the map and writes NO fixed keys", async () => {
    // Pre-existing map entry must survive the merge.
    const existing = { apiKey: "e", apiSecret: "e", passphrase: "e" };
    process.env[MAP_KEY] = JSON.stringify({ [ADDR_PRIMARY]: existing });

    invMocks.getWalletById.mockReturnValue(entry("evm_session", ADDR_SESSION));
    invMocks.getPrimaryEvmAddress.mockReturnValue(ADDR_PRIMARY); // session != primary
    stubAcquire(ADDR_SESSION, { apiKey: "k-sess", secret: "s-sess", passphrase: "p-sess" });

    await deriveAndSavePolymarketCredentials({ walletId: "evm_session" });

    expect(vaultMocks.writeSecretVaultSecrets).toHaveBeenCalledTimes(1);
    const updates = vaultMocks.writeSecretVaultSecrets.mock.calls[0]![1] as Record<string, string>;
    const writtenMap = JSON.parse(updates[MAP_KEY]!);
    expect(writtenMap[ADDR_PRIMARY]).toEqual(existing); // preserved
    expect(writtenMap[ADDR_SESSION]).toEqual({ apiKey: "k-sess", apiSecret: "s-sess", passphrase: "p-sess" });
    // Non-primary → fixed keys NOT written, in the vault or the env.
    expect(updates).not.toHaveProperty("POLYMARKET_API_KEY");
    expect(process.env.POLYMARKET_API_KEY).toBeUndefined();
    expect(JSON.parse(process.env[MAP_KEY]!)[ADDR_SESSION]).toBeTruthy();
  });

  it("writes BOTH the map and the fixed keys for the PRIMARY wallet", async () => {
    invMocks.getPrimaryEvmEntry.mockReturnValue(entry("evm_legacy", ADDR_PRIMARY));
    invMocks.getPrimaryEvmAddress.mockReturnValue(ADDR_PRIMARY);
    stubAcquire(ADDR_PRIMARY, { apiKey: "k-prim", secret: "s-prim", passphrase: "p-prim" });

    await deriveAndSavePolymarketCredentials();

    const updates = vaultMocks.writeSecretVaultSecrets.mock.calls[0]![1] as Record<string, string>;
    expect(JSON.parse(updates[MAP_KEY]!)[ADDR_PRIMARY]).toEqual({ apiKey: "k-prim", apiSecret: "s-prim", passphrase: "p-prim" });
    expect(updates.POLYMARKET_API_KEY).toBe("k-prim");
    expect(updates.POLYMARKET_API_SECRET).toBe("s-prim");
    expect(updates.POLYMARKET_PASSPHRASE).toBe("p-prim");
    expect(process.env.POLYMARKET_API_KEY).toBe("k-prim");
  });

  it("throws WALLET_NOT_CONFIGURED when the selected walletId is unknown", async () => {
    invMocks.getWalletById.mockReturnValue(null);
    await expect(
      deriveAndSavePolymarketCredentials({ walletId: "evm_missing" }),
    ).rejects.toMatchObject({ code: ErrorCodes.WALLET_NOT_CONFIGURED });
    expect(vaultMocks.writeSecretVaultSecrets).not.toHaveBeenCalled();
  });
});
