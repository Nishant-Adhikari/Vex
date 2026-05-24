import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProtocolExecutionContext } from "../../../vex-agent/tools/protocols/types.js";
import { SOL_MINT } from "@tools/solana-ecosystem/shared/solana-constants.js";

const mockExecuteJupiterSwap = vi.fn();
const mockLendDeposit = vi.fn();
const mockLendPositions = vi.fn();

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

vi.mock("@tools/solana-ecosystem/jupiter/jupiter-lend/earn-api/service.js", () => ({
  getJupiterLendEarnTokens: vi.fn(),
  getJupiterLendEarnPositions: (...args: unknown[]) => mockLendPositions(...args),
  getJupiterLendEarnEarnings: vi.fn(),
  executeJupiterLendEarnDeposit: (...args: unknown[]) => mockLendDeposit(...args),
  executeJupiterLendEarnWithdraw: vi.fn(),
}));

// 5D-protocols p2: jupiter handlers resolve the session wallet via resolve.js
// (not the zero-arg requireSolanaWallet primary). `SignerWallet` is the session
// "selected" Solana address for these tests.
vi.mock("@vex-agent/tools/internal/wallet/resolve.js", () => ({
  resolveSelectedAddress: () => "SignerWallet",
  resolveSigningWallet: () => ({ family: "solana", address: "SignerWallet", secretKey: new Uint8Array([1, 2, 3]) }),
  walletScopeErrorToResult: (err: unknown) => ({ success: false, output: err instanceof Error ? err.message : String(err) }),
}));

// Deterministic address comparison for the mismatch path (avoids base58 deps).
vi.mock("@tools/wallet/inventory.js", () => ({
  walletAddressesEqual: (_family: string, a: string, b: string) => a === b,
}));

const { CORE_HANDLERS } = await import(
  "../../../vex-agent/tools/protocols/solana-jupiter/handlers/core.js"
);
const { LEND_HANDLERS } = await import(
  "../../../vex-agent/tools/protocols/solana-jupiter/handlers/lend.js"
);

const DEFAULT_CTX: ProtocolExecutionContext = {
  approved: true,
  sessionPermission: "restricted",
  walletResolution: { source: "default" },
  walletPolicy: { kind: "none" },
};
const SESSION_CTX: ProtocolExecutionContext = {
  approved: true,
  sessionPermission: "full",
  walletResolution: { source: "session", evm: null, solana: { id: "w-sol-1", address: "SignerWallet" } },
  walletPolicy: { kind: "none" },
};

beforeEach(() => {
  vi.clearAllMocks();
  mockLendPositions.mockResolvedValue([]);
});

describe("solana.swap.execute capture", () => {
  it("marks output-value-only swaps as exact and records the SESSION signer wallet", async () => {
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
      SESSION_CTX,
    );

    expect(result.success).toBe(true);
    // Signer secret comes from resolveSigningWallet, NOT a spoofed param.
    expect(mockExecuteJupiterSwap.mock.calls[0][3]).toEqual(new Uint8Array([1, 2, 3]));
    expect(result.data?._tradeCapture).toMatchObject({
      walletAddress: "SignerWallet",
      tradeSide: "sell",
      outputValueUsd: "12.5",
      valuationSource: "jupiter_exact",
    });
  });
});

// ── Per-session wallet scope (5D-protocols p2) ───────────────────

describe("jupiter session wallet scope", () => {
  it("lend.deposit fails closed when explicit address != session wallet (NO broadcast)", async () => {
    const result = await LEND_HANDLERS["solana.lend.deposit"]!(
      { asset: "USDC", amount: "100", address: "DifferentWallet" },
      SESSION_CTX,
    );

    expect(result.success).toBe(false);
    // The mismatch must be caught BEFORE the on-chain deposit — execute not called,
    // and no capture/audit produced. This is the exact bug guarded against.
    expect(mockLendDeposit).not.toHaveBeenCalled();
    expect(result.data).toBeUndefined();
  });

  it("lend.positions scopes the read to the session selected wallet", async () => {
    await LEND_HANDLERS["solana.lend.positions"]!({}, SESSION_CTX);
    expect(mockLendPositions).toHaveBeenCalledWith("SignerWallet");
  });

  it("lend.positions under source:default preserves the explicit-address override", async () => {
    await LEND_HANDLERS["solana.lend.positions"]!({ address: "ExplicitWallet" }, DEFAULT_CTX);
    expect(mockLendPositions).toHaveBeenCalledWith("ExplicitWallet");
  });
});
