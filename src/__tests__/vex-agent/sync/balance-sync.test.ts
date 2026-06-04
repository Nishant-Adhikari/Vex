import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ───────────────────────────────────────────────────────
// `listWallets` drives which wallets the background sync projects (puzzle 5
// phase 5E-1 — sync iterates the whole inventory, NOT just the primary).
const mockListWallets = vi.fn();
vi.mock("@tools/wallet/inventory.js", () => ({
  listWallets: (family: string) => mockListWallets(family),
}));

// Direct mock of the Khalani balance scan (balance-sync calls this).
const mockScan = vi.fn();
vi.mock("@tools/khalani/balances.js", () => ({
  getTokenBalancesAcrossChains: (...args: unknown[]) => mockScan(...args),
}));

const mockReplaceBalances = vi.fn().mockResolvedValue(0);
const mockGetBalances = vi.fn().mockResolvedValue([]);
const mockGetBalancesByChain = vi.fn().mockResolvedValue([]);
const mockInsertSnapshot = vi.fn();
const mockGetLatestSnapshot = vi.fn().mockResolvedValue(null);

vi.mock("@vex-agent/db/repos/balances.js", () => ({
  replaceBalancesForChain: (...a: unknown[]) => mockReplaceBalances(...a),
  getBalances: (...a: unknown[]) => mockGetBalances(...a),
  getBalancesByChain: (...a: unknown[]) => mockGetBalancesByChain(...a),
  insertSnapshot: (...a: unknown[]) => mockInsertSnapshot(...a),
  getLatestSnapshot: (...a: unknown[]) => mockGetLatestSnapshot(...a),
  getSnapshotHistory: vi.fn().mockResolvedValue([]),
}));

// Lazy-imported by fullBalanceSync after the snapshot write.
vi.mock("../../../vex-agent/sync/mtm.js", () => ({
  refreshPredictionMtm: vi.fn().mockResolvedValue(undefined),
}));

const { syncWalletBalances, fullBalanceSync, selectiveBalanceSync } = await import(
  "../../../vex-agent/sync/balance-sync.js"
);

const EVM_A = "0xAAAaaa";
const EVM_B = "0xBBBbbb";
const SOL_A = "SoLaNaAddrAAA";

function emptyScan(scannedChainIds: number[] = []) {
  return { tokens: [], scannedChainIds, chainErrors: [] };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockScan.mockResolvedValue(emptyScan());
  mockGetBalances.mockResolvedValue([]);
  mockGetBalancesByChain.mockResolvedValue([]);
  mockGetLatestSnapshot.mockResolvedValue(null);
  mockInsertSnapshot.mockResolvedValue({ snapshotId: 1, pnlVsPrev: null });
  // Default inventory: one EVM + one Solana wallet.
  mockListWallets.mockImplementation((family: string) =>
    family === "solana"
      ? [{ id: "sol_1", address: SOL_A, label: "Solana 1", createdAt: "" }]
      : [{ id: "evm_1", address: EVM_A, label: "EVM 1", createdAt: "" }],
  );
});

// ── syncWalletBalances ──────────────────────────────────────────

describe("syncWalletBalances", () => {
  it("syncs the GIVEN address (no global primary lookup) and replaces per chain", async () => {
    mockScan.mockResolvedValue({
      tokens: [
        { chainId: 1, address: "0xUSDC", symbol: "USDC", name: "USD Coin", decimals: 6, extensions: { balance: "1000000", price: { usd: "1.0" } } },
        { chainId: 8453, address: "0xUSDC", symbol: "USDC", name: "USD Coin", decimals: 6, extensions: { balance: "500000", price: { usd: "1.0" } } },
      ],
      scannedChainIds: [1, 8453],
      chainErrors: [],
    });

    const result = await syncWalletBalances("eip155", EVM_A);

    expect(result.walletFamily).toBe("eip155");
    expect(result.walletAddress).toBe(EVM_A);
    expect(mockScan).toHaveBeenCalledWith({ address: EVM_A, family: "eip155", chainIds: undefined });
    expect(mockReplaceBalances).toHaveBeenCalledTimes(2); // chain 1 + 8453
  });

  it("forwards a chainIds filter to the scan", async () => {
    await syncWalletBalances("eip155", EVM_A, [1, 8453]);
    expect(mockScan).toHaveBeenCalledWith({ address: EVM_A, family: "eip155", chainIds: [1, 8453] });
  });

  // ── Native top-up MUST stay off on the projection path ──────────
  // The sync path full-replaces proj_balances per chain. If it opted into the
  // EVM native top-up, a transient native RPC failure could drop a previously
  // cached synthetic native row from the replace set. Assert the scan is invoked
  // WITHOUT includeNative (so the scanner's default-false path keeps it native-
  // free) and that a synthetic native row is never written.
  it("never requests the native top-up (no includeNative) so it cannot delete cached native rows", async () => {
    const NATIVE_SENTINEL = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
    // Even though a real RPC would report 5 ETH, the sync scan returns ERC-20s
    // only — the mock proves syncWalletBalances asks for a native-free scan.
    mockScan.mockResolvedValue({
      tokens: [
        { chainId: 1, address: "0xUSDC", symbol: "USDC", name: "USD Coin", decimals: 6, extensions: { balance: "1000000", price: { usd: "1.0" } } },
      ],
      scannedChainIds: [1],
      chainErrors: [],
    });

    await syncWalletBalances("eip155", EVM_A);

    // The sync call carries no includeNative flag at all.
    const [scanArg] = mockScan.mock.calls[0] as [Record<string, unknown>];
    expect(scanArg).not.toHaveProperty("includeNative");
    expect(scanArg.includeNative).toBeUndefined();

    // The per-chain replace set written to proj_balances has no synthetic native row.
    const replacedRows = mockReplaceBalances.mock.calls.flatMap(
      (call) => (call[2] as Array<{ tokenAddress: string }>),
    );
    expect(
      replacedRows.some((row) => row.tokenAddress.toLowerCase() === NATIVE_SENTINEL.toLowerCase()),
    ).toBe(false);
  });
});

