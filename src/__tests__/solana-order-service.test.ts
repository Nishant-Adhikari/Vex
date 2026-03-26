import { describe, expect, it, vi, beforeEach } from "vitest";

const mockFetchJson = vi.fn();
vi.mock("../utils/http.js", () => ({
  fetchJson: (...args: unknown[]) => mockFetchJson(...args),
}));
vi.mock("../config/store.js", () => ({
  loadConfig: () => ({ solana: { jupiterApiKey: "key" } }),
}));

const mockResolveToken = vi.fn();
vi.mock("../tools/chains/solana/token-registry.js", () => ({
  resolveToken: (...args: unknown[]) => mockResolveToken(...args),
}));

const mockDeserialize = vi.fn(() => ({ serialize: () => new Uint8Array([1, 2, 3]) }));
const mockSign = vi.fn();
vi.mock("../tools/chains/solana/tx.js", () => ({
  deserializeVersionedTx: (...args: unknown[]) => mockDeserialize(...args),
  signVersionedTx: (...args: unknown[]) => mockSign(...args),
  signAndSendVersionedTx: vi.fn(),
}));

const { createDcaOrder, listDcaOrders, cancelDcaOrder, createLimitOrder, listLimitOrders, cancelLimitOrder } =
  await import("../tools/chains/solana/order-service.js");
const { ErrorCodes } = await import("../errors.js");
const { Keypair } = await import("@solana/web3.js");

const USDC_TOKEN = { chain: "solana" as const, address: "USDC_MINT", symbol: "USDC", name: "USD Coin", decimals: 6 };
const SOL_TOKEN = { chain: "solana" as const, address: "SOL_MINT", symbol: "SOL", name: "Solana", decimals: 9 };
const testKeypair = Keypair.generate();

