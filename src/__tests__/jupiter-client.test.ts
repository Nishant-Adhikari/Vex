import { describe, expect, it, vi, beforeEach } from "vitest";

const mockFetchJson = vi.fn();
vi.mock("../utils/http.js", () => ({
  fetchJson: (...args: unknown[]) => mockFetchJson(...args),
}));

const mockLoadConfig = vi.fn();
vi.mock("../config/store.js", () => ({
  loadConfig: () => mockLoadConfig(),
}));

const {
  getJupiterBaseUrl,
  getJupiterHeaders,
  jupiterUltraOrder,
  jupiterUltraExecute,
  jupiterHoldings,
  jupiterShield,
  jupiterSearchTokens,
  jupiterGetTokensByMint,
  jupiterGetPrices,
  jupiterGetTrendingTokens,
  jupiterGetSpotHistory,
} = await import("../tools/chains/solana/jupiter-client.js");
const { ErrorCodes } = await import("../errors.js");

describe("jupiter client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadConfig.mockReturnValue({ solana: { jupiterApiKey: "test-key" } });
  });

  // --- URL / Auth ---

  describe("getJupiterBaseUrl", () => {
    it("returns api.jup.ag when API key is set", () => {
      expect(getJupiterBaseUrl()).toBe("https://api.jup.ag");
    });

    it("returns lite-api.jup.ag when no API key", () => {
      mockLoadConfig.mockReturnValue({ solana: { jupiterApiKey: "" } });
      expect(getJupiterBaseUrl()).toBe("https://lite-api.jup.ag");
    });
  });

  describe("getJupiterHeaders", () => {
    it("includes x-api-key when key is set", () => {
      expect(getJupiterHeaders()).toEqual({ "x-api-key": "test-key" });
    });

    it("returns empty object when no key", () => {
      mockLoadConfig.mockReturnValue({ solana: { jupiterApiKey: "" } });
      expect(getJupiterHeaders()).toEqual({});
    });
  });

  // --- Swap V2 (order + execute) ---

  describe("jupiterUltraOrder", () => {
    it("calls /ultra/v1/order with correct query params", async () => {
      mockFetchJson.mockResolvedValueOnce({ requestId: "req-1", inAmount: "1000", outAmount: "500" });

      await jupiterUltraOrder({ inputMint: "SOL_MINT", outputMint: "USDC_MINT", amount: "1000000000" });

      const [url] = mockFetchJson.mock.calls[0];
      expect(url).toContain("/ultra/v1/order?");
      expect(url).toContain("inputMint=SOL_MINT");
      expect(url).toContain("outputMint=USDC_MINT");
      expect(url).toContain("amount=1000000000");
      expect(url).not.toContain("taker=");
      expect(url).not.toContain("slippageBps=");
    });

    it("includes taker when provided", async () => {
      mockFetchJson.mockResolvedValueOnce({ requestId: "req-1" });

      await jupiterUltraOrder({ inputMint: "A", outputMint: "B", amount: "100", taker: "WALLET_ADDR" });

      const [url] = mockFetchJson.mock.calls[0];
      expect(url).toContain("taker=WALLET_ADDR");
    });

    it("includes slippageBps when provided", async () => {
      mockFetchJson.mockResolvedValueOnce({ requestId: "req-1" });

      await jupiterUltraOrder({ inputMint: "A", outputMint: "B", amount: "100", slippageBps: 100 });

      const [url] = mockFetchJson.mock.calls[0];
      expect(url).toContain("slippageBps=100");
    });

    it("uses /ultra/v1/ path (matches official Jupiter CLI)", async () => {
      mockFetchJson.mockResolvedValueOnce({ requestId: "req-1" });

      await jupiterUltraOrder({ inputMint: "A", outputMint: "B", amount: "100" });

      const [url] = mockFetchJson.mock.calls[0];
      expect(url).toContain("/ultra/v1/order");
    });
  });

  describe("jupiterUltraExecute", () => {
    it("calls /ultra/v1/execute with POST and correct body", async () => {
      mockFetchJson.mockResolvedValueOnce({ status: "Success", signature: "sig1" });

      await jupiterUltraExecute("signed-tx-base64", "req-123");

      const [url, opts] = mockFetchJson.mock.calls[0];
      expect(url).toContain("/ultra/v1/execute");
      expect(opts.method).toBe("POST");
      const body = JSON.parse(opts.body);
      expect(body.signedTransaction).toBe("signed-tx-base64");
      expect(body.requestId).toBe("req-123");
    });
  });

  // --- Holdings / Shield ---

  describe("jupiterHoldings", () => {
    it("calls /ultra/v1/holdings/{address}", async () => {
      mockFetchJson.mockResolvedValueOnce({ amount: "100", tokens: {} });

      await jupiterHoldings("WALLET_ADDR");

      const [url] = mockFetchJson.mock.calls[0];
      expect(url).toContain("/ultra/v1/holdings/WALLET_ADDR");
    });
  });

  describe("jupiterShield", () => {
    it("calls /ultra/v1/shield and unwraps .warnings", async () => {
      mockFetchJson.mockResolvedValueOnce({
        warnings: { mint1: [{ type: "LOW_LIQUIDITY", message: "Low", severity: "warning", source: null }] },
      });

      const result = await jupiterShield(["mint1"]);

      const [url] = mockFetchJson.mock.calls[0];
      expect(url).toContain("/ultra/v1/shield?mints=mint1");
      expect(result.mint1).toHaveLength(1);
      expect(result.mint1[0].type).toBe("LOW_LIQUIDITY");
    });
  });

  // --- Token search ---

  describe("jupiterSearchTokens", () => {
    it("calls /tokens/v2/search with encoded query", async () => {
      mockFetchJson.mockResolvedValueOnce([{ id: "m1", symbol: "SOL", name: "Solana", decimals: 9 }]);

      const result = await jupiterSearchTokens("SOL test");

      const [url] = mockFetchJson.mock.calls[0];
      expect(url).toContain("/tokens/v2/search?query=SOL%20test");
      expect(result[0].symbol).toBe("SOL");
    });
  });

  describe("jupiterGetTokensByMint", () => {
    it("uses /tokens/v2/search with comma-separated mints", async () => {
      mockFetchJson.mockResolvedValueOnce([{ id: "m1", symbol: "A", name: "A", decimals: 6 }]);

      await jupiterGetTokensByMint(["m1", "m2"]);

      const [url] = mockFetchJson.mock.calls[0];
      expect(url).toContain("/tokens/v2/search?query=m1,m2");
    });

    it("returns empty array for empty input without fetching", async () => {
      const result = await jupiterGetTokensByMint([]);
      expect(result).toEqual([]);
      expect(mockFetchJson).not.toHaveBeenCalled();
    });

    it("throws for more than 100 mints", async () => {
      const mints = Array.from({ length: 101 }, (_, i) => `mint${i}`);
      await expect(jupiterGetTokensByMint(mints)).rejects.toMatchObject({
        code: ErrorCodes.SOLANA_TOKEN_NOT_FOUND,
      });
    });
  });

  // --- Price API ---

  describe("jupiterGetPrices", () => {
    it("calls /price/v3 and parses data.{mint}.price", async () => {
      mockFetchJson.mockResolvedValueOnce({
        data: {
          mint1: { price: "150.25" },
          mint2: { price: "0.0001" },
        },
      });

      const prices = await jupiterGetPrices(["mint1", "mint2"]);

      const [url] = mockFetchJson.mock.calls[0];
      expect(url).toContain("/price/v3?ids=mint1,mint2");
      expect(prices.get("mint1")).toBe(150.25);
      expect(prices.get("mint2")).toBe(0.0001);
    });

    it("returns empty map for empty input without fetching", async () => {
      const prices = await jupiterGetPrices([]);
      expect(prices.size).toBe(0);
      expect(mockFetchJson).not.toHaveBeenCalled();
    });

    it("skips tokens with null price", async () => {
      mockFetchJson.mockResolvedValueOnce({ data: { mint1: { price: null } } });
      const prices = await jupiterGetPrices(["mint1"]);
      expect(prices.has("mint1")).toBe(false);
    });
  });

  // --- Trending tokens ---

  describe("jupiterGetTrendingTokens", () => {
    it("uses /tokens/v2/{category}/{interval} for trending categories", async () => {
      mockFetchJson.mockResolvedValueOnce([{ id: "m1", symbol: "A", name: "A", decimals: 6 }]);

      await jupiterGetTrendingTokens("toptrending", "1h");

      const [url] = mockFetchJson.mock.calls[0];
      expect(url).toContain("/tokens/v2/toptrending/1h");
    });

    it("uses /tokens/v2/tag for lst category", async () => {
      mockFetchJson.mockResolvedValueOnce([]);

      await jupiterGetTrendingTokens("lst");

      const [url] = mockFetchJson.mock.calls[0];
      expect(url).toContain("/tokens/v2/tag?query=lst");
    });

    it("uses /tokens/v2/tag for verified category", async () => {
      mockFetchJson.mockResolvedValueOnce([]);

      await jupiterGetTrendingTokens("verified");

      const [url] = mockFetchJson.mock.calls[0];
      expect(url).toContain("/tokens/v2/tag?query=verified");
    });

    it("uses /tokens/v2/recent for recent category", async () => {
      mockFetchJson.mockResolvedValueOnce([]);

      await jupiterGetTrendingTokens("recent");

      const [url] = mockFetchJson.mock.calls[0];
      expect(url).toContain("/tokens/v2/recent");
    });

    it("slices results to limit", async () => {
      const items = Array.from({ length: 50 }, (_, i) => ({ id: `m${i}`, symbol: `T${i}`, name: `T${i}`, decimals: 6 }));
      mockFetchJson.mockResolvedValueOnce(items);

      const result = await jupiterGetTrendingTokens("toptrading" as any, "1h", 5);
      expect(result).toHaveLength(5);
    });
  });

  // --- Spot history ---

  describe("jupiterGetSpotHistory", () => {
    it("calls /_datapi/v1/txs/users with address and filters", async () => {
      mockFetchJson.mockResolvedValueOnce({ userTrades: [{ txHash: "tx1", type: "buy" }], next: "abc" });

      const result = await jupiterGetSpotHistory({
        address: "wallet1",
        assetId: "SOL_MINT",
        after: "2026-01-01T00:00:00Z",
        limit: 10,
      });

      const [url] = mockFetchJson.mock.calls[0];
      expect(url).toContain("/_datapi/v1/txs/users?");
      expect(url).toContain("addresses=wallet1");
      expect(url).toContain("includeCapitalSide=true");
      expect(url).toContain("assetId=SOL_MINT");
      expect(url).toContain("fromTs=2026-01-01T00%3A00%3A00Z");
      expect(url).toContain("limit=20"); // doubled for double-bookkeeping
      expect(result.userTrades).toHaveLength(1);
      expect(result.next).toBe("abc");
    });

    it("works with minimal params", async () => {
      mockFetchJson.mockResolvedValueOnce({ userTrades: [], next: null });

      await jupiterGetSpotHistory({ address: "w1" });

      const [url] = mockFetchJson.mock.calls[0];
      expect(url).toContain("addresses=w1");
      expect(url).not.toContain("assetId=");
      expect(url).not.toContain("fromTs=");
    });

    it("caps limit at 60", async () => {
      mockFetchJson.mockResolvedValueOnce({ userTrades: [], next: null });

      await jupiterGetSpotHistory({ address: "w1", limit: 50 });

      const [url] = mockFetchJson.mock.calls[0];
      expect(url).toContain("limit=60");
    });
  });
});
