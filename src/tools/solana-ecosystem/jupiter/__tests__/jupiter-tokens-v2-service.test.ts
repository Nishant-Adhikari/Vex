import { beforeEach, describe, expect, it, vi } from "vitest";

function callMock<T>(mock: unknown, args: unknown[]): T {
  return (mock as (...innerArgs: unknown[]) => T)(...args);
}

const mockGetCachedSolanaToken = vi.fn();
const mockCacheSolanaTokens = vi.fn();
vi.mock("@tools/solana-ecosystem/shared/solana-token-cache.js", () => ({
  getCachedSolanaToken: (...args: unknown[]) => callMock(mockGetCachedSolanaToken, args),
  cacheSolanaTokens: (...args: unknown[]) => callMock(mockCacheSolanaTokens, args),
}));

const mockTokenSearch = vi.fn();
const mockTokensByMint = vi.fn();
const mockTokensByTag = vi.fn();
const mockTokensByCategory = vi.fn();
const mockRecentTokens = vi.fn();
vi.mock("@tools/solana-ecosystem/jupiter/jupiter-tokens/client.js", () => ({
  jupiterTokenSearch: (...args: unknown[]) => callMock(mockTokenSearch, args),
  jupiterTokensByMint: (...args: unknown[]) => callMock(mockTokensByMint, args),
  jupiterTokensByTag: (...args: unknown[]) => callMock(mockTokensByTag, args),
  jupiterTokensByCategory: (...args: unknown[]) => callMock(mockTokensByCategory, args),
  jupiterRecentTokens: (...args: unknown[]) => callMock(mockRecentTokens, args),
}));

const {
  searchJupiterTokens,
  getJupiterTokensByMint,
  getJupiterTokensByTag,
  getJupiterTokensByCategory,
  getJupiterRecentTokens,
  resolveJupiterToken,
  resolveJupiterTokenWithSafety,
  requireJupiterResolvedToken,
} = await import("@tools/solana-ecosystem/jupiter/jupiter-tokens/service.js");
const { ErrorCodes } = await import("../../../../errors.js");

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

  it("surfaces the safety block from the token API audit + verification signals", async () => {
    const mint = "GkwFnmMDvn3HGMpJpWBg8tgJxr3NxNvg3AXxvXVPbRGJ";

    mockTokensByMint.mockResolvedValueOnce([
      {
        id: mint,
        symbol: "SUSY",
        name: "Suspicious Token",
        decimals: 6,
        isVerified: false,
        organicScore: 12.5,
        audit: {
          isSus: true,
          mintAuthorityDisabled: false,
          freezeAuthorityDisabled: true,
          topHoldersPercentage: 87.4,
        },
      },
    ]);

    const resolved = await resolveJupiterTokenWithSafety(mint);

    expect(resolved?.token.address).toBe(mint);
    // Safety is separate from the base metadata, never merged onto the token.
    expect("safety" in (resolved?.token ?? {})).toBe(false);
    expect(resolved?.safety).toEqual({
      isSus: true,
      mintAuthorityDisabled: false,
      freezeAuthorityDisabled: true,
      topHoldersPercentage: 87.4,
      isVerified: false,
      organicScore: 12.5,
    });
  });

  it("keeps meaningful false/0 safety signals while dropping absent fields", async () => {
    const mint = "GkwFnmMDvn3HGMpJpWBg8tgJxr3NxNvg3AXxvXVPbRGJ";

    mockTokensByMint.mockResolvedValueOnce([
      {
        id: mint,
        symbol: "EDGE",
        name: "Edge Token",
        decimals: 6,
        isVerified: false,
        // organicScore absent -> omitted entirely
        audit: {
          freezeAuthorityDisabled: false,
          topHoldersPercentage: 0,
          // isSus / mintAuthorityDisabled absent -> omitted entirely
        },
      },
    ]);

    const resolved = await resolveJupiterTokenWithSafety(mint);

    expect(resolved?.safety).toEqual({
      freezeAuthorityDisabled: false,
      topHoldersPercentage: 0,
      isVerified: false,
    });
  });

  it("omits the safety block when the token API returns no audit/verification data", async () => {
    const mint = "So11111111111111111111111111111111111111119";

    mockTokensByMint.mockResolvedValueOnce([
      { id: mint, symbol: "PLAIN", name: "Plain Token", decimals: 9 },
    ]);

    const resolved = await resolveJupiterTokenWithSafety(mint);

    expect(resolved?.token.address).toBe(mint);
    expect(resolved?.safety).toBeUndefined();
  });

  it("omits the safety block for an empty audit and an all-null audit (no undefined bag)", async () => {
    const emptyAuditMint = "EmptyAuditMintAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    const nullAuditMint = "NuxxAuditMintBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";

    mockTokensByMint.mockResolvedValueOnce([
      { id: emptyAuditMint, symbol: "EMPTY", name: "Empty Audit", decimals: 6, audit: {} },
    ]);
    const empty = await resolveJupiterTokenWithSafety(emptyAuditMint);
    expect(empty?.safety).toBeUndefined();

    mockTokensByMint.mockResolvedValueOnce([
      {
        id: nullAuditMint,
        symbol: "NULLS",
        name: "Null Audit",
        decimals: 6,
        isVerified: null,
        organicScore: null,
        audit: {
          isSus: null,
          mintAuthorityDisabled: null,
          freezeAuthorityDisabled: null,
          topHoldersPercentage: null,
        },
      },
    ]);
    const nulls = await resolveJupiterTokenWithSafety(nullAuditMint);
    expect(nulls?.safety).toBeUndefined();
  });

  it("resolveJupiterToken returns plain metadata with no safety field even when audit exists", async () => {
    const mint = "GkwFnmMDvn3HGMpJpWBg8tgJxr3NxNvg3AXxvXVPbRGJ";

    mockTokensByMint.mockResolvedValueOnce([
      {
        id: mint,
        symbol: "SUSY",
        name: "Suspicious Token",
        decimals: 6,
        isVerified: false,
        audit: { isSus: true },
      },
    ]);

    const token = await resolveJupiterToken(mint);

    expect(token?.address).toBe(mint);
    expect("safety" in (token ?? {})).toBe(false);
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
