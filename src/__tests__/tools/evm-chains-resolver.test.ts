import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetCachedKhalaniChains = vi.fn();
const mockResolveChainId = vi.fn();
vi.mock("@tools/khalani/chains.js", () => ({
  getCachedKhalaniChains: () => mockGetCachedKhalaniChains(),
  resolveChainId: (...a: unknown[]) => mockResolveChainId(...a),
}));

const { resolveInclusiveEvmChain } = await import("@tools/evm-chains/resolver.js");

const KHALANI_CHAINS = [
  { id: 8453, name: "Base", type: "eip155" },
  { id: 20011000000, name: "Solana", type: "solana" },
];

beforeEach(() => {
  vi.clearAllMocks();
  mockGetCachedKhalaniChains.mockResolvedValue(KHALANI_CHAINS);
});

describe("resolveInclusiveEvmChain — capability provenance (correction #2)", () => {
  it("tags a genuinely Khalani-registered chain as source 'khalani'", async () => {
    mockResolveChainId.mockReturnValue(8453);
    const resolved = await resolveInclusiveEvmChain("base");
    expect(resolved.source).toBe("khalani");
    expect(resolved.chainId).toBe(8453);
    expect(resolved.family).toBe("eip155");
  });

  it("resolves a local alias ('robinhood') to source 'local' when Khalani rejects it", async () => {
    mockResolveChainId.mockImplementation(() => {
      throw new Error("unsupported");
    });
    const resolved = await resolveInclusiveEvmChain("robinhood");
    expect(resolved.source).toBe("local");
    expect(resolved.chainId).toBe(4663);
    expect(resolved.family).toBe("eip155");
  });

  it("does NOT let Khalani's numeric passthrough masquerade 4663 as khalani", async () => {
    // Khalani resolveChainId does a numeric passthrough → returns 4663 even
    // though it is not in the registry. The inclusive resolver must fall through
    // to local rather than tag it khalani-supported.
    mockResolveChainId.mockReturnValue(4663);
    const resolved = await resolveInclusiveEvmChain("4663");
    expect(resolved.source).toBe("local");
    expect(resolved.chainId).toBe(4663);
  });

  it("still resolves local chains when the Khalani registry is unavailable", async () => {
    mockGetCachedKhalaniChains.mockRejectedValue(new Error("registry down"));
    const resolved = await resolveInclusiveEvmChain("robinhood");
    expect(resolved.source).toBe("local");
    expect(resolved.chainId).toBe(4663);
  });

  it("throws for a chain in neither registry", async () => {
    mockResolveChainId.mockImplementation(() => {
      throw new Error("unsupported");
    });
    await expect(resolveInclusiveEvmChain("narnia")).rejects.toThrow(/Unsupported chain/);
  });

  it("throws for empty input", async () => {
    await expect(resolveInclusiveEvmChain("   ")).rejects.toThrow(/cannot be empty/);
  });
});
