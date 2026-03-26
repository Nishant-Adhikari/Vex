import { describe, expect, it, vi, beforeEach } from "vitest";

const mockJupiterSearch = vi.fn();
const mockJupiterByMint = vi.fn();
vi.mock("../tools/chains/solana/jupiter-client.js", () => ({
  jupiterSearchTokens: (...args: unknown[]) => mockJupiterSearch(...args),
  jupiterGetTokensByMint: (...args: unknown[]) => mockJupiterByMint(...args),
}));

const mockGetCached = vi.fn();
const mockCacheTokens = vi.fn();
vi.mock("../tools/chains/solana/token-cache.js", () => ({
  getCachedToken: (...args: unknown[]) => mockGetCached(...args),
  cacheTokens: (...args: unknown[]) => mockCacheTokens(...args),
}));

const { resolveToken, resolveTokens } = await import("../tools/chains/solana/token-registry.js");

describe("token registry", () => {
  beforeEach(() => vi.clearAllMocks());

  describe("resolveToken", () => {
    it("returns well-known SOL without any network call", async () => {
      const token = await resolveToken("SOL");
      expect(token).toBeDefined();
      expect(token!.symbol).toBe("SOL");
      expect(token!.address).toBe("So11111111111111111111111111111111111111112");
      expect(token!.decimals).toBe(9);
      expect(mockJupiterSearch).not.toHaveBeenCalled();
      expect(mockGetCached).not.toHaveBeenCalled();
    });

    it("resolves well-known by symbol case-insensitively", async () => {
      const token = await resolveToken("usdc");
      expect(token!.symbol).toBe("USDC");
      expect(token!.decimals).toBe(6);
    });

    it("resolves well-known by mint address", async () => {
      const token = await resolveToken("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
      expect(token!.symbol).toBe("USDC");
    });

    it("returns cached token when available", async () => {
      mockGetCached.mockReturnValueOnce({
        chain: "solana", address: "cached-mint", symbol: "CACHED", name: "Cached", decimals: 8,
      });

      const token = await resolveToken("CACHED");
      expect(token!.symbol).toBe("CACHED");
      expect(mockJupiterSearch).not.toHaveBeenCalled();
    });

    it("falls back to Jupiter search for unknown symbol", async () => {
      mockGetCached.mockReturnValue(undefined);
      mockJupiterSearch.mockResolvedValueOnce([
        { id: "new-mint", symbol: "NEW", name: "New Token", decimals: 9, icon: "https://img" },
      ]);

      const token = await resolveToken("NEW");
      expect(token!.symbol).toBe("NEW");
      expect(token!.address).toBe("new-mint");
      expect(mockJupiterSearch).toHaveBeenCalledWith("NEW");
      expect(mockCacheTokens).toHaveBeenCalled();
    });

    it("prefers exact symbol match from Jupiter results", async () => {
      mockGetCached.mockReturnValue(undefined);
      mockJupiterSearch.mockResolvedValueOnce([
        { id: "wrong-mint", symbol: "ABCX", name: "Wrong", decimals: 6 },
        { id: "right-mint", symbol: "ABC", name: "Right", decimals: 9 },
      ]);

      const token = await resolveToken("ABC");
      expect(token!.address).toBe("right-mint");
    });

    it("falls back to Jupiter mint lookup for mint-like input", async () => {
      mockGetCached.mockReturnValue(undefined);
      const longMint = "7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs";
      // This is well-known ETH, so it returns from constants
      const token = await resolveToken(longMint);
      expect(token!.symbol).toBe("ETH");
    });

    it("calls jupiterGetTokensByMint for unknown mint address", async () => {
      mockGetCached.mockReturnValue(undefined);
      const unknownMint = "UnknownMint1111111111111111111111111111111";
      mockJupiterByMint.mockResolvedValueOnce([
        { id: unknownMint, symbol: "UNK", name: "Unknown", decimals: 6 },
      ]);

      const token = await resolveToken(unknownMint);
      expect(token!.symbol).toBe("UNK");
      expect(mockJupiterByMint).toHaveBeenCalledWith([unknownMint]);
    });

    it("returns undefined when nothing found", async () => {
      mockGetCached.mockReturnValue(undefined);
      mockJupiterSearch.mockResolvedValueOnce([]);

      const token = await resolveToken("DOESNOTEXIST");
      expect(token).toBeUndefined();
    });

    it("returns undefined when Jupiter throws", async () => {
      mockGetCached.mockReturnValue(undefined);
      mockJupiterSearch.mockRejectedValueOnce(new Error("network"));

      const token = await resolveToken("NETERR");
      expect(token).toBeUndefined();
    });
  });

  describe("resolveTokens", () => {
    it("resolves well-known tokens without network calls", async () => {
      const result = await resolveTokens(["SOL", "USDC"]);
      expect(result.size).toBe(2);
      expect(result.get("SOL")!.symbol).toBe("SOL");
      expect(result.get("USDC")!.symbol).toBe("USDC");
      expect(mockJupiterSearch).not.toHaveBeenCalled();
      expect(mockJupiterByMint).not.toHaveBeenCalled();
    });

    it("batches mint lookups via jupiterGetTokensByMint", async () => {
      mockGetCached.mockReturnValue(undefined);
      const mint1 = "UnknownMint1111111111111111111111111111111";
      const mint2 = "UnknownMint2222222222222222222222222222222";
      mockJupiterByMint.mockResolvedValueOnce([
        { id: mint1, symbol: "A", name: "A", decimals: 6 },
        { id: mint2, symbol: "B", name: "B", decimals: 9 },
      ]);

      const result = await resolveTokens([mint1, mint2]);
      expect(result.size).toBe(2);
      expect(mockJupiterByMint).toHaveBeenCalledWith([mint1, mint2]);
    });

    it("mixes well-known, cached, and Jupiter results", async () => {
      mockGetCached.mockImplementation((q: string) => {
        if (q === "CACHED") return { chain: "solana", address: "c-mint", symbol: "CACHED", name: "C", decimals: 6 };
        return undefined;
      });
      mockJupiterSearch.mockResolvedValueOnce([
        { id: "new-mint", symbol: "NEW", name: "New", decimals: 9 },
      ]);

      const result = await resolveTokens(["SOL", "CACHED", "NEW"]);
      expect(result.size).toBe(3);
      expect(result.get("SOL")!.symbol).toBe("SOL");
      expect(result.get("CACHED")!.symbol).toBe("CACHED");
      expect(result.get("NEW")!.symbol).toBe("NEW");
    });
  });
});
