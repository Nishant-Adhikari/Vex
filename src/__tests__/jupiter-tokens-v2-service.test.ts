import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetCachedSolanaToken = vi.fn();
const mockCacheSolanaTokens = vi.fn();
vi.mock("../tools/solana-ecosystem/shared/solana-token-cache.js", () => ({
  getCachedSolanaToken: (...args: unknown[]) => mockGetCachedSolanaToken(...args),
  cacheSolanaTokens: (...args: unknown[]) => mockCacheSolanaTokens(...args),
}));

const mockTokenSearch = vi.fn();
const mockTokensByMint = vi.fn();
const mockTokensByTag = vi.fn();
const mockTokensByCategory = vi.fn();
const mockRecentTokens = vi.fn();
vi.mock("../tools/solana-ecosystem/jupiter/jupiter-tokens/client.js", () => ({
  jupiterTokenSearch: (...args: unknown[]) => mockTokenSearch(...args),
  jupiterTokensByMint: (...args: unknown[]) => mockTokensByMint(...args),
  jupiterTokensByTag: (...args: unknown[]) => mockTokensByTag(...args),
  jupiterTokensByCategory: (...args: unknown[]) => mockTokensByCategory(...args),
  jupiterRecentTokens: (...args: unknown[]) => mockRecentTokens(...args),
}));

const {
  searchJupiterTokens,
  getJupiterTokensByMint,
  getJupiterTokensByTag,
  getJupiterTokensByCategory,
  getJupiterRecentTokens,
  resolveJupiterToken,
  requireJupiterResolvedToken,
} = await import("../tools/solana-ecosystem/jupiter/jupiter-tokens/service.js");
const { ErrorCodes } = await import("../errors.js");

describe("jupiter tokens v2 service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTokenSearch.mockReset();
    mockTokensByMint.mockReset();
    mockTokensByTag.mockReset();
    mockTokensByCategory.mockReset();
    mockRecentTokens.mockReset();
    mockGetCachedSolanaToken.mockReset();
    mockCacheSolanaTokens.mockReset();
    mockGetCachedSolanaToken.mockReturnValue(undefined);
  });

  it("passes through search and category endpoints without reshaping the response", async () => {
    mockTokenSearch.mockResolvedValueOnce([{ id: "mint-1", symbol: "JUP", name: "Jupiter", decimals: 6 }]);
    mockTokensByCategory.mockResolvedValueOnce([{ id: "mint-2", symbol: "ABC", name: "Abc", decimals: 9 }]);

    const search = await searchJupiterTokens("JUP");
    const category = await getJupiterTokensByCategory({
      category: "toptrending",
      interval: "1h",
      limit: 5,
    });

    expect(search[0].symbol).toBe("JUP");
    expect(category[0].id).toBe("mint-2");
  });

  it("uses well-known tokens before cache or network", async () => {
    const token = await resolveJupiterToken("SOL");

    expect(token?.symbol).toBe("SOL");
    expect(mockTokenSearch).not.toHaveBeenCalled();
    expect(mockTokensByMint).not.toHaveBeenCalled();
  });

  it("resolves mint addresses through batch mint lookup and caches the results", async () => {
    const mint = "GkwFnmMDvn3HGMpJpWBg8tgJxr3NxNvg3AXxvXVPbRGJ";

    mockTokensByMint.mockResolvedValueOnce([
      {
        id: mint,
        symbol: "FRESH",
        name: "Fresh Token",
        decimals: 9,
        icon: "https://example.com/fresh.png",
      },
    ]);

    const token = await resolveJupiterToken(mint);

    expect(mockTokensByMint).toHaveBeenCalledWith([mint]);
    expect(mockCacheSolanaTokens).toHaveBeenCalledTimes(1);
    expect(token?.address).toBe(mint);
    expect(token?.logoUri).toBe("https://example.com/fresh.png");
  });

  it("prefers exact symbol matches from search results", async () => {
    mockTokenSearch.mockResolvedValueOnce([
      { id: "mint-1", symbol: "ABCX", name: "Abc X", decimals: 6 },
      { id: "mint-2", symbol: "ABC", name: "Abc", decimals: 6 },
    ]);

    const token = await resolveJupiterToken("ABC");

    expect(mockTokenSearch).toHaveBeenCalledWith({ query: "ABC" });
    expect(token?.address).toBe("mint-2");
  });

  it("throws SOLANA_TOKEN_NOT_FOUND when requireJupiterResolvedToken gets no match", async () => {
    mockTokenSearch.mockResolvedValueOnce([]);

    await expect(
      requireJupiterResolvedToken("DOES_NOT_EXIST"),
    ).rejects.toMatchObject({ code: ErrorCodes.SOLANA_TOKEN_NOT_FOUND });
  });

  it("passes through tag, mint, and recent helpers", async () => {
    mockTokensByMint.mockResolvedValueOnce([]);
    mockTokensByTag.mockResolvedValueOnce([]);
    mockRecentTokens.mockResolvedValueOnce([]);

    await getJupiterTokensByMint(["So11111111111111111111111111111111111111112"]);
    await getJupiterTokensByTag("verified");
    await getJupiterRecentTokens();

    expect(mockTokensByMint).toHaveBeenCalledTimes(1);
    expect(mockTokensByTag).toHaveBeenCalledWith("verified");
    expect(mockRecentTokens).toHaveBeenCalledTimes(1);
  });
});
