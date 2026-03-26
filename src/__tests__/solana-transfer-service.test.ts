import { describe, expect, it, vi, beforeEach } from "vitest";
import { Keypair } from "@solana/web3.js";

const mockGetBalance = vi.fn();
const mockGetTokenAccountsByOwner = vi.fn();
const mockGetOrCreateAta = vi.fn();
const mockGetAssociatedTokenAddress = vi.fn();
const mockGetAccount = vi.fn();
const mockGetMint = vi.fn();

vi.mock("../tools/chains/solana/connection.js", () => ({
  getSolanaConnection: () => ({
    getBalance: mockGetBalance,
    getTokenAccountsByOwner: mockGetTokenAccountsByOwner,
  }),
}));

vi.mock("@solana/spl-token", () => ({
  getOrCreateAssociatedTokenAccount: (...args: unknown[]) => mockGetOrCreateAta(...args),
  getAssociatedTokenAddress: (...args: unknown[]) => mockGetAssociatedTokenAddress(...args),
  getAccount: (...args: unknown[]) => mockGetAccount(...args),
  createTransferCheckedInstruction: vi.fn(() => ({ programId: "token", keys: [], data: Buffer.alloc(0) })),
  getMint: (...args: unknown[]) => mockGetMint(...args),
}));

const mockSignAndSendLegacy = vi.fn(() => "transfer-sig");
vi.mock("../tools/chains/solana/tx.js", () => ({
  signAndSendLegacyTx: (...args: unknown[]) => mockSignAndSendLegacy(...args),
}));

vi.mock("../config/store.js", () => ({
  loadConfig: () => ({ solana: { explorerUrl: "https://explorer.solana.com", cluster: "mainnet-beta" } }),
}));

const { sendSol } = await import("../tools/chains/solana/transfer-service.js");
const { ErrorCodes } = await import("../errors.js");

const testKeypair = Keypair.generate();

describe("transfer service", () => {
  beforeEach(() => vi.clearAllMocks());

  describe("sendSol", () => {
    it("sends SOL and returns signature + explorer URL", async () => {
      mockGetBalance.mockResolvedValueOnce(5_000_000_000); // 5 SOL

      const result = await sendSol({
        from: testKeypair,
        to: "11111111111111111111111111111111",
        lamports: BigInt(1_000_000_000),
      });

      expect(result.signature).toBe("transfer-sig");
      expect(result.explorerUrl).toContain("explorer.solana.com/tx/transfer-sig");
      expect(mockSignAndSendLegacy).toHaveBeenCalled();
    });

    it("throws SOLANA_INSUFFICIENT_BALANCE when balance too low", async () => {
      mockGetBalance.mockResolvedValueOnce(100_000); // 0.0001 SOL

      await expect(sendSol({
        from: testKeypair,
        to: "11111111111111111111111111111111",
        lamports: BigInt(1_000_000_000),
      })).rejects.toMatchObject({ code: ErrorCodes.SOLANA_INSUFFICIENT_BALANCE });
    });
  });
});
