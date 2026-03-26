import { describe, expect, it, vi, beforeEach } from "vitest";

const mockFetchJson = vi.fn();
vi.mock("../utils/http.js", () => ({
  fetchJson: (...args: unknown[]) => mockFetchJson(...args),
}));
vi.mock("../config/store.js", () => ({
  loadConfig: () => ({ solana: { jupiterApiKey: "", explorerUrl: "https://explorer.solana.com", cluster: "mainnet-beta" } }),
}));

const mockResolveToken = vi.fn();
vi.mock("../tools/chains/solana/token-registry.js", () => ({
  resolveToken: (...args: unknown[]) => mockResolveToken(...args),
}));

const mockSignAndSend = vi.fn(() => "tx-signature");
vi.mock("../tools/chains/solana/tx.js", () => ({
  signAndSendVersionedTx: (...args: unknown[]) => mockSignAndSend(...args),
}));

const { craftSend, craftClawback, getPendingInvites } = await import("../tools/chains/solana/send-service.js");
const { ErrorCodes } = await import("../errors.js");
const { Keypair } = await import("@solana/web3.js");

const testKeypair = Keypair.generate();

describe("send service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveToken.mockReturnValue(undefined);
  });

  describe("craftSend", () => {
    it("converts UI SOL amount to atomic units (1 SOL = 1000000000)", async () => {
      mockFetchJson.mockResolvedValueOnce({ tx: "base64-tx-data" });

      await craftSend(testKeypair.secretKey, 1);

      const body = JSON.parse(mockFetchJson.mock.calls[0][1].body);
      expect(body.amount).toBe("1000000000"); // 1 SOL = 10^9 lamports
    });

    it("converts UI amount with custom mint decimals", async () => {
      mockResolveToken.mockResolvedValueOnce({ decimals: 6 });
      mockFetchJson.mockResolvedValueOnce({ tx: "base64-tx-data" });

      await craftSend(testKeypair.secretKey, 5, "USDC_MINT");

      const body = JSON.parse(mockFetchJson.mock.calls[0][1].body);
      expect(body.amount).toBe("5000000"); // 5 USDC = 5 * 10^6
      expect(body.mint).toBe("USDC_MINT");
    });

    it("handles { tx } response field", async () => {
      mockFetchJson.mockResolvedValueOnce({ tx: "tx-from-tx-field" });

      await craftSend(testKeypair.secretKey, 0.1);

      expect(mockSignAndSend).toHaveBeenCalledWith("tx-from-tx-field", expect.any(Array));
    });

    it("handles { transaction } response field as fallback", async () => {
      mockFetchJson.mockResolvedValueOnce({ transaction: "tx-from-transaction-field" });

      await craftSend(testKeypair.secretKey, 0.1);

      expect(mockSignAndSend).toHaveBeenCalledWith("tx-from-transaction-field", expect.any(Array));
    });

    it("throws SOLANA_SEND_INVITE_FAILED when neither tx nor transaction present", async () => {
      mockFetchJson.mockResolvedValueOnce({});

      await expect(craftSend(testKeypair.secretKey, 0.1))
        .rejects.toMatchObject({ code: ErrorCodes.SOLANA_SEND_INVITE_FAILED });
    });

    it("signs with both wallet and invite keypairs (2 signers)", async () => {
      mockFetchJson.mockResolvedValueOnce({ tx: "data" });

      await craftSend(testKeypair.secretKey, 0.1);

      const signers = mockSignAndSend.mock.calls[0][1];
      expect(signers).toHaveLength(2);
    });

    it("calls /send/v1/craft-send with POST", async () => {
      mockFetchJson.mockResolvedValueOnce({ tx: "data" });

      await craftSend(testKeypair.secretKey, 0.1);

      const [url, opts] = mockFetchJson.mock.calls[0];
      expect(url).toContain("/send/v1/craft-send");
      expect(opts.method).toBe("POST");
    });
  });

  describe("craftClawback", () => {
    it("handles { tx } response field", async () => {
      mockFetchJson.mockResolvedValueOnce({ tx: "clawback-tx" });

      await craftClawback(testKeypair.secretKey, "INVITE_CODE_12");

      expect(mockSignAndSend).toHaveBeenCalledWith("clawback-tx", expect.any(Array));
    });

    it("handles { transaction } fallback", async () => {
      mockFetchJson.mockResolvedValueOnce({ transaction: "clawback-tx2" });

      await craftClawback(testKeypair.secretKey, "INVITE_CODE_12");

      expect(mockSignAndSend).toHaveBeenCalledWith("clawback-tx2", expect.any(Array));
    });

    it("throws SOLANA_SEND_CLAWBACK_FAILED when no tx", async () => {
      mockFetchJson.mockResolvedValueOnce({});

      await expect(craftClawback(testKeypair.secretKey, "CODE"))
        .rejects.toMatchObject({ code: ErrorCodes.SOLANA_SEND_CLAWBACK_FAILED });
    });

    it("calls /send/v1/craft-clawback with invitePDA and sender", async () => {
      mockFetchJson.mockResolvedValueOnce({ tx: "data" });

      await craftClawback(testKeypair.secretKey, "INVITE_CODE_12");

      const [url, opts] = mockFetchJson.mock.calls[0];
      expect(url).toContain("/send/v1/craft-clawback");
      const body = JSON.parse(opts.body);
      expect(body.invitePDA).toBeTruthy();
      expect(body.sender).toBe(testKeypair.publicKey.toBase58());
    });
  });

  describe("getPendingInvites", () => {
    it("unwraps { invites: [...] }", async () => {
      mockFetchJson.mockResolvedValueOnce({
        invites: [{ invitePDA: "pda1", amount: "1000", mint: "SOL", createdAt: "2026-03-14" }],
        hasMoreData: false,
      });

      const invites = await getPendingInvites("wallet1");
      expect(invites).toHaveLength(1);
      expect(invites[0].invitePDA).toBe("pda1");
    });

    it("returns [] on error", async () => {
      mockFetchJson.mockRejectedValueOnce(new Error("network"));
      expect(await getPendingInvites("wallet1")).toEqual([]);
    });

    it("returns [] when invites is null", async () => {
      mockFetchJson.mockResolvedValueOnce({ invites: null });
      expect(await getPendingInvites("wallet1")).toEqual([]);
    });
  });
});
