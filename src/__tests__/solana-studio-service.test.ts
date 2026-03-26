import { describe, expect, it, vi, beforeEach } from "vitest";

const mockFetchJson = vi.fn();
vi.mock("../utils/http.js", () => ({
  fetchJson: (...args: unknown[]) => mockFetchJson(...args),
  fetchWithTimeout: vi.fn(),
}));

const mockLoadConfig = vi.fn();
vi.mock("../config/store.js", () => ({
  loadConfig: () => mockLoadConfig(),
}));

const { studioGetPoolAddress, studioGetFees, studioCreateToken, studioClaimFees } =
  await import("../tools/chains/solana/studio-service.js");
const { ErrorCodes } = await import("../errors.js");

describe("studio service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadConfig.mockReturnValue({ solana: { jupiterApiKey: "test-key" } });
  });

  // --- studioGetPoolAddress ---

  describe("studioGetPoolAddress", () => {
    it("calls GET /studio/v1/dbc-pool/addresses/{mint}", async () => {
      mockFetchJson.mockResolvedValueOnce({ dbcPoolAddress: "pool-addr-123" });

      const pool = await studioGetPoolAddress("token-mint-1");

      const [url] = mockFetchJson.mock.calls[0];
      expect(url).toContain("/studio/v1/dbc-pool/addresses/token-mint-1");
      expect(pool).toBe("pool-addr-123");
    });

    it("throws SOLANA_LP_POOL_NOT_FOUND when dbcPoolAddress is missing", async () => {
      mockFetchJson.mockResolvedValueOnce({});

      await expect(studioGetPoolAddress("unknown-mint"))
        .rejects.toMatchObject({ code: ErrorCodes.SOLANA_LP_POOL_NOT_FOUND });
    });

    it("throws SOLANA_STUDIO_CLAIM_FAILED when no API key", async () => {
      mockLoadConfig.mockReturnValue({ solana: { jupiterApiKey: "" } });

      await expect(studioGetPoolAddress("mint"))
        .rejects.toMatchObject({ code: ErrorCodes.SOLANA_STUDIO_CLAIM_FAILED });
    });
  });

  // --- studioGetFees ---

  describe("studioGetFees", () => {
    it("resolves mint → poolAddress, then sends { poolAddress } to fee endpoint (CRITICAL FIX)", async () => {
      // First call: resolve pool address
      mockFetchJson.mockResolvedValueOnce({ dbcPoolAddress: "resolved-pool-addr" });
      // Second call: get fees
      mockFetchJson.mockResolvedValueOnce({ totalFees: "100", unclaimedFees: "50", poolAddress: "resolved-pool-addr" });

      const fees = await studioGetFees("some-mint");

      // Verify pool address resolution call
      expect(mockFetchJson.mock.calls[0][0]).toContain("/studio/v1/dbc-pool/addresses/some-mint");

      // Verify fee call sends poolAddress, NOT mint
      const [feeUrl, feeOpts] = mockFetchJson.mock.calls[1];
      expect(feeUrl).toContain("/studio/v1/dbc/fee");
      const body = JSON.parse(feeOpts.body);
      expect(body.poolAddress).toBe("resolved-pool-addr");
      expect(body.mint).toBeUndefined(); // must NOT send mint
      expect(fees.unclaimedFees).toBe("50");
    });
  });

  // --- studioCreateToken ---

  describe("studioCreateToken", () => {
    it("throws SOLANA_STUDIO_CREATE_FAILED when no API key", async () => {
      mockLoadConfig.mockReturnValue({ solana: { jupiterApiKey: "" } });

      await expect(
        studioCreateToken(new Uint8Array(64), {
          tokenName: "Test",
          tokenSymbol: "TST",
          imagePath: "/nonexistent.png",
          initialMarketCap: 16000,
          migrationMarketCap: 69000,
        }),
      ).rejects.toMatchObject({ code: ErrorCodes.SOLANA_STUDIO_CREATE_FAILED });
    });
  });

  // --- studioClaimFees ---

  describe("studioClaimFees", () => {
    it("throws SOLANA_STUDIO_CLAIM_FAILED when no API key", async () => {
      mockLoadConfig.mockReturnValue({ solana: { jupiterApiKey: "" } });

      await expect(studioClaimFees(new Uint8Array(64), "pool-addr"))
        .rejects.toMatchObject({ code: ErrorCodes.SOLANA_STUDIO_CLAIM_FAILED });
    });
  });
});
