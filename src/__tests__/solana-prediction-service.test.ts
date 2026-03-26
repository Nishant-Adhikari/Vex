import { describe, expect, it, vi, beforeEach } from "vitest";

const mockFetchJson = vi.fn();
vi.mock("../utils/http.js", () => ({
  fetchJson: (...args: unknown[]) => mockFetchJson(...args),
}));
vi.mock("../config/store.js", () => ({
  loadConfig: () => ({ solana: { jupiterApiKey: "", explorerUrl: "https://explorer.solana.com", cluster: "mainnet-beta" } }),
}));

vi.mock("../tools/chains/solana/tx.js", () => ({
  deserializeVersionedTx: vi.fn(() => ({ serialize: () => new Uint8Array([1, 2, 3]) })),
  signVersionedTx: vi.fn(),
}));

const {
  listEvents, searchEvents, getMarket, getEvent,
  createPredictOrder, getPositions, getPosition,
  claimPosition, closePosition, closeAllPositions,
  getPredictHistory,
} = await import("../tools/chains/solana/prediction-service.js");
const { Keypair } = await import("@solana/web3.js");

const testKeypair = Keypair.generate();

describe("prediction service", () => {
  beforeEach(() => vi.clearAllMocks());

  // --- Read operations ---

  describe("listEvents", () => {
    it("unwraps { data: [] } and normalizes fields", async () => {
      mockFetchJson.mockResolvedValueOnce({
        data: [{
          eventId: "EVT-1", metadata: { title: "Will SOL hit $200?" },
          category: "crypto", isLive: true,
          markets: [{ marketId: "MKT-1", metadata: { title: "SOL > $200" }, pricing: { buyYesPriceUsd: 0.65, buyNoPriceUsd: 0.35, volume: 50000 } }],
        }],
      });

      const events = await listEvents("crypto");
      expect(events).toHaveLength(1);
      expect(events[0].id).toBe("EVT-1");
      expect(events[0].title).toBe("Will SOL hit $200?");
      expect(events[0].status).toBe("live");
      expect(events[0].markets![0].buyYesPriceUsd).toBe(0.65);
    });

    it("returns [] when data is null", async () => {
      mockFetchJson.mockResolvedValueOnce({ data: null });
      expect(await listEvents()).toEqual([]);
    });

    it("passes category and filter as query params", async () => {
      mockFetchJson.mockResolvedValueOnce({ data: [] });
      await listEvents("sports", "trending");
      const [url] = mockFetchJson.mock.calls[0];
      expect(url).toContain("category=sports");
      expect(url).toContain("filter=trending");
      expect(url).toContain("includeMarkets=true");
    });
  });

  describe("searchEvents", () => {
    it("calls /events/search with encoded query", async () => {
      mockFetchJson.mockResolvedValueOnce({ data: [] });
      await searchEvents("BTC price");
      expect(mockFetchJson.mock.calls[0][0]).toContain("/events/search?query=BTC%20price");
    });
  });

  describe("getMarket", () => {
    it("calls /markets/{id} and normalizes pricing", async () => {
      mockFetchJson.mockResolvedValueOnce({
        marketId: "MKT-1", metadata: { title: "Market Title" }, status: "open", result: "",
        pricing: { buyYesPriceUsd: 0.72, buyNoPriceUsd: 0.28, volume: 100000 },
      });
      const market = await getMarket("MKT-1");
      expect(mockFetchJson.mock.calls[0][0]).toContain("/markets/MKT-1");
      expect(market.buyYesPriceUsd).toBe(0.72);
    });
  });

  describe("getEvent", () => {
    it("calls /events/{id} with includeMarkets", async () => {
      mockFetchJson.mockResolvedValueOnce({
        eventId: "EVT-1", metadata: { title: "Test" }, category: "crypto", isLive: true, markets: [],
      });
      const event = await getEvent("EVT-1");
      expect(mockFetchJson.mock.calls[0][0]).toContain("/events/EVT-1?includeMarkets=true");
      expect(event.id).toBe("EVT-1");
    });
  });

  describe("getPositions", () => {
    it("unwraps { data: [] }", async () => {
      mockFetchJson.mockResolvedValueOnce({
        data: [{ pubkey: "pos1", marketId: "MKT-1", isYes: true, contracts: 10, totalCostUsd: 6.5, valueUsd: 7, pnlUsd: 0.5, pnlUsdPercent: 7.7, claimable: false }],
      });
      const positions = await getPositions("wallet1");
      expect(positions).toHaveLength(1);
      expect(positions[0].pubkey).toBe("pos1");
    });

    it("returns [] on error", async () => {
      mockFetchJson.mockRejectedValueOnce(new Error("network"));
      expect(await getPositions("wallet1")).toEqual([]);
    });
  });

  describe("getPosition", () => {
    it("calls /positions/{pubkey}", async () => {
      mockFetchJson.mockResolvedValueOnce({ pubkey: "pos1", marketId: "MKT-1" });
      const pos = await getPosition("pos1");
      expect(mockFetchJson.mock.calls[0][0]).toContain("/positions/pos1");
      expect(pos.pubkey).toBe("pos1");
    });
  });

  // --- Write operations (managed execute via /orders/execute) ---

  describe("createPredictOrder", () => {
    it("creates order then signs and executes via /orders/execute", async () => {
      // POST /orders
      mockFetchJson.mockResolvedValueOnce({ transaction: "predict-tx", order: { positionPubkey: "pos-1" } });
      // POST /orders/execute
      mockFetchJson.mockResolvedValueOnce({ signature: "sig-1" });

      const result = await createPredictOrder(testKeypair.secretKey, "MKT-1", true, 10);

      // Verify order creation
      const [orderUrl, orderOpts] = mockFetchJson.mock.calls[0];
      expect(orderUrl).toContain("/prediction/v1/orders");
      expect(JSON.parse(orderOpts.body).depositAmount).toBe(10_000_000);

      // Verify managed execute (not direct RPC)
      const [execUrl, execOpts] = mockFetchJson.mock.calls[1];
      expect(execUrl).toContain("/prediction/v1/orders/execute");
      expect(execOpts.method).toBe("POST");
      expect(JSON.parse(execOpts.body).signedTransaction).toBeTruthy();

      expect(result.signature).toBe("sig-1");
      expect(result.positionPubkey).toBe("pos-1");
    });
  });

  describe("claimPosition", () => {
    it("claims via /positions/{pubkey}/claim then executes via /orders/execute", async () => {
      mockFetchJson.mockResolvedValueOnce({ transaction: "claim-tx" });
      mockFetchJson.mockResolvedValueOnce({ signature: "claim-sig" });

      const result = await claimPosition(testKeypair.secretKey, "pos-1");

      expect(mockFetchJson.mock.calls[0][0]).toContain("/positions/pos-1/claim");
      expect(mockFetchJson.mock.calls[1][0]).toContain("/orders/execute");
      expect(result.signature).toBe("claim-sig");
    });
  });

  describe("closePosition", () => {
    it("closes via DELETE /positions/{pubkey} then executes via /orders/execute", async () => {
      mockFetchJson.mockResolvedValueOnce({ transaction: "close-tx" });
      mockFetchJson.mockResolvedValueOnce({ signature: "close-sig" });

      const result = await closePosition(testKeypair.secretKey, "pos-2");

      expect(mockFetchJson.mock.calls[0][1].method).toBe("DELETE");
      expect(mockFetchJson.mock.calls[1][0]).toContain("/orders/execute");
      expect(result.signature).toBe("close-sig");
    });
  });

  describe("closeAllPositions", () => {
    it("closes all via DELETE /positions then executes each", async () => {
      mockFetchJson.mockResolvedValueOnce({ data: [{ transaction: "tx1" }, { transaction: "tx2" }] });
      mockFetchJson.mockResolvedValueOnce({ signature: "sig1" });
      mockFetchJson.mockResolvedValueOnce({ signature: "sig2" });

      const results = await closeAllPositions(testKeypair.secretKey);

      expect(results).toHaveLength(2);
      expect(results[0].signature).toBe("sig1");
      expect(results[1].signature).toBe("sig2");
      expect(mockFetchJson.mock.calls[0][1].method).toBe("DELETE");
    });

    it("returns empty array when no positions", async () => {
      mockFetchJson.mockResolvedValueOnce({ data: [] });
      const results = await closeAllPositions(testKeypair.secretKey);
      expect(results).toEqual([]);
    });
  });

  // --- History ---

  describe("getPredictHistory", () => {
    it("calls /history with pagination params", async () => {
      mockFetchJson.mockResolvedValueOnce({
        data: [{
          timestamp: 1711000000, eventType: "order_filled", isYes: true, isBuy: true,
          filledContracts: "10", avgFillPriceUsd: "650000", realizedPnl: null,
          positionPubkey: "pos1", signature: "sig1",
        }],
        pagination: { hasNext: true },
      });

      const { history, hasNext } = await getPredictHistory("wallet1", { limit: 5, offset: 10 });

      const [url] = mockFetchJson.mock.calls[0];
      expect(url).toContain("/history?ownerPubkey=wallet1&start=10&end=15");
      expect(history).toHaveLength(1);
      expect(history[0].side).toBe("yes");
      expect(history[0].action).toBe("buy");
      expect(hasNext).toBe(true);
    });

    it("defaults to offset=0 limit=10", async () => {
      mockFetchJson.mockResolvedValueOnce({ data: [], pagination: { hasNext: false } });
      await getPredictHistory("wallet1");
      expect(mockFetchJson.mock.calls[0][0]).toContain("start=0&end=10");
    });
  });
});
