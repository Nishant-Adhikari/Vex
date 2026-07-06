/**
 * Pendle post-mutation sync seeding (G2#5) — the pendle captures' chain slug
 * resolves to its chainId, so a buy/sell/redeem seeds a selective sync of that
 * chain. This drives the REAL Khalani alias resolver (only the network fetch is
 * stubbed) so every one of the 11 Pendle registry slugs is proven to resolve to
 * its chainId via `resolveChainHint`.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Use the REAL resolveChainId (Khalani CHAIN_ALIASES) — only stub the network
// fetch so no live Khalani call is made. The Pendle slugs are aliases in
// CHAIN_ALIASES, so resolution does not depend on the fetched chain list.
vi.mock("@tools/khalani/chains.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tools/khalani/chains.js")>();
  return { ...actual, getCachedKhalaniChains: vi.fn().mockResolvedValue([]) };
});
vi.mock("@tools/evm-chains/registry.js", () => ({
  resolveLocalChainId: () => undefined,
}));
vi.mock("@utils/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

const { resolveChainHint } = await import("../../../vex-agent/sync/chains.js");
const { PENDLE_CHAIN_SLUG, PENDLE_CHAIN_REGISTRY } = await import("../../../tools/pendle/chains.js");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("pendle capture chain hint → selective sync (G2#5)", () => {
  it("the Ethereum capture slug is 'ethereum'", () => {
    expect(PENDLE_CHAIN_SLUG).toBe("ethereum");
  });

  it("resolveChainHint('ethereum') targets EVM chain 1", async () => {
    const resolved = await resolveChainHint(PENDLE_CHAIN_SLUG);
    expect(resolved.family).toBe("eip155");
    expect(resolved.chainIds).toEqual([1]);
  });

  it("EVERY Pendle registry slug resolves to its chainId as an EVM chain", async () => {
    for (const chain of PENDLE_CHAIN_REGISTRY) {
      const resolved = await resolveChainHint(chain.slug);
      expect(resolved.family, `slug ${chain.slug}`).toBe("eip155");
      expect(resolved.chainIds, `slug ${chain.slug}`).toEqual([chain.chainId]);
    }
  });
});
