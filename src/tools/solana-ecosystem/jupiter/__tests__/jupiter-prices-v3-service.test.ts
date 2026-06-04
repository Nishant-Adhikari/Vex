import { beforeEach, describe, expect, it, vi } from "vitest";

function callMock<T>(mock: unknown, args: unknown[]): T {
  return (mock as (...innerArgs: unknown[]) => T)(...args);
}

const mockJupiterPrices = vi.fn();
const mockJupiterPricesByMint = vi.fn();
vi.mock("@tools/solana-ecosystem/jupiter/jupiter-prices/client.js", () => ({
  jupiterPrices: (...args: unknown[]) => callMock(mockJupiterPrices, args),
  jupiterPricesByMint: (...args: unknown[]) => callMock(mockJupiterPricesByMint, args),
}));

const mockRequireResolvedToken = vi.fn();
const mockResolveTokens = vi.fn();
vi.mock("@tools/solana-ecosystem/jupiter/jupiter-tokens/service.js", () => ({
  requireJupiterResolvedToken: (...args: unknown[]) => callMock(mockRequireResolvedToken, args),
  resolveJupiterTokens: (...args: unknown[]) => callMock(mockResolveTokens, args),
}));

const {
  getJupiterPrices,
  getJupiterPriceByMint,
  getJupiterPriceForTokenQuery,
  getJupiterPricesForTokenQueries,
} = await import("@tools/solana-ecosystem/jupiter/jupiter-prices/service.js");
const { ErrorCodes } = await import("../../../../errors.js");

const SOL_TOKEN = {
  chain: "solana" as const,
  address: "So11111111111111111111111111111111111111112",
  symbol: "SOL",
  name: "Solana",
  decimals: 9,
};

const WSOL_TOKEN = {
  chain: "solana" as const,
  address: "So11111111111111111111111111111111111111112",
  symbol: "WSOL",
  name: "Wrapped SOL",
  decimals: 9,
};

describe("jupiter prices v3 service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockJupiterPrices.mockReset();
    mockJupiterPricesByMint.mockReset();
    mockRequireResolvedToken.mockReset();
    mockResolveTokens.mockReset();
  });

  it("passes through the raw multi-mint response", async () => {
    const raw = {
      [SOL_TOKEN.address]: {
        createdAt: "2024-06-05T08:55:25.527Z",
        liquidity: 621679197.67,
        usdPrice: 147.48,
        blockId: 348004023,
        decimals: 9,
        priceChange24h: 1.29,
      },
    };
    mockJupiterPrices.mockResolvedValueOnce(raw);

    const result = await getJupiterPrices({ ids: [SOL_TOKEN.address] });

    expect(mockJupiterPrices).toHaveBeenCalledWith({ ids: [SOL_TOKEN.address] });
    expect(result).toBe(raw);
  });

  it("returns found=false when the requested mint is missing from the response", async () => {
    mockJupiterPricesByMint.mockResolvedValueOnce({});

    const result = await getJupiterPriceByMint(SOL_TOKEN.address);

    expect(mockJupiterPricesByMint).toHaveBeenCalledWith([SOL_TOKEN.address]);
    expect(result.found).toBe(false);
    expect(result.price).toBeUndefined();
    expect(result.raw).toEqual({});
  });

  it("resolves a token query before fetching its price", async () => {
    mockRequireResolvedToken.mockResolvedValueOnce(SOL_TOKEN);
    mockJupiterPricesByMint.mockResolvedValueOnce({
      [SOL_TOKEN.address]: {
        createdAt: "2024-06-05T08:55:25.527Z",
        liquidity: 621679197.67,
        usdPrice: 147.48,
        blockId: 348004023,
        decimals: 9,
        priceChange24h: 1.29,
      },
    });

    const result = await getJupiterPriceForTokenQuery("SOL");

    expect(mockRequireResolvedToken).toHaveBeenCalledWith("SOL");
    expect(mockJupiterPricesByMint).toHaveBeenCalledWith([SOL_TOKEN.address]);
    expect(result.query).toBe("SOL");
    expect(result.mint).toBe(SOL_TOKEN.address);
    expect(result.found).toBe(true);
    expect(result.price?.usdPrice).toBe(147.48);
    expect(result.token.symbol).toBe("SOL");
    // Price-path token output is plain metadata — no safety field leaks in.
    expect(result.token).toEqual(SOL_TOKEN);
    expect("safety" in result.token).toBe(false);
  });

  it("deduplicates resolved mint fetches while preserving query-level results", async () => {
    mockResolveTokens.mockResolvedValueOnce(new Map([
      ["SOL", SOL_TOKEN],
      ["WSOL", WSOL_TOKEN],
    ]));
    mockJupiterPricesByMint.mockResolvedValueOnce({
      [SOL_TOKEN.address]: {
        createdAt: "2024-06-05T08:55:25.527Z",
        liquidity: 621679197.67,
        usdPrice: 147.48,
        blockId: 348004023,
        decimals: 9,
        priceChange24h: 1.29,
      },
    });

    const result = await getJupiterPricesForTokenQueries(["SOL", "WSOL"]);

    expect(mockJupiterPricesByMint).toHaveBeenCalledWith([SOL_TOKEN.address]);
    expect(result.resolved).toHaveLength(2);
    expect(result.resolved[0].query).toBe("SOL");
    expect(result.resolved[1].query).toBe("WSOL");
    expect(result.resolved[0].found).toBe(true);
    expect(result.resolved[1].found).toBe(true);
  });

  it("throws SOLANA_TOKEN_NOT_FOUND when a token query cannot be resolved", async () => {
    mockResolveTokens.mockResolvedValueOnce(new Map([["SOL", SOL_TOKEN]]));

    await expect(
      getJupiterPricesForTokenQueries(["SOL", "DOES_NOT_EXIST"]),
    ).rejects.toMatchObject({ code: ErrorCodes.SOLANA_TOKEN_NOT_FOUND });

    expect(mockJupiterPricesByMint).not.toHaveBeenCalled();
  });
});