// ── fullBalanceSync ─────────────────────────────────────────────

describe("fullBalanceSync", () => {
  it("snapshots EVERY inventory wallet under one shared snapshot_group_id", async () => {
    // Two EVM + one Solana wallet in the inventory.
    mockListWallets.mockImplementation((family: string) =>
      family === "solana"
        ? [{ id: "sol_1", address: SOL_A, label: "S1", createdAt: "" }]
        : [
            { id: "evm_1", address: EVM_A, label: "E1", createdAt: "" },
            { id: "evm_2", address: EVM_B, label: "E2", createdAt: "" },
          ],
    );
    let n = 0;
    mockInsertSnapshot.mockImplementation(async () => ({ snapshotId: ++n, pnlVsPrev: null }));

    const result = await fullBalanceSync();

    expect(result.wallets).toHaveLength(3);
    expect(result.snapshots).toHaveLength(3);
    expect(mockInsertSnapshot).toHaveBeenCalledTimes(3);

    // Every per-wallet row from this cycle shares ONE group id.
    const groupIds = new Set(
      mockInsertSnapshot.mock.calls.map((c) => (c[0] as { snapshotGroupId: string }).snapshotGroupId),
    );
    expect(groupIds.size).toBe(1);
    expect(result.snapshotGroupId).toBe([...groupIds][0]);

    // One snapshot per distinct wallet address (no single global snapshot).
    const addrs = mockInsertSnapshot.mock.calls.map((c) => (c[0] as { walletAddress: string }).walletAddress);
    expect(addrs).toEqual(expect.arrayContaining([EVM_A, EVM_B, SOL_A]));
    const families = mockInsertSnapshot.mock.calls.map((c) => (c[0] as { walletFamily: string }).walletFamily);
    expect(families).toEqual(expect.arrayContaining(["eip155", "solana"]));
  });

  it("aggregates totalUsd across wallets and tags each with its family", async () => {
    mockGetBalances.mockResolvedValue([
      { walletFamily: "eip155", walletAddress: EVM_A, chainId: 1, tokenAddress: "0xUSDC", tokenSymbol: "USDC", tokenName: null, balanceRaw: "1", balanceUsd: 100, priceUsd: 1, decimals: 6 },
    ]);
    const result = await fullBalanceSync();
    // 1 EVM + 1 Solana, each totalUsd 100 → aggregate 200.
    expect(result.totalUsd).toBe(200);
  });
});

// ── selectiveBalanceSync ────────────────────────────────────────

describe("selectiveBalanceSync", () => {
  it("syncs ALL inventory wallets for the affected family and never snapshots", async () => {
    mockListWallets.mockImplementation((family: string) =>
      family === "solana"
        ? []
        : [
            { id: "evm_1", address: EVM_A, label: "E1", createdAt: "" },
            { id: "evm_2", address: EVM_B, label: "E2", createdAt: "" },
          ],
    );

    const result = await selectiveBalanceSync("eip155");

    expect(result.families).toEqual(["eip155"]);
    expect(result.wallets).toHaveLength(2);
    expect(mockScan).toHaveBeenCalledWith(expect.objectContaining({ address: EVM_A, family: "eip155" }));
    expect(mockScan).toHaveBeenCalledWith(expect.objectContaining({ address: EVM_B, family: "eip155" }));
    expect(mockInsertSnapshot).not.toHaveBeenCalled();
  });

  it("returns an empty result (no throw) when the family has no inventory wallets", async () => {
    mockListWallets.mockReturnValue([]);
    const result = await selectiveBalanceSync("solana");
    expect(result.wallets).toHaveLength(0);
    expect(result.tokensUpdated).toBe(0);
  });
});
