import { describe, expect, it, vi, beforeEach } from "vitest";

const mockResolveToken = vi.fn();
vi.mock("../tools/chains/solana/token-registry.js", () => ({
  resolveToken: (...args: unknown[]) => mockResolveToken(...args),
}));

const mockUltraOrder = vi.fn();
const mockUltraExecute = vi.fn();
vi.mock("../tools/chains/solana/jupiter-client.js", () => ({
  jupiterUltraOrder: (...args: unknown[]) => mockUltraOrder(...args),
  jupiterUltraExecute: (...args: unknown[]) => mockUltraExecute(...args),
}));

vi.mock("../tools/chains/solana/tx.js", () => ({
  deserializeVersionedTx: vi.fn(() => ({ serialize: () => new Uint8Array([1, 2, 3]) })),
  signVersionedTx: vi.fn(),
}));

vi.mock("../config/store.js", () => ({
  loadConfig: () => ({ solana: { explorerUrl: "https://explorer.solana.com", cluster: "mainnet-beta" } }),
}));

const { getSwapQuote, executeSwap } = await import("../tools/chains/solana/swap-service.js");
const { ErrorCodes } = await import("../errors.js");
const { Keypair } = await import("@solana/web3.js");

const SOL_TOKEN = { chain: "solana" as const, address: "So11111111111111111111111111111111111111112", symbol: "SOL", name: "Solana", decimals: 9 };
const USDC_TOKEN = { chain: "solana" as const, address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", symbol: "USDC", name: "USD Coin", decimals: 6 };
const testKeypair = Keypair.generate();

describe("swap service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveToken.mockImplementation((sym: string) => {
      if (sym === "SOL") return SOL_TOKEN;
      if (sym === "USDC") return USDC_TOKEN;
      return undefined;
    });
  });

  describe("getSwapQuote", () => {
    it("calls jupiterUltraOrder without taker for quote-only", async () => {
      mockUltraOrder.mockResolvedValueOnce({
        requestId: "r1",
        inputMint: SOL_TOKEN.address,
        outputMint: USDC_TOKEN.address,
        inAmount: "1000000000",
        outAmount: "150000000",
        otherAmountThreshold: "149000000",
        swapMode: "ExactIn",
        slippageBps: 50,
        priceImpactPct: "0.01",
        routePlan: [{ swapInfo: { label: "Raydium", ammKey: "amm1" }, percent: 100 }],
        transaction: null,
        gasless: false,
        router: "iris",
      });

      const { quote } = await getSwapQuote("SOL", "USDC", 1);

      expect(mockUltraOrder).toHaveBeenCalledWith({
        inputMint: SOL_TOKEN.address,
        outputMint: USDC_TOKEN.address,
        amount: "1000000000", // 1 SOL = 10^9 lamports
        slippageBps: undefined,
      });
      expect(quote.inputAmount).toBe("1");
      expect(quote.outputAmount).toBe("150");
      expect(quote.route).toEqual(["Raydium"]);
      expect(quote.provider).toContain("iris");
    });

    it("passes slippageBps when provided", async () => {
      mockUltraOrder.mockResolvedValueOnce({
        requestId: "r", inAmount: "1", outAmount: "1", otherAmountThreshold: "1",
        swapMode: "ExactIn", slippageBps: 100, priceImpactPct: "0", routePlan: [],
        transaction: null, gasless: false, router: "iris",
        inputMint: "a", outputMint: "b",
      });

      await getSwapQuote("SOL", "USDC", 1, { slippageBps: 100 });

      expect(mockUltraOrder.mock.calls[0][0].slippageBps).toBe(100);
    });

    it("throws SOLANA_TOKEN_NOT_FOUND for unknown input token", async () => {
      mockResolveToken.mockReturnValue(undefined);

      await expect(getSwapQuote("UNKNOWN", "USDC", 1))
        .rejects.toMatchObject({ code: ErrorCodes.SOLANA_TOKEN_NOT_FOUND });
    });

    it("throws SOLANA_QUOTE_FAILED when API returns errorCode", async () => {
      mockUltraOrder.mockResolvedValueOnce({
        errorCode: -1,
        errorMessage: "No route found",
        requestId: "r", inAmount: "0", outAmount: "0", otherAmountThreshold: "0",
        swapMode: "ExactIn", slippageBps: 50, priceImpactPct: "0", routePlan: [],
        transaction: null, gasless: false, router: "iris",
        inputMint: "a", outputMint: "b",
      });

      await expect(getSwapQuote("SOL", "USDC", 1))
        .rejects.toMatchObject({ code: ErrorCodes.SOLANA_QUOTE_FAILED });
    });
  });

  describe("executeSwap", () => {
    it("calls jupiterUltraOrder WITH taker, then signs and executes", async () => {
      mockUltraOrder.mockResolvedValueOnce({
        requestId: "r1",
        inputMint: SOL_TOKEN.address,
        outputMint: USDC_TOKEN.address,
        inAmount: "1000000000",
        outAmount: "150000000",
        otherAmountThreshold: "149000000",
        swapMode: "ExactIn",
        slippageBps: 50,
        priceImpactPct: "0.01",
        routePlan: [],
        transaction: "base64-tx-data",
        gasless: false,
        router: "iris",
      });
      mockUltraExecute.mockResolvedValueOnce({
        status: "Success",
        signature: "swap-sig-123",
        slot: "100",
        code: 0,
        inputAmountResult: "1000000000",
        outputAmountResult: "150250000",
      });

      const result = await executeSwap("SOL", "USDC", 1, testKeypair.secretKey);

      // Verify taker was set
      expect(mockUltraOrder.mock.calls[0][0].taker).toBe(testKeypair.publicKey.toBase58());
      expect(result.signature).toBe("swap-sig-123");
      expect(result.outputAmount).toBe("150.25");
    });

    it("throws SOLANA_SWAP_FAILED when execute returns Failed", async () => {
      mockUltraOrder.mockResolvedValueOnce({
        requestId: "r", transaction: "tx", inAmount: "1", outAmount: "1",
        otherAmountThreshold: "1", swapMode: "ExactIn", slippageBps: 50,
        priceImpactPct: "0", routePlan: [], gasless: false, router: "iris",
        inputMint: "a", outputMint: "b",
      });
      mockUltraExecute.mockResolvedValueOnce({
        status: "Failed", signature: "", slot: "", code: -1000,
        inputAmountResult: "", outputAmountResult: "", error: "landing failed",
      });

      await expect(executeSwap("SOL", "USDC", 1, testKeypair.secretKey))
        .rejects.toMatchObject({ code: ErrorCodes.SOLANA_SWAP_FAILED });
    });

    it("throws SOLANA_SWAP_FAILED when no transaction in order response", async () => {
      mockUltraOrder.mockResolvedValueOnce({
        requestId: "r", transaction: null, inAmount: "1", outAmount: "1",
        otherAmountThreshold: "1", swapMode: "ExactIn", slippageBps: 50,
        priceImpactPct: "0", routePlan: [], gasless: false, router: "iris",
        inputMint: "a", outputMint: "b",
      });

      await expect(executeSwap("SOL", "USDC", 1, testKeypair.secretKey))
        .rejects.toMatchObject({ code: ErrorCodes.SOLANA_SWAP_FAILED });
    });
  });
});
