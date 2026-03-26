import { describe, expect, it, vi, beforeEach } from "vitest";

const mockFetchJson = vi.fn();
vi.mock("../utils/http.js", () => ({
  fetchJson: (...args: unknown[]) => mockFetchJson(...args),
}));
vi.mock("../config/store.js", () => ({
  loadConfig: () => ({ solana: { jupiterApiKey: "test-key" } }),
}));

const {
  perpsGetMarkets,
  perpsGetPositions,
  perpsGetTrades,
  perpsIncreasePosition,
  perpsDecreasePosition,
  perpsCloseAll,
  perpsCreateLimitOrder,
  perpsUpdateLimitOrder,
  perpsCancelLimitOrder,
  perpsSetTpsl,
  perpsUpdateTpsl,
  perpsCancelTpsl,
  perpsExecute,
  resolvePerpsAsset,
  PERPS_ASSETS,
} = await import("../tools/chains/solana/perps-client.js");

describe("perps client", () => {
  beforeEach(() => vi.clearAllMocks());

  // --- Asset resolution ---

  describe("resolvePerpsAsset", () => {
    it("resolves SOL", () => {
      const asset = resolvePerpsAsset("SOL");
      expect(asset.mint).toBe("So11111111111111111111111111111111111111112");
      expect(asset.decimals).toBe(9);
    });

    it("resolves case-insensitive", () => {
      expect(resolvePerpsAsset("btc").mint).toBe(PERPS_ASSETS.BTC.mint);
      expect(resolvePerpsAsset("Eth").mint).toBe(PERPS_ASSETS.ETH.mint);
    });

    it("throws for unknown asset", () => {
      expect(() => resolvePerpsAsset("DOGE")).toThrow("Unknown perps asset");
    });
  });

  // --- Markets ---

  describe("perpsGetMarkets", () => {
    it("fetches market-stats for SOL, BTC, ETH in parallel", async () => {
      mockFetchJson.mockResolvedValue({ price: "150", priceChange24H: "2.5", priceHigh24H: "155", priceLow24H: "145", volume: "1000000" });

      const markets = await perpsGetMarkets();

      expect(markets).toHaveLength(3);
      expect(markets.map((m) => m.asset)).toEqual(["SOL", "BTC", "ETH"]);
      expect(mockFetchJson).toHaveBeenCalledTimes(3);

      // Verify correct host
      const url0 = mockFetchJson.mock.calls[0][0] as string;
      expect(url0).toContain("perps-api.jup.ag/v2/market-stats");
      expect(url0).toContain(`mint=${PERPS_ASSETS.SOL.mint}`);
    });
  });

  // --- Positions ---

  describe("perpsGetPositions", () => {
    it("fetches positions and limit orders in parallel", async () => {
      mockFetchJson
        .mockResolvedValueOnce({ count: 1, dataList: [{ positionPubkey: "pos1", side: "long" }] })
        .mockResolvedValueOnce({ count: 0, dataList: [] });

      const result = await perpsGetPositions("wallet1");

      expect(result.positions).toHaveLength(1);
      expect(result.positions[0].positionPubkey).toBe("pos1");
      expect(result.limitOrders).toHaveLength(0);
      expect(mockFetchJson).toHaveBeenCalledTimes(2);

      const posUrl = mockFetchJson.mock.calls[0][0] as string;
      expect(posUrl).toContain("perps-api.jup.ag/v2/positions?walletAddress=wallet1");

      const ordUrl = mockFetchJson.mock.calls[1][0] as string;
      expect(ordUrl).toContain("perps-api.jup.ag/v2/orders/limit?walletAddress=wallet1");
    });

    it("returns empty arrays when dataList is null", async () => {
      mockFetchJson
        .mockResolvedValueOnce({ count: 0, dataList: null })
        .mockResolvedValueOnce({ count: 0, dataList: null });

      const result = await perpsGetPositions("wallet1");
      expect(result.positions).toEqual([]);
      expect(result.limitOrders).toEqual([]);
    });
  });

  // --- Trades ---

  describe("perpsGetTrades", () => {
    it("fetches trades with filters", async () => {
      mockFetchJson.mockResolvedValueOnce({ count: 5, dataList: [{ txHash: "tx1", action: "Increase" }] });

      const result = await perpsGetTrades({ walletAddress: "w1", asset: "SOL", side: "long", limit: 10 });

      expect(result.trades).toHaveLength(1);
      const url = mockFetchJson.mock.calls[0][0] as string;
      expect(url).toContain("perps-api.jup.ag/v2/trades?");
      expect(url).toContain("walletAddress=w1");
      expect(url).toContain(`mint=${PERPS_ASSETS.SOL.mint}`);
      expect(url).toContain("side=long");
      expect(url).toContain("end=10");
    });

    it("works without filters", async () => {
      mockFetchJson.mockResolvedValueOnce({ count: 0, dataList: [] });

      await perpsGetTrades({ walletAddress: "w1" });

      const url = mockFetchJson.mock.calls[0][0] as string;
      expect(url).toContain("walletAddress=w1");
      expect(url).not.toContain("mint=");
      expect(url).not.toContain("side=");
    });
  });

  // --- Increase position ---

  describe("perpsIncreasePosition", () => {
    it("sends POST to /positions/increase with correct body", async () => {
      mockFetchJson.mockResolvedValueOnce({
        positionPubkey: "pos1",
        quote: { sizeUsdDelta: "20", leverage: "2" },
        serializedTxBase64: "tx-data",
        txMetadata: { blockhash: "bh", lastValidBlockHeight: "100" },
      });

      const result = await perpsIncreasePosition({
        asset: PERPS_ASSETS.SOL.mint,
        inputToken: PERPS_ASSETS.USDC.mint,
        side: "long",
        maxSlippageBps: "200",
        leverage: "2",
        walletAddress: "w1",
      });

      const [url, opts] = mockFetchJson.mock.calls[0];
      expect(url).toContain("perps-api.jup.ag/v2/positions/increase");
      expect(opts.method).toBe("POST");
      const body = JSON.parse(opts.body);
      expect(body.asset).toBe(PERPS_ASSETS.SOL.mint);
      expect(body.side).toBe("long");
      expect(body.leverage).toBe("2");
      expect(result.positionPubkey).toBe("pos1");
    });
  });

  // --- Decrease position ---

  describe("perpsDecreasePosition", () => {
    it("sends POST to /positions/decrease", async () => {
      mockFetchJson.mockResolvedValueOnce({
        positionPubkey: "pos1",
        quote: { pnlAfterFeesUsd: "5.00" },
        serializedTxBase64: "tx",
        txMetadata: {},
      });

      await perpsDecreasePosition({
        positionPubkey: "pos1",
        receiveToken: PERPS_ASSETS.USDC.mint,
        entirePosition: true,
        maxSlippageBps: "200",
      });

      const [url, opts] = mockFetchJson.mock.calls[0];
      expect(url).toContain("/positions/decrease");
      const body = JSON.parse(opts.body);
      expect(body.positionPubkey).toBe("pos1");
      expect(body.entirePosition).toBe(true);
    });
  });

  // --- Close all ---

  describe("perpsCloseAll", () => {
    it("sends POST to /positions/close-all", async () => {
      mockFetchJson.mockResolvedValueOnce({ serializedTxs: [], txMetadata: {} });

      await perpsCloseAll("w1");

      const [url, opts] = mockFetchJson.mock.calls[0];
      expect(url).toContain("/positions/close-all");
      const body = JSON.parse(opts.body);
      expect(body.walletAddress).toBe("w1");
    });
  });

  // --- Limit orders ---

  describe("perpsCreateLimitOrder", () => {
    it("sends POST to /orders/limit", async () => {
      mockFetchJson.mockResolvedValueOnce({
        positionPubkey: "pos1",
        quote: {},
        serializedTxBase64: "tx",
        txMetadata: {},
      });

      await perpsCreateLimitOrder({
        asset: PERPS_ASSETS.BTC.mint,
        inputToken: PERPS_ASSETS.USDC.mint,
        side: "long",
        triggerPrice: "65000",
        walletAddress: "w1",
      });

      const [url, opts] = mockFetchJson.mock.calls[0];
      expect(url).toContain("/orders/limit");
      expect(opts.method).toBe("POST");
      const body = JSON.parse(opts.body);
      expect(body.triggerPrice).toBe("65000");
    });
  });

  describe("perpsUpdateLimitOrder", () => {
    it("sends PATCH to /orders/limit", async () => {
      mockFetchJson.mockResolvedValueOnce({ serializedTxBase64: "tx", txMetadata: {} });

      await perpsUpdateLimitOrder({ positionRequestPubkey: "ord1", triggerPrice: "64000" });

      const [, opts] = mockFetchJson.mock.calls[0];
      expect(opts.method).toBe("PATCH");
      const body = JSON.parse(opts.body);
      expect(body.triggerPrice).toBe("64000");
    });
  });

  describe("perpsCancelLimitOrder", () => {
    it("sends DELETE to /orders/limit", async () => {
      mockFetchJson.mockResolvedValueOnce({ serializedTxBase64: "tx", txMetadata: {} });

      await perpsCancelLimitOrder("ord1");

      const [, opts] = mockFetchJson.mock.calls[0];
      expect(opts.method).toBe("DELETE");
      const body = JSON.parse(opts.body);
      expect(body.positionRequestPubkey).toBe("ord1");
    });
  });

  // --- TP/SL ---

  describe("perpsSetTpsl", () => {
    it("sends POST to /tpsl with TP and SL", async () => {
      mockFetchJson.mockResolvedValueOnce({
        serializedTxBase64: "tx",
        tpslRequests: [{ requestType: "tp" }, { requestType: "sl" }],
        txMetadata: {},
      });

      await perpsSetTpsl({
        walletAddress: "w1",
        positionPubkey: "pos1",
        tpsl: [
          { receiveToken: PERPS_ASSETS.SOL.mint, triggerPrice: "100", requestType: "tp", entirePosition: true },
          { receiveToken: PERPS_ASSETS.SOL.mint, triggerPrice: "70", requestType: "sl", entirePosition: true },
        ],
      });

      const [url, opts] = mockFetchJson.mock.calls[0];
      expect(url).toContain("/tpsl");
      expect(opts.method).toBe("POST");
      const body = JSON.parse(opts.body);
      expect(body.tpsl).toHaveLength(2);
      expect(body.positionPubkey).toBe("pos1");
    });
  });

  describe("perpsUpdateTpsl", () => {
    it("sends PATCH to /tpsl", async () => {
      mockFetchJson.mockResolvedValueOnce({ serializedTxBase64: "tx", tpslRequests: [], txMetadata: {} });

      await perpsUpdateTpsl({ positionRequestPubkey: "tpsl1", triggerPrice: "105" });

      const [, opts] = mockFetchJson.mock.calls[0];
      expect(opts.method).toBe("PATCH");
    });
  });

  describe("perpsCancelTpsl", () => {
    it("sends DELETE to /tpsl", async () => {
      mockFetchJson.mockResolvedValueOnce({ serializedTxBase64: "tx", txMetadata: {} });

      await perpsCancelTpsl("tpsl1");

      const [, opts] = mockFetchJson.mock.calls[0];
      expect(opts.method).toBe("DELETE");
    });
  });

  // --- Execute ---

  describe("perpsExecute", () => {
    it("sends POST to /transaction/execute with action and signed tx", async () => {
      mockFetchJson.mockResolvedValueOnce({ action: "increase-position", txid: "sig1" });

      const result = await perpsExecute({ action: "increase-position", serializedTxBase64: "signed-tx" });

      const [url, opts] = mockFetchJson.mock.calls[0];
      expect(url).toContain("perps-api.jup.ag/v2/transaction/execute");
      expect(opts.method).toBe("POST");
      const body = JSON.parse(opts.body);
      expect(body.action).toBe("increase-position");
      expect(body.serializedTxBase64).toBe("signed-tx");
      expect(result.txid).toBe("sig1");
    });
  });
});
