import { describe, expect, it, vi, beforeEach } from "vitest";

const mockFetchJson = vi.fn();
vi.mock("../utils/http.js", () => ({
  fetchJson: (...args: unknown[]) => mockFetchJson(...args),
}));
vi.mock("../config/store.js", () => ({
  loadConfig: () => ({ solana: { jupiterApiKey: "", explorerUrl: "https://explorer.solana.com", cluster: "mainnet-beta" } }),
}));

const mockSignAndSend = vi.fn(() => "lend-sig");
vi.mock("../tools/chains/solana/tx.js", () => ({
  signAndSendVersionedTx: (...args: unknown[]) => mockSignAndSend(...args),
}));

const { getLendRates, getLendPositions, getLendEarnings, lendDeposit, lendWithdraw } =
  await import("../tools/chains/solana/lend-service.js");
const { Keypair } = await import("@solana/web3.js");

const testKeypair = Keypair.generate();

describe("lend service", () => {
  beforeEach(() => vi.clearAllMocks());

  describe("getLendRates", () => {
    it("calls /lend/v1/earn/tokens and maps wire format", async () => {
      mockFetchJson.mockResolvedValueOnce([
        {
          id: "jl1", address: "jlAddr", assetAddress: "usdcAddr",
          name: "jlUSDC", symbol: "jlUSDC", decimals: 6,
          totalAssets: "1000000", totalSupply: "900000",
          supplyRate: "0.045", rewardsRate: "0.01", totalRate: "0.055",
        },
      ]);

      const rates = await getLendRates();

      const [url] = mockFetchJson.mock.calls[0];
      expect(url).toContain("/lend/v1/earn/tokens");
      expect(rates).toHaveLength(1);
      expect(rates[0].supplyRate).toBe(0.045);
      expect(rates[0].rewardsRate).toBe(0.01);
      expect(rates[0].totalRate).toBe(0.055);
      expect(rates[0].address).toBe("jlAddr");
      expect(rates[0].assetAddress).toBe("usdcAddr");
    });

    it("handles numeric rates (not just strings)", async () => {
      mockFetchJson.mockResolvedValueOnce([
        {
          address: "a", assetAddress: "b", name: "N", symbol: "S", decimals: 6,
          totalAssets: "1", totalSupply: "1",
          supplyRate: 0.03, rewardsRate: 0.005,
        },
      ]);

      const rates = await getLendRates();
      expect(rates[0].supplyRate).toBe(0.03);
      expect(rates[0].totalRate).toBe(0); // totalRate missing → 0
    });
  });

  describe("getLendPositions", () => {
    it("calls /lend/v1/earn/positions?users= and maps nested token", async () => {
      mockFetchJson.mockResolvedValueOnce([
        {
          ownerAddress: "wallet1",
          token: { id: "jl1", address: "jlAddr", symbol: "jlUSDC", name: "jlUSDC" },
          shares: "500000", underlyingAssets: "550000", underlyingBalance: "550000",
        },
      ]);

      const positions = await getLendPositions("wallet1");

      const [url] = mockFetchJson.mock.calls[0];
      expect(url).toContain("/lend/v1/earn/positions?users=wallet1");
      expect(positions[0].tokenSymbol).toBe("jlUSDC");
      expect(positions[0].tokenAddress).toBe("jlAddr");
      expect(positions[0].shares).toBe("500000");
    });
  });

  describe("getLendEarnings", () => {
    it("calls /earn/earnings with user and positions", async () => {
      mockFetchJson.mockResolvedValueOnce([
        { address: "jlAddr", ownerAddress: "wallet1", earnings: 24800, slot: 12345 },
      ]);

      const earnings = await getLendEarnings("wallet1", ["jlAddr"]);

      const [url] = mockFetchJson.mock.calls[0];
      expect(url).toContain("/lend/v1/earn/earnings?user=wallet1&positions=jlAddr");
      expect(earnings).toHaveLength(1);
      expect(earnings[0].earnings).toBe(24800);
    });

    it("returns empty array for empty positions", async () => {
      const earnings = await getLendEarnings("wallet1", []);
      expect(earnings).toEqual([]);
      expect(mockFetchJson).not.toHaveBeenCalled();
    });
  });

  describe("lendDeposit", () => {
    it("calls POST /lend/v1/earn/deposit with { asset, amount, signer }", async () => {
      mockFetchJson.mockResolvedValueOnce({ transaction: "deposit-tx" });

      const result = await lendDeposit(testKeypair.secretKey, "usdc-mint", "1000000");

      const [url, opts] = mockFetchJson.mock.calls[0];
      expect(url).toContain("/lend/v1/earn/deposit");
      expect(opts.method).toBe("POST");
      const body = JSON.parse(opts.body);
      expect(body.asset).toBe("usdc-mint");
      expect(body.amount).toBe("1000000");
      expect(body.signer).toBe(testKeypair.publicKey.toBase58());
      expect(mockSignAndSend).toHaveBeenCalledWith("deposit-tx", [expect.any(Object)]);
      expect(result.signature).toBe("lend-sig");
    });
  });

  describe("lendWithdraw", () => {
    it("calls POST /lend/v1/earn/withdraw with { asset, amount, signer }", async () => {
      mockFetchJson.mockResolvedValueOnce({ transaction: "withdraw-tx" });

      const result = await lendWithdraw(testKeypair.secretKey, "usdc-mint", "500000");

      const [url, opts] = mockFetchJson.mock.calls[0];
      expect(url).toContain("/lend/v1/earn/withdraw");
      const body = JSON.parse(opts.body);
      expect(body.asset).toBe("usdc-mint");
      expect(body.amount).toBe("500000");
      expect(result.signature).toBe("lend-sig");
    });
  });
});
