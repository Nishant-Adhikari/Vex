import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ───────────────────────────────────────────────────────

const mockGetTokenBalances = vi.fn().mockResolvedValue([]);
const mockGetChains = vi.fn().mockResolvedValue([
  { id: 1, name: "Ethereum", type: "eip155", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 } },
  { id: 8453, name: "Base", type: "eip155", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 } },
  { id: 20011000000, name: "Solana", type: "solana", nativeCurrency: { name: "Solana", symbol: "SOL", decimals: 9 } },
]);
vi.mock("@tools/khalani/client.js", () => ({
  getKhalaniClient: () => ({
    getChains: mockGetChains,
    getTokenBalances: mockGetTokenBalances,
  }),
}));

vi.mock("@tools/wallet/multi-auth.js", () => ({
  requireEvmWallet: () => ({ family: "eip155", address: "0xTestEvm" }),
  requireSolanaWallet: () => ({ family: "solana", address: "TestSolana" }),
}));

const mockReplaceBalances = vi.fn().mockResolvedValue(0);
const mockGetBalances = vi.fn().mockResolvedValue([]);
const mockGetBalancesByChain = vi.fn().mockResolvedValue([]);
const mockGetTotalUsd = vi.fn().mockResolvedValue(0);
const mockInsertSnapshot = vi.fn().mockResolvedValue(1);
const mockGetLatestSnapshot = vi.fn().mockResolvedValue(null);

vi.mock("@vex-agent/db/repos/balances.js", () => ({
  replaceBalancesForChain: (...args: unknown[]) => mockReplaceBalances(...args),
  getBalances: (...args: unknown[]) => mockGetBalances(...args),
  getBalancesByChain: (...args: unknown[]) => mockGetBalancesByChain(...args),
  getTotalUsd: () => mockGetTotalUsd(),
  insertSnapshot: (...args: unknown[]) => mockInsertSnapshot(...args),
  getLatestSnapshot: () => mockGetLatestSnapshot(),
  getSnapshotHistory: vi.fn().mockResolvedValue([]),
  upsertBalance: vi.fn(),
}));

const { syncWalletBalances, fullBalanceSync, selectiveBalanceSync } = await import(
  "../../../vex-agent/sync/balance-sync.js"
);