describe("order service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveToken.mockImplementation((sym: string) => {
      if (sym === "USDC") return USDC_TOKEN;
      if (sym === "SOL") return SOL_TOKEN;
      return undefined;
    });
  });

  // --- DCA ---

  describe("createDcaOrder", () => {
    it("sends inAmount = amountPerCycle * numberOfOrders (CRITICAL FIX)", async () => {
      // createOrder returns tx
      mockFetchJson.mockResolvedValueOnce({ requestId: "req-1", transaction: "dHgx..." });
      // execute returns success
      mockFetchJson.mockResolvedValueOnce({ status: "Success", signature: "sig1", order: "order1", error: null });

      await createDcaOrder(testKeypair.secretKey, "USDC", "SOL", 10, "day", 5);

      const [createUrl, createOpts] = mockFetchJson.mock.calls[0];
      expect(createUrl).toContain("/recurring/v1/createOrder");
      const body = JSON.parse(createOpts.body);
      // 10 USDC/cycle * 5 cycles = 50 USDC total = 50_000_000 atomic
      expect(body.params.time.inAmount).toBe(50_000_000);
      expect(body.params.time.numberOfOrders).toBe(5);
      expect(body.params.time.interval).toBe(86400); // day
    });

    it("maps interval correctly", async () => {
      mockFetchJson.mockResolvedValueOnce({ requestId: "r", transaction: "tx" });
      mockFetchJson.mockResolvedValueOnce({ status: "Success", signature: "s", order: "o", error: null });

      await createDcaOrder(testKeypair.secretKey, "USDC", "SOL", 1, "hour", 2);

      const body = JSON.parse(mockFetchJson.mock.calls[0][1].body);
      expect(body.params.time.interval).toBe(3600);
    });

    it("throws SOLANA_TOKEN_NOT_FOUND for unknown input token", async () => {
      mockResolveToken.mockReturnValue(undefined);

      await expect(createDcaOrder(testKeypair.secretKey, "UNKNOWN", "SOL", 10, "day", 5))
        .rejects.toMatchObject({ code: ErrorCodes.SOLANA_TOKEN_NOT_FOUND });
    });

    it("throws SOLANA_ORDER_FAILED when execute fails", async () => {
      mockFetchJson.mockResolvedValueOnce({ requestId: "r", transaction: "tx" });
      mockFetchJson.mockResolvedValueOnce({ status: "Failed", signature: "", order: null, error: "network" });

      await expect(createDcaOrder(testKeypair.secretKey, "USDC", "SOL", 10, "day", 5))
        .rejects.toMatchObject({ code: ErrorCodes.SOLANA_ORDER_FAILED });
    });

    it("sends execute with requestId and signedTransaction", async () => {
      mockFetchJson.mockResolvedValueOnce({ requestId: "req-42", transaction: "dHgx..." });
      mockFetchJson.mockResolvedValueOnce({ status: "Success", signature: "sig", order: "o", error: null });

      await createDcaOrder(testKeypair.secretKey, "USDC", "SOL", 10, "day", 1);

      const [execUrl, execOpts] = mockFetchJson.mock.calls[1];
      expect(execUrl).toContain("/recurring/v1/execute");
      const execBody = JSON.parse(execOpts.body);
      expect(execBody.requestId).toBe("req-42");
      expect(execBody.signedTransaction).toBeTruthy();
    });
  });

  describe("listDcaOrders", () => {
    it("fetches single page when hasMoreData is false", async () => {
      mockFetchJson.mockResolvedValueOnce({
        time: [{ orderKey: "o1" }],
        hasMoreData: false,
      });

      const orders = await listDcaOrders("wallet1");

      expect(orders).toHaveLength(1);
      expect(mockFetchJson).toHaveBeenCalledTimes(1);
      const [url] = mockFetchJson.mock.calls[0];
      expect(url).toContain("page=1");
    });

    it("paginates when hasMoreData is true", async () => {
      mockFetchJson.mockResolvedValueOnce({ time: [{ orderKey: "o1" }], hasMoreData: true });
      mockFetchJson.mockResolvedValueOnce({ time: [{ orderKey: "o2" }], hasMoreData: false });

      const orders = await listDcaOrders("wallet1");

      expect(orders).toHaveLength(2);
      expect(mockFetchJson).toHaveBeenCalledTimes(2);
      expect(mockFetchJson.mock.calls[1][0]).toContain("page=2");
    });

    it("returns empty array on error", async () => {
      mockFetchJson.mockRejectedValueOnce(new Error("network"));
      const orders = await listDcaOrders("wallet1");
      expect(orders).toEqual([]);
    });

    it("returns empty array when time is null", async () => {
      mockFetchJson.mockResolvedValueOnce({ time: null, hasMoreData: false });
      const orders = await listDcaOrders("wallet1");
      expect(orders).toEqual([]);
    });
  });

  describe("cancelDcaOrder", () => {
    it("sends cancelOrder with user, order, recurringType", async () => {
      mockFetchJson.mockResolvedValueOnce({ requestId: "r1", transaction: "tx" });
      mockFetchJson.mockResolvedValueOnce({ status: "Success", signature: "sig1", error: null });

      const sig = await cancelDcaOrder(testKeypair.secretKey, "order-key-1");

      const body = JSON.parse(mockFetchJson.mock.calls[0][1].body);
      expect(body.order).toBe("order-key-1");
      expect(body.recurringType).toBe("time");
      expect(body.user).toBeTruthy();
      expect(sig).toBe("sig1");
    });

    it("throws SOLANA_ORDER_FAILED when cancel execute fails", async () => {
      mockFetchJson.mockResolvedValueOnce({ requestId: "r", transaction: "tx" });
      mockFetchJson.mockResolvedValueOnce({ status: "Failed", signature: "", error: "timeout" });

      await expect(cancelDcaOrder(testKeypair.secretKey, "order-1"))
        .rejects.toMatchObject({ code: ErrorCodes.SOLANA_ORDER_FAILED });
    });
  });

  // --- Limit Orders ---

  describe("createLimitOrder", () => {
    it("sends trigger/v1/createOrder with correct params", async () => {
      // Mock price fetch (jupiterGetPrices uses fetchJson internally)
      mockFetchJson.mockResolvedValueOnce({ data: { USDC_MINT: { price: "1.0" } } }); // price
      mockFetchJson.mockResolvedValueOnce({ requestId: "r", transaction: "tx", order: "ord-1" }); // createOrder
      mockFetchJson.mockResolvedValueOnce({ signature: "sig", status: "Success" }); // execute

      await createLimitOrder(testKeypair.secretKey, "USDC", "SOL", 100, 150);

      const createCall = mockFetchJson.mock.calls[1];
      expect(createCall[0]).toContain("/trigger/v1/createOrder");
      const body = JSON.parse(createCall[1].body);
      expect(body.inputMint).toBe("USDC_MINT");
      expect(body.outputMint).toBe("SOL_MINT");
      expect(body.params.makingAmount).toBeTruthy();
      expect(body.params.takingAmount).toBeTruthy();
      expect(body.computeUnitPrice).toBe("auto");
      expect(body.wrapAndUnwrapSol).toBe(true);
    });

    it("calculates takingAmount from price ratio", async () => {
      // Input: 100 USDC at inputPrice $1, target output price $150
      // Expected output = (100 * 1) / 150 SOL = 0.6667 SOL = 666_666_667 atomic (9 decimals)
      mockFetchJson.mockResolvedValueOnce({ data: { USDC_MINT: { price: "1.0" } } });
      mockFetchJson.mockResolvedValueOnce({ requestId: "r", transaction: "tx", order: "ord" });
      mockFetchJson.mockResolvedValueOnce({ signature: "s", status: "Success" });

      await createLimitOrder(testKeypair.secretKey, "USDC", "SOL", 100, 150);

      const body = JSON.parse(mockFetchJson.mock.calls[1][1].body);
      // makingAmount = 100 * 10^6 = 100_000_000
      expect(body.params.makingAmount).toBe("100000000");
      // takingAmount = (100 * 1.0 / 150) * 10^9 ≈ 666_666_667
      const taking = Number(body.params.takingAmount);
      expect(taking).toBeGreaterThan(666_000_000);
      expect(taking).toBeLessThan(667_000_000);
    });

    it("throws when trigger execute fails", async () => {
      mockFetchJson.mockResolvedValueOnce({ data: { USDC_MINT: { price: "1.0" } } });
      mockFetchJson.mockResolvedValueOnce({ requestId: "r", transaction: "tx", order: "ord" });
      mockFetchJson.mockResolvedValueOnce({ signature: "", status: "Failed" });

      await expect(createLimitOrder(testKeypair.secretKey, "USDC", "SOL", 100, 150))
        .rejects.toMatchObject({ code: ErrorCodes.SOLANA_ORDER_FAILED });
    });
  });

  describe("listLimitOrders", () => {
    it("paginates trigger orders", async () => {
      mockFetchJson.mockResolvedValueOnce({ orders: [{ orderKey: "o1" }], hasMoreData: true });
      mockFetchJson.mockResolvedValueOnce({ orders: [{ orderKey: "o2" }], hasMoreData: false });

      const orders = await listLimitOrders("wallet1");

      expect(orders).toHaveLength(2);
      expect(mockFetchJson.mock.calls[0][0]).toContain("/trigger/v1/getTriggerOrders");
      expect(mockFetchJson.mock.calls[0][0]).toContain("page=1");
      expect(mockFetchJson.mock.calls[1][0]).toContain("page=2");
    });

    it("does not include includeFailedTx param", async () => {
      mockFetchJson.mockResolvedValueOnce({ orders: [], hasMoreData: false });

      await listLimitOrders("wallet1");

      const [url] = mockFetchJson.mock.calls[0];
      expect(url).not.toContain("includeFailedTx");
    });
  });

  describe("cancelLimitOrder", () => {
    it("sends cancelOrder with maker, order, computeUnitPrice", async () => {
      mockFetchJson.mockResolvedValueOnce({ requestId: "r", transaction: "tx" });
      mockFetchJson.mockResolvedValueOnce({ signature: "sig", status: "Success" });

      await cancelLimitOrder(testKeypair.secretKey, "order-key-1");

      const body = JSON.parse(mockFetchJson.mock.calls[0][1].body);
      expect(body.maker).toBeTruthy();
      expect(body.order).toBe("order-key-1");
      expect(body.computeUnitPrice).toBe("auto");

      const execBody = JSON.parse(mockFetchJson.mock.calls[1][1].body);
      expect(execBody.requestId).toBe("r");
      expect(execBody.signedTransaction).toBeTruthy();
    });
  });
});
