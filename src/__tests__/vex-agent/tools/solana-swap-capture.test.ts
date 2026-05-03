import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProtocolExecutionContext } from "../../../vex-agent/tools/protocols/types.js";
import { SOL_MINT } from "@tools/solana-ecosystem/shared/solana-constants.js";

const mockExecuteJupiterSwap = vi.fn();

vi.mock("@tools/solana-ecosystem/jupiter/jupiter-swaps/service.js", () => ({
  getJupiterSwapQuote: vi.fn(),
  executeJupiterSwap: (...args: unknown[]) => mockExecuteJupiterSwap(...args),
}));

vi.mock("@tools/solana-ecosystem/jupiter/jupiter-tokens/service.js", () => ({
  searchJupiterTokens: vi.fn(),
  getJupiterTokensByCategory: vi.fn(),
  getJupiterTokensByTag: vi.fn(),
  getJupiterRecentTokens: vi.fn(),
}));

vi.mock("@tools/solana-ecosystem/jupiter/jupiter-prices/service.js", () => ({
  getJupiterPricesByMint: vi.fn(),
}));

vi.mock("@tools/wallet/multi-auth.js", () => ({
  requireSolanaWallet: () => ({
    address: "SignerWallet",
    secretKey: new Uint8Array([1, 2, 3]),
  }),
}));

const { CORE_HANDLERS } = await import(
  "../../../vex-agent/tools/protocols/solana-jupiter/handlers/core.js"
);

const ctx: ProtocolExecutionContext = {
  approved: true,
  loopMode: "off",
};

describe("solana.swap.execute capture", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("marks output-value-only swaps as exact and records the signer wallet", async () => {
    mockExecuteJupiterSwap.mockResolvedValueOnce({
      inputToken: { address: "BonkMint", symbol: "BONK" },
      outputToken: { address: SOL_MINT, symbol: "SOL" },
      inputAmount: "1000",
      outputAmount: "0.1",
      inputAmountRaw: "1000000000",
      outputAmountRaw: "100000000",
      signature: "sig",
      order: { outUsdValue: 12.5 },
    });

    const result = await CORE_HANDLERS["solana.swap.execute"]!(
      { inputToken: "BonkMint", outputToken: SOL_MINT, amount: 1000, address: "SpoofedWallet" },
      ctx,
    );

    expect(result.success).toBe(true);
    expect(mockExecuteJupiterSwap.mock.calls[0][3]).toEqual(new Uint8Array([1, 2, 3]));
    expect(result.data?._tradeCapture).toMatchObject({
      walletAddress: "SignerWallet",
      tradeSide: "sell",
      outputValueUsd: "12.5",
      valuationSource: "jupiter_exact",
    });
  });
});
