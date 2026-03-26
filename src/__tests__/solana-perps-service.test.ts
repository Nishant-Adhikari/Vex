import { describe, expect, it, vi, beforeEach } from "vitest";

const mockFetchJson = vi.fn();
vi.mock("../utils/http.js", () => ({
  fetchJson: (...args: unknown[]) => mockFetchJson(...args),
}));
vi.mock("../config/store.js", () => ({
  loadConfig: () => ({ solana: { jupiterApiKey: "key", explorerUrl: "https://explorer.solana.com", cluster: "mainnet-beta" } }),
}));

const mockDeserialize = vi.fn(() => ({ serialize: () => new Uint8Array([1, 2, 3]) }));
const mockSign = vi.fn();
vi.mock("../tools/chains/solana/tx.js", () => ({
  deserializeVersionedTx: (...args: unknown[]) => mockDeserialize(...args),
  signVersionedTx: (...args: unknown[]) => mockSign(...args),
}));

const {
  openPerpsPosition,
  closePerpsPosition,
  closeAllPerpsPositions,
  updatePerpsLimitOrder,
  cancelPerpsLimitOrder,
  setPerpsTPSL,
  cancelPerpsTPSL,
} = await import("../tools/chains/solana/perps-service.js");
const { ErrorCodes } = await import("../errors.js");
const { Keypair } = await import("@solana/web3.js");

const testKeypair = Keypair.generate();

