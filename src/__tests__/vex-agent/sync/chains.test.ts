import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@utils/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

const mockGetCachedKhalaniChains = vi.fn();
const mockResolveChainId = vi.fn();
vi.mock("@tools/khalani/chains.js", () => ({
  getCachedKhalaniChains: () => mockGetCachedKhalaniChains(),
  resolveChainId: (...a: unknown[]) => mockResolveChainId(...a),
}));

const { resolveChainHint } = await import("../../../vex-agent/sync/chains.js");

beforeEach(() => {
  vi.clearAllMocks();
  mockGetCachedKhalaniChains.mockResolvedValue([{ id: 8453, name: "Base", type: "eip155" }]);
});

describe("resolveChainHint", () => {
  it("resolves solana", async () => {
    expect(await resolveChainHint("solana")).toEqual({ family: "solana", chainIds: [] });
  });

  it("resolves a Khalani chain", async () => {
    mockResolveChainId.mockReturnValue(8453);
    expect(await resolveChainHint("base")).toEqual({ family: "eip155", chainIds: [8453] });
  });

  it("resolves the local 'robinhood' hint to chain 4663 (no silent all-EVM fallback)", async () => {
    mockResolveChainId.mockImplementation(() => {
      throw new Error("unsupported");
    });
    expect(await resolveChainHint("robinhood")).toEqual({ family: "eip155", chainIds: [4663] });
  });

  it("falls back to all-EVM only for a genuinely unknown hint", async () => {
    mockResolveChainId.mockImplementation(() => {
      throw new Error("unsupported");
    });
    expect(await resolveChainHint("narnia")).toEqual({ family: "eip155", chainIds: [] });
  });
});
