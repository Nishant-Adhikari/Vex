import { beforeEach, describe, expect, it, vi } from "vitest";

function callMock<T>(mock: unknown, args: unknown[]): T {
  return (mock as (...innerArgs: unknown[]) => T)(...args);
}

const mockRequireResolvedToken = vi.fn();
vi.mock("@tools/solana-ecosystem/jupiter/jupiter-tokens/service.js", () => ({
  requireJupiterResolvedToken: (...args: unknown[]) => callMock(mockRequireResolvedToken, args),
}));

const mockSwapOrder = vi.fn();
const mockSwapBuild = vi.fn();
const mockSwapExecute = vi.fn();
vi.mock("@tools/solana-ecosystem/jupiter/jupiter-swaps/client.js", () => ({
  jupiterSwapOrder: (...args: unknown[]) => callMock(mockSwapOrder, args),
  jupiterSwapBuild: (...args: unknown[]) => callMock(mockSwapBuild, args),
  jupiterSwapExecute: (...args: unknown[]) => callMock(mockSwapExecute, args),
}));

const mockDeserialize = vi.fn(() => ({ serialize: () => new Uint8Array([1, 2, 3]) }));
const mockSign = vi.fn();
vi.mock("@tools/solana-ecosystem/shared/solana-transaction.js", () => ({
  deserializeVersionedTx: (...args: unknown[]) => callMock(mockDeserialize, args),
  signVersionedTx: (...args: unknown[]) => callMock(mockSign, args),
}));

vi.mock("@config/store.js", () => ({
  loadConfig: () => ({
    solana: { explorerUrl: "https://explorer.solana.com", cluster: "mainnet-beta" },
  }),
}));

const {
  getJupiterSwapQuote,
  buildSwapTransaction,
  executeJupiterSwap,
} = await import("@tools/solana-ecosystem/jupiter/jupiter-swaps/service.js");
const { ErrorCodes } = await import("../../../../errors.js");
const { Keypair } = await import("@solana/web3.js");

const SOL_TOKEN = {
  chain: "solana" as const,
  address: "So11111111111111111111111111111111111111112",
  symbol: "SOL",
  name: "Solana",
  decimals: 9,
};

const USDC_TOKEN = {
  chain: "solana" as const,
  address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  symbol: "USDC",
  name: "USD Coin",
  decimals: 6,
};