describe("balance-sync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetTokenBalances.mockReset();
    mockGetTokenBalances.mockResolvedValue([]);
    mockGetChains.mockResolvedValue([
      { id: 1, name: "Ethereum", type: "eip155", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 } },
      { id: 8453, name: "Base", type: "eip155", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 } },
      { id: 20011000000, name: "Solana", type: "solana", nativeCurrency: { name: "Solana", symbol: "SOL", decimals: 9 } },
    ]);
    mockGetBalancesByChain.mockResolvedValue([]);
    mockGetBalances.mockResolvedValue([]);
    mockGetTotalUsd.mockResolvedValue(0);
    mockGetLatestSnapshot.mockResolvedValue(null);
  });

  // ── syncWalletBalances ──────────────────────────────────────────

  describe("syncWalletBalances", () => {
    it("calls Khalani and replaces per chain", async () => {
      mockGetTokenBalances.mockImplementation(async (_address: string, chainIds?: number[]) => {
        if (chainIds?.[0] === 1) {
          return [
            { chainId: 1, address: "0xUSDC", symbol: "USDC", name: "USD Coin", decimals: 6, extensions: { balance: "1000000", price: { usd: "1.0" } } },
            { chainId: 1, address: "0xETH", symbol: "ETH", name: "Ethereum", decimals: 18, extensions: { balance: "1000000000000000000", price: { usd: "3000.0" } } },
          ];
        }
        if (chainIds?.[0] === 8453) {
          return [
            { chainId: 8453, address: "0xUSDC", symbol: "USDC", name: "USD Coin", decimals: 6, extensions: { balance: "500000", price: { usd: "1.0" } } },
          ];
        }
        return [];
      });

      const result = await syncWalletBalances("eip155");

      expect(result).not.toBeNull();
      expect(result!.walletFamily).toBe("eip155");
      expect(mockGetTokenBalances).toHaveBeenCalledWith("0xTestEvm", [1]);
      expect(mockGetTokenBalances).toHaveBeenCalledWith("0xTestEvm", [8453]);
      // Two chains: 1 and 8453
      expect(mockReplaceBalances).toHaveBeenCalledTimes(2);
    });

    it("passes chainIds filter to Khalani as per-chain requests", async () => {
      mockGetTokenBalances.mockResolvedValueOnce([]);
      await syncWalletBalances("eip155", [1, 8453]);
      expect(mockGetTokenBalances).toHaveBeenCalledWith("0xTestEvm", [1]);
      expect(mockGetTokenBalances).toHaveBeenCalledWith("0xTestEvm", [8453]);
    });

    it("cleans stale chains when Khalani returns no tokens for previously known chain", async () => {
      // Previously had tokens on chain 1 and chain 8453
      mockGetBalancesByChain.mockResolvedValueOnce([
        { chainId: 1, totalUsd: 100, tokenCount: 1 },
        { chainId: 8453, totalUsd: 50, tokenCount: 1 },
      ]);

      // Khalani now returns tokens only on chain 1; chain 8453 scanned empty.
      mockGetTokenBalances.mockImplementation(async (_address: string, chainIds?: number[]) => {
        if (chainIds?.[0] === 1) {
          return [
            { chainId: 1, address: "0xUSDC", symbol: "USDC", name: "USD Coin", decimals: 6, extensions: { balance: "1000000", price: { usd: "1.0" } } },
          ];
        }
        return [];
      });

      await syncWalletBalances("eip155");

      // Should call replace for BOTH chains: chain 1 with tokens, chain 8453 with empty
      expect(mockReplaceBalances).toHaveBeenCalledTimes(2);
      // Chain 8453 should get empty array (removes stale)
      const chain8453Call = mockReplaceBalances.mock.calls.find(
        (call: unknown[]) => call[1] === 8453,
      );
      expect(chain8453Call).toBeDefined();
      expect(chain8453Call![2]).toEqual([]); // empty = delete all
    });
  });

  // ── fullBalanceSync ─────────────────────────────────────────────

  describe("fullBalanceSync", () => {
    it("syncs both wallets and creates snapshot", async () => {
      mockGetTokenBalances.mockResolvedValue([]);
      mockGetTotalUsd.mockResolvedValue(1234.56);

      const result = await fullBalanceSync();

      expect(result.wallets).toHaveLength(2); // evm + solana
      expect(result.totalUsd).toBe(1234.56);
      expect(mockInsertSnapshot).toHaveBeenCalledTimes(1);
      expect(result.snapshotId).toBe(1);
    });

    it("calculates PnL vs previous snapshot", async () => {
      mockGetTokenBalances.mockResolvedValue([]);
      mockGetTotalUsd.mockResolvedValue(1500);
      mockGetLatestSnapshot.mockResolvedValue({ id: 1, totalUsd: 1000, createdAt: new Date().toISOString() });

      const result = await fullBalanceSync();

      expect(result.pnlVsPrev).toBe(500);
    });
  });

  // ── selectiveBalanceSync ────────────────────────────────────────

  describe("selectiveBalanceSync", () => {
    it("resolves solana hint correctly", async () => {
      mockGetTokenBalances.mockResolvedValueOnce([]);
      await selectiveBalanceSync("solana");
      expect(mockGetTokenBalances).toHaveBeenCalledWith("TestSolana", [20011000000]);
    });

    it("does NOT create snapshot", async () => {
      mockGetTokenBalances.mockResolvedValueOnce([]);
      await selectiveBalanceSync("solana");
      expect(mockInsertSnapshot).not.toHaveBeenCalled();
    });
  });
});
