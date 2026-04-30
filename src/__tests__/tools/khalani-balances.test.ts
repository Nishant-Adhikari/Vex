import { beforeEach, describe, expect, it, vi } from "vitest";

const CHAINS = [
  { id: 1, name: "Ethereum", type: "eip155" as const, nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 } },
  { id: 8453, name: "Base", type: "eip155" as const, nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 } },
  { id: 20011000000, name: "Solana", type: "solana" as const, nativeCurrency: { name: "Solana", symbol: "SOL", decimals: 9 } },
];

const mockGetChains = vi.fn().mockResolvedValue(CHAINS);
const mockGetTokenBalances = vi.fn().mockResolvedValue([]);

vi.mock("@tools/khalani/client.js", () => ({
  getKhalaniClient: () => ({
    getChains: mockGetChains,
    getTokenBalances: mockGetTokenBalances,
  }),
}));

const {
  getSelectedChainIdsForFamily,
  getTokenBalancesAcrossChains,
  parseBalanceChainSelection,
} = await import("../../tools/khalani/balances.js");
const { clearKhalaniChainsCache } = await import("../../tools/khalani/chains.js");

describe("Khalani balance scanner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearKhalaniChainsCache();
    mockGetChains.mockResolvedValue(CHAINS);
    mockGetTokenBalances.mockReset();
    mockGetTokenBalances.mockResolvedValue([]);
  });

  it("resolves aliases into family-specific chain selections", async () => {
    const selection = await parseBalanceChainSelection("ethereum,base,solana");

    expect(getSelectedChainIdsForFamily(selection, "eip155")).toEqual([1, 8453]);
    expect(getSelectedChainIdsForFamily(selection, "solana")).toEqual([20011000000]);
  });

  it("scans explicit EVM chains as individual Khalani balance calls", async () => {
    mockGetTokenBalances.mockImplementation(async (_address: string, chainIds?: number[]) => {
      if (chainIds?.[0] === 1) {
        return [
          { chainId: 1, address: "0xUSDC", symbol: "USDC", name: "USD Coin", decimals: 6, extensions: { balance: "1000000", price: { usd: "1.0" } } },
        ];
      }
      if (chainIds?.[0] === 8453) {
        return [
          { chainId: 8453, address: "0xWETH", symbol: "WETH", name: "Wrapped Ether", decimals: 18, extensions: { balance: "1000000000000000000", price: { usd: "3000.0" } } },
        ];
      }
      return [];
    });

    const scan = await getTokenBalancesAcrossChains({
      address: "0xWallet",
      family: "eip155",
      chainIds: [1, 8453],
    });

    expect(mockGetTokenBalances).toHaveBeenCalledWith("0xWallet", [1]);
    expect(mockGetTokenBalances).toHaveBeenCalledWith("0xWallet", [8453]);
    expect(scan.scannedChainIds).toEqual([1, 8453]);
    expect(scan.tokens.map((token) => token.symbol)).toEqual(["WETH", "USDC"]);
    expect(scan.totalUsd).toBe(3001);
  });

  it("returns partial chain errors without dropping successful balances", async () => {
    mockGetTokenBalances.mockImplementation(async (_address: string, chainIds?: number[]) => {
      if (chainIds?.[0] === 8453) throw new Error("upstream timeout");
      return [
        { chainId: 1, address: "0xUSDC", symbol: "USDC", name: "USD Coin", decimals: 6, extensions: { balance: "1000000", price: { usd: "1.0" } } },
      ];
    });

    const scan = await getTokenBalancesAcrossChains({
      address: "0xWallet",
      family: "eip155",
      chainIds: [1, 8453],
    });

    expect(scan.tokens).toHaveLength(1);
    expect(scan.scannedChainIds).toEqual([1]);
    expect(scan.chainErrors).toEqual([
      { chainId: 8453, chainName: "Base", message: "upstream timeout" },
    ]);
  });
});
