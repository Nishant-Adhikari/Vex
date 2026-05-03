import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetCachedKhalaniChains = vi.fn();

vi.mock("@tools/khalani/chains.js", () => ({
  CHAIN_ALIASES: {
    base: 8453,
    solana: 20011000000,
  },
  getCachedKhalaniChains: () => mockGetCachedKhalaniChains(),
}));

const { getPortfolioChainId, resolvePortfolioChainIds } = await import(
  "../../../vex-agent/sync/portfolio-chain-map.js"
);

describe("portfolio-chain-map", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCachedKhalaniChains.mockResolvedValue([
      { id: 20011000000, name: "Solana", type: "solana" },
      { id: 8453, name: "Base", type: "eip155" },
      { id: 2741, name: "Abstract", type: "eip155" },
    ]);
  });

  it("resolves chain ids from the Khalani registry", async () => {
    const chainIds = await resolvePortfolioChainIds(["solana", "base", "abstract"]);

    expect(getPortfolioChainId(chainIds, "solana")).toBe(20011000000);
    expect(getPortfolioChainId(chainIds, "base")).toBe(8453);
    expect(getPortfolioChainId(chainIds, "abstract")).toBe(2741);
  });

  it("falls back to aliases when the registry is unavailable", async () => {
    mockGetCachedKhalaniChains.mockRejectedValueOnce(new Error("registry down"));

    const chainIds = await resolvePortfolioChainIds(["solana", "base", "unknown"]);

    expect(getPortfolioChainId(chainIds, "solana")).toBe(20011000000);
    expect(getPortfolioChainId(chainIds, "base")).toBe(8453);
    expect(getPortfolioChainId(chainIds, "unknown")).toBeUndefined();
  });
});