describe("jupiter swap v2 service", () => {
  const signer = Keypair.generate();

  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireResolvedToken.mockImplementation((symbol: string) => {
      if (symbol === "SOL") return SOL_TOKEN;
      if (symbol === "USDC") return USDC_TOKEN;
      return undefined;
    });
  });

  it("returns a normalized quote summary while preserving the raw /order response", async () => {
    mockSwapOrder.mockResolvedValueOnce({
      mode: "ultra",
      inputMint: SOL_TOKEN.address,
      outputMint: USDC_TOKEN.address,
      inAmount: "1000000000",
      outAmount: "150000000",
      priceImpact: -0.001,
      otherAmountThreshold: "149000000",
      slippageBps: 50,
      routePlan: [{ swapInfo: { label: "Raydium", ammKey: "amm-1", inputMint: SOL_TOKEN.address, outputMint: USDC_TOKEN.address, inAmount: "1000000000", outAmount: "150000000" }, percent: 100, bps: 10000 }],
      feeBps: 2,
      feeMint: USDC_TOKEN.address,
      platformFee: { amount: "3000", feeBps: 2, feeMint: USDC_TOKEN.address },
      transaction: null,
      gasless: false,
      requestId: "req-1",
      router: "iris",
    });

    const { quote, raw } = await getJupiterSwapQuote("SOL", "USDC", 1, { slippageBps: 50 });

    expect(mockSwapOrder).toHaveBeenCalledWith({
      inputMint: SOL_TOKEN.address,
      outputMint: USDC_TOKEN.address,
      amount: "1000000000",
      slippageBps: 50,
    });
    expect(quote.inputAmount).toBe("1");
    expect(quote.outputAmount).toBe("150");
    expect(quote.priceImpactPct).toBe("-0.1");
    expect(quote.route).toEqual(["Raydium"]);
    expect(quote.provider).toBe("jupiter-swap-v2 (iris)");
    expect(raw.requestId).toBe("req-1");
  });

  it("returns a normalized build summary with instruction counters", async () => {
    mockSwapBuild.mockResolvedValueOnce({
      inputMint: SOL_TOKEN.address,
      outputMint: USDC_TOKEN.address,
      inAmount: "1000000000",
      outAmount: "150000000",
      otherAmountThreshold: "149000000",
      slippageBps: 50,
      routePlan: [{ swapInfo: { label: "Raydium", ammKey: "amm-1", inputMint: SOL_TOKEN.address, outputMint: USDC_TOKEN.address, inAmount: "1000000000", outAmount: "150000000" }, percent: 100, bps: 10000 }],
      computeBudgetInstructions: [{ programId: "compute", accounts: [], data: "1" }],
      setupInstructions: [{ programId: "setup", accounts: [], data: "2" }],
      swapInstruction: { programId: "swap", accounts: [], data: "3" },
      cleanupInstruction: { programId: "cleanup", accounts: [], data: "4" },
      otherInstructions: [{ programId: "memo", accounts: [], data: "5" }],
      addressesByLookupTableAddress: { lookup: ["a", "b"] },
      blockhashWithMetadata: { blockhash: [1, 2, 3], lastValidBlockHeight: 123 },
    });

    const { build } = await buildSwapTransaction("SOL", "USDC", 1, {
      taker: signer.publicKey.toBase58(),
      mode: "fast",
    });

    expect(mockSwapBuild).toHaveBeenCalledWith({
      inputMint: SOL_TOKEN.address,
      outputMint: USDC_TOKEN.address,
      amount: "1000000000",
      taker: signer.publicKey.toBase58(),
      mode: "fast",
    });
    expect(build.computeBudgetInstructionCount).toBe(1);
    expect(build.setupInstructionCount).toBe(1);
    expect(build.otherInstructionCount).toBe(1);
    expect(build.hasCleanupInstruction).toBe(true);
    expect(build.lookupTableCount).toBe(1);
  });

  it("executes /order + sign + /execute and returns the combined result", async () => {
    mockSwapOrder.mockResolvedValueOnce({
      mode: "ultra",
      inputMint: SOL_TOKEN.address,
      outputMint: USDC_TOKEN.address,
      inAmount: "1000000000",
      outAmount: "150000000",
      otherAmountThreshold: "149000000",
      routePlan: [],
      transaction: "unsigned-base64",
      gasless: true,
      requestId: "req-2",
      router: "jupiterz",
      feeBps: 5,
      feeMint: USDC_TOKEN.address,
      platformFee: { amount: "7500", feeBps: 5, feeMint: USDC_TOKEN.address },
      lastValidBlockHeight: "999",
    });
    mockSwapExecute.mockResolvedValueOnce({
      status: "Success",
      signature: "swap-sig-123",
      code: 0,
      inputAmountResult: "1000000000",
      outputAmountResult: "150250000",
    });

    const result = await executeJupiterSwap("SOL", "USDC", 1, signer.secretKey);

    expect(mockSwapOrder.mock.calls[0][0].taker).toBe(signer.publicKey.toBase58());
    expect(mockDeserialize).toHaveBeenCalledWith("unsigned-base64");
    expect(mockSign).toHaveBeenCalledTimes(1);
    expect(mockSwapExecute).toHaveBeenCalledWith({
      signedTransaction: Buffer.from(new Uint8Array([1, 2, 3])).toString("base64"),
      requestId: "req-2",
      lastValidBlockHeight: "999",
    });
    expect(result.signature).toBe("swap-sig-123");
    expect(result.outputAmount).toBe("150.25");
    expect(result.router).toBe("jupiterz");
    expect(result.order.requestId).toBe("req-2");
    expect(result.execute.status).toBe("Success");
  });

  it("rejects execute when taker does not match the signer", async () => {
    await expect(
      executeJupiterSwap("SOL", "USDC", 1, signer.secretKey, {
        taker: Keypair.generate().publicKey.toBase58(),
      }),
    ).rejects.toMatchObject({ code: ErrorCodes.SIGNER_MISMATCH });

    expect(mockSwapOrder).not.toHaveBeenCalled();
  });

  it("rejects execute when /order returns no executable transaction", async () => {
    mockSwapOrder.mockResolvedValueOnce({
      mode: "manual",
      inputMint: SOL_TOKEN.address,
      outputMint: USDC_TOKEN.address,
      inAmount: "1000000000",
      outAmount: "0",
      otherAmountThreshold: "0",
      routePlan: [],
      transaction: "",
      requestId: "req-3",
      errorCode: -1002,
      errorMessage: "Invalid transaction",
    });

    await expect(
      executeJupiterSwap("SOL", "USDC", 1, signer.secretKey),
    ).rejects.toMatchObject({ code: ErrorCodes.SOLANA_SWAP_FAILED });

    expect(mockSwapExecute).not.toHaveBeenCalled();
  });
});