describe("perps service", () => {
  beforeEach(() => vi.clearAllMocks());

  // --- Open position ---

  describe("openPerpsPosition", () => {
    it("market order: calls /positions/increase then /transaction/execute", async () => {
      // increase
      mockFetchJson.mockResolvedValueOnce({
        positionPubkey: "pos1",
        quote: { sizeUsdDelta: "20", leverage: "2", averagePriceUsd: "150", liquidationPriceUsd: "10", openFeeUsd: "0.01" },
        serializedTxBase64: "unsigned-tx",
        txMetadata: { blockhash: "bh", lastValidBlockHeight: "100" },
      });
      // execute
      mockFetchJson.mockResolvedValueOnce({ action: "increase-position", txid: "sig1" });

      const result = await openPerpsPosition(testKeypair.secretKey, {
        asset: "SOL",
        side: "long",
        amountUsd: 10,
        inputToken: "USDC",
        leverage: 2,
      });

      expect(result.type).toBe("market-order");
      expect(result.positionPubkey).toBe("pos1");
      expect(result.signature).toBe("sig1");

      // Verify increase call
      const increaseBody = JSON.parse(mockFetchJson.mock.calls[0][1].body);
      expect(increaseBody.side).toBe("long");
      expect(increaseBody.leverage).toBe("2");
      expect(increaseBody.maxSlippageBps).toBe("200");

      // Verify execute call
      const execBody = JSON.parse(mockFetchJson.mock.calls[1][1].body);
      expect(execBody.action).toBe("increase-position");
      expect(execBody.serializedTxBase64).toBeTruthy();
    });

    it("limit order: calls /orders/limit then execute", async () => {
      mockFetchJson.mockResolvedValueOnce({
        positionPubkey: "pos2",
        quote: { sizeUsdDelta: "20", leverage: "2", liquidationPriceUsd: "5" },
        serializedTxBase64: "unsigned-tx",
        txMetadata: {},
      });
      mockFetchJson.mockResolvedValueOnce({ action: "create-limit-order", txid: "sig2" });

      const result = await openPerpsPosition(testKeypair.secretKey, {
        asset: "BTC",
        side: "long",
        amountUsd: 10,
        leverage: 2,
        limitPrice: 65000,
      });

      expect(result.type).toBe("limit-order");
      expect(result.signature).toBe("sig2");

      const createUrl = mockFetchJson.mock.calls[0][0] as string;
      expect(createUrl).toContain("/orders/limit");
    });

    it("throws when combining --limit with --tp", async () => {
      await expect(openPerpsPosition(testKeypair.secretKey, {
        asset: "SOL",
        side: "long",
        amountUsd: 10,
        limitPrice: 100,
        tp: 120,
      })).rejects.toMatchObject({ code: ErrorCodes.SOLANA_ORDER_FAILED });
    });

    it("market order with TP/SL passes tpsl array", async () => {
      mockFetchJson.mockResolvedValueOnce({
        positionPubkey: "pos3",
        quote: {},
        serializedTxBase64: "tx",
        txMetadata: {},
      });
      mockFetchJson.mockResolvedValueOnce({ action: "increase-position", txid: "sig3" });

      await openPerpsPosition(testKeypair.secretKey, {
        asset: "ETH",
        side: "short",
        amountUsd: 10,
        tp: 3000,
        sl: 4000,
      });

      const body = JSON.parse(mockFetchJson.mock.calls[0][1].body);
      expect(body.tpsl).toHaveLength(2);
      expect(body.tpsl[0].requestType).toBe("tp");
      expect(body.tpsl[0].triggerPrice).toBe("3000");
      expect(body.tpsl[1].requestType).toBe("sl");
      expect(body.tpsl[1].triggerPrice).toBe("4000");
    });

    it("normalizes buy/sell to long/short", async () => {
      mockFetchJson.mockResolvedValueOnce({ positionPubkey: "p", quote: {}, serializedTxBase64: "tx", txMetadata: {} });
      mockFetchJson.mockResolvedValueOnce({ action: "a", txid: "s" });

      await openPerpsPosition(testKeypair.secretKey, { asset: "SOL", side: "buy", amountUsd: 10 });

      const body = JSON.parse(mockFetchJson.mock.calls[0][1].body);
      expect(body.side).toBe("long");
    });

    it("throws for invalid side", async () => {
      await expect(openPerpsPosition(testKeypair.secretKey, {
        asset: "SOL",
        side: "invalid",
        amountUsd: 10,
      })).rejects.toMatchObject({ code: ErrorCodes.SOLANA_ORDER_FAILED });
    });
  });

  // --- Close position ---

  describe("closePerpsPosition", () => {
    it("full close: sets entirePosition=true", async () => {
      mockFetchJson.mockResolvedValueOnce({
        positionPubkey: "pos1",
        quote: { pnlAfterFeesUsd: "5" },
        serializedTxBase64: "tx",
        txMetadata: {},
      });
      mockFetchJson.mockResolvedValueOnce({ action: "close-position", txid: "sig" });

      const result = await closePerpsPosition(testKeypair.secretKey, { positionPubkey: "pos1" });

      expect(result.signature).toBe("sig");
      const body = JSON.parse(mockFetchJson.mock.calls[0][1].body);
      expect(body.entirePosition).toBe(true);
      expect(body.sizeUsdDelta).toBeUndefined();
    });

    it("partial close: sets sizeUsdDelta", async () => {
      mockFetchJson.mockResolvedValueOnce({ positionPubkey: "pos1", quote: {}, serializedTxBase64: "tx", txMetadata: {} });
      mockFetchJson.mockResolvedValueOnce({ action: "decrease-position", txid: "sig" });

      await closePerpsPosition(testKeypair.secretKey, { positionPubkey: "pos1", sizeUsd: 5 });

      const body = JSON.parse(mockFetchJson.mock.calls[0][1].body);
      expect(body.entirePosition).toBe(false);
      expect(body.sizeUsdDelta).toBe("5");
    });
  });

  // --- Close all ---

  describe("closeAllPerpsPositions", () => {
    it("signs and executes each tx sequentially", async () => {
      mockFetchJson.mockResolvedValueOnce({
        serializedTxs: [
          { serializedTxBase64: "tx1", positionRequestPubkey: "pr1" },
          { serializedTxBase64: "tx2", positionRequestPubkey: "pr2" },
        ],
        txMetadata: {},
      });
      mockFetchJson.mockResolvedValueOnce({ action: "close-position", txid: "sig1" });
      mockFetchJson.mockResolvedValueOnce({ action: "close-position", txid: "sig2" });

      const sigs = await closeAllPerpsPositions(testKeypair.secretKey);

      expect(sigs).toEqual(["sig1", "sig2"]);
      expect(mockFetchJson).toHaveBeenCalledTimes(3); // close-all + 2 executes
    });
  });

  // --- Limit order management ---

  describe("updatePerpsLimitOrder", () => {
    it("PATCHes limit order then executes", async () => {
      mockFetchJson.mockResolvedValueOnce({ serializedTxBase64: "tx", txMetadata: {} });
      mockFetchJson.mockResolvedValueOnce({ action: "update-limit-order", txid: "sig" });

      const sig = await updatePerpsLimitOrder(testKeypair.secretKey, "ord1", 64000);

      expect(sig).toBe("sig");
    });

    it("throws when no tx returned", async () => {
      mockFetchJson.mockResolvedValueOnce({ serializedTxBase64: null, txMetadata: null });

      await expect(updatePerpsLimitOrder(testKeypair.secretKey, "ord1", 64000))
        .rejects.toMatchObject({ code: ErrorCodes.SOLANA_ORDER_FAILED });
    });
  });

  describe("cancelPerpsLimitOrder", () => {
    it("DELETEs then executes", async () => {
      mockFetchJson.mockResolvedValueOnce({ serializedTxBase64: "tx", txMetadata: {} });
      mockFetchJson.mockResolvedValueOnce({ action: "cancel-limit-order", txid: "sig" });

      const sig = await cancelPerpsLimitOrder(testKeypair.secretKey, "ord1");
      expect(sig).toBe("sig");
    });
  });

  // --- TP/SL ---

  describe("setPerpsTPSL", () => {
    it("sets TP and SL", async () => {
      mockFetchJson.mockResolvedValueOnce({ serializedTxBase64: "tx", tpslRequests: [], txMetadata: {} });
      mockFetchJson.mockResolvedValueOnce({ action: "set-tpsl", txid: "sig" });

      const result = await setPerpsTPSL(testKeypair.secretKey, "pos1", { tp: 100, sl: 70 });

      expect(result.signatures).toHaveLength(1);
      const body = JSON.parse(mockFetchJson.mock.calls[0][1].body);
      expect(body.tpsl).toHaveLength(2);
      expect(body.positionPubkey).toBe("pos1");
    });

    it("throws when neither tp nor sl provided", async () => {
      await expect(setPerpsTPSL(testKeypair.secretKey, "pos1", {}))
        .rejects.toMatchObject({ code: ErrorCodes.SOLANA_ORDER_FAILED });
    });
  });

  describe("cancelPerpsTPSL", () => {
    it("DELETEs then executes", async () => {
      mockFetchJson.mockResolvedValueOnce({ serializedTxBase64: "tx", txMetadata: {} });
      mockFetchJson.mockResolvedValueOnce({ action: "cancel-tpsl", txid: "sig" });

      const sig = await cancelPerpsTPSL(testKeypair.secretKey, "tpsl1");
      expect(sig).toBe("sig");
    });
  });
});
