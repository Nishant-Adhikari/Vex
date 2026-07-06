/**
 * Pendle enrichment (harness P2):
 *   - mergePendleRows dedup-by-address precedence (unchanged),
 *   - enrichPendleBalances chain-SCOPED asset map (never prices a bare address
 *     from another chain — critic #8),
 *   - seedPendleChainBalances standalone seeding + ghost cleanup,
 *   - fail-soft (RPC/API failure never destroys balances) vs DB-read propagation.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

import type { BalanceRow } from "@vex-agent/db/repos/balances.js";

vi.mock("@utils/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

const mockGetAllAssets = vi.fn();
vi.mock("@tools/pendle/client.js", () => ({
  getPendleClient: () => ({ getAllAssets: mockGetAllAssets }),
}));

const mockMulticall = vi.fn();
vi.mock("@tools/pendle/evm-client.js", () => ({
  getPendlePublicClient: () => ({ multicall: mockMulticall }),
}));

const mockGetTracked = vi.fn();
vi.mock("@vex-agent/db/repos/activity.js", () => ({
  getTrackedEvmTokensForChain: (...a: unknown[]) => mockGetTracked(...a),
}));

const mockReplace = vi.fn();
vi.mock("@vex-agent/db/repos/balances.js", () => ({
  replaceBalancesForChain: (...a: unknown[]) => mockReplace(...a),
}));

const { mergePendleRows, enrichPendleBalances, seedPendleChainBalances } = await import(
  "../../../vex-agent/sync/pendle-enrichment.js"
);

const WALLET = "0x1111111111111111111111111111111111111111";
const PT = "0x1a69154f6f6247e4457332860fb173251a36e03f";

function row(address: string, priceUsd: number | null): BalanceRow {
  return {
    walletFamily: "eip155",
    walletAddress: "0xwallet",
    chainId: 1,
    tokenAddress: address,
    tokenSymbol: "PT-X",
    tokenName: null,
    balanceRaw: "1000000000000000000",
    balanceUsd: priceUsd,
    priceUsd,
    decimals: 18,
  };
}

/** Minimal PendleAsset shape the enrichment reads. */
function asset(
  chainId: number,
  address: string,
  priceUsd: number | null,
  decimals: number,
  baseType = "PT",
) {
  return {
    chainId,
    address,
    symbol: "PT-X",
    decimals,
    expiry: null,
    baseType,
    priceUsd,
    priceAcc: null,
    priceUpdatedAt: null,
  };
}

describe("mergePendleRows", () => {
  it("Pendle-priced row replaces an unpriced Khalani row for the same token", () => {
    const merged = mergePendleRows([row(PT, null)], [row(PT, 0.99)]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.priceUsd).toBe(0.99);
  });

  it("a Khalani row that already has a price is authoritative", () => {
    const merged = mergePendleRows([row(PT, 1.0)], [row(PT, 0.5)]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.priceUsd).toBe(1.0);
  });

  it("adds a Pendle PT that Khalani did not report at all", () => {
    const merged = mergePendleRows([row("0xother", 1)], [row(PT, 0.99)]);
    expect(merged).toHaveLength(2);
    expect(merged.map((r) => r.tokenAddress.toLowerCase())).toContain(PT.toLowerCase());
  });

  it("dedupes case-insensitively on the token address", () => {
    const merged = mergePendleRows([row(PT.toUpperCase(), null)], [row(PT.toLowerCase(), 0.99)]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.priceUsd).toBe(0.99);
  });
});

describe("enrichPendleBalances — per-chain asset scoping", () => {
  beforeEach(() => vi.clearAllMocks());

  it("prices a PT from the asset on ITS chain, never the same address on another chain", async () => {
    mockGetTracked.mockResolvedValue([PT]);
    // Same bare address on Ethereum (price 100 / 18dp) AND Arbitrum (price 2 / 6dp).
    mockGetAllAssets.mockResolvedValue([asset(1, PT, 100, 18), asset(42161, PT, 2, 6)]);
    mockMulticall.mockResolvedValue([{ status: "success", result: 3_000_000n }]); // 3 units @ 6dp

    const merged = await enrichPendleBalances("eip155", WALLET, 42161, []);

    expect(merged).toHaveLength(1);
    expect(merged[0]!.chainId).toBe(42161);
    expect(merged[0]!.decimals).toBe(6); // arbitrum decimals, not ethereum's 18
    expect(merged[0]!.priceUsd).toBe(2);
    expect(merged[0]!.balanceUsd).toBe(6); // 3 * 2 — never priced off the chain-1 asset
    // The chainKeys query is scoped to the chain's slug (arbitrum), not "ethereum".
    expect(mockGetTracked).toHaveBeenCalledWith({ walletAddress: WALLET, chainKeys: ["arbitrum"] });
  });

  it("ignores a tracked token that is not classified PT on this chain", async () => {
    mockGetTracked.mockResolvedValue([PT]);
    mockGetAllAssets.mockResolvedValue([asset(42161, PT, 2, 6, "GENERIC")]);
    const merged = await enrichPendleBalances("eip155", WALLET, 42161, []);
    expect(merged).toEqual([]);
    expect(mockMulticall).not.toHaveBeenCalled();
  });
});

describe("seedPendleChainBalances — standalone seeding + ghost cleanup", () => {
  beforeEach(() => vi.clearAllMocks());

  it("writes tracked PT rows for a Pendle chain Khalani cannot scan (monad 143)", async () => {
    mockGetTracked.mockResolvedValue([PT]);
    mockGetAllAssets.mockResolvedValue([asset(143, PT, 5, 18)]);
    mockMulticall.mockResolvedValue([{ status: "success", result: 2_000000000000000000n }]); // 2 units
    mockReplace.mockResolvedValue(1);

    const result = await seedPendleChainBalances("eip155", WALLET, 143);

    expect(result.skipped).toBe(false);
    expect(result.tokensUpdated).toBe(1);
    expect(mockReplace).toHaveBeenCalledTimes(1);
    const [addr, chainId, rows] = mockReplace.mock.calls[0]! as [string, number, BalanceRow[]];
    expect(addr).toBe(WALLET);
    expect(chainId).toBe(143);
    expect(rows[0]!.chainId).toBe(143);
    expect(rows[0]!.balanceUsd).toBe(10); // 2 * 5
  });

  it("replaces with EMPTY to clear a stale PT row when the balance is now zero (post-sell)", async () => {
    mockGetTracked.mockResolvedValue([PT]);
    mockGetAllAssets.mockResolvedValue([asset(143, PT, 5, 18)]);
    mockMulticall.mockResolvedValue([{ status: "success", result: 0n }]);
    mockReplace.mockResolvedValue(0);

    const result = await seedPendleChainBalances("eip155", WALLET, 143);

    expect(result.skipped).toBe(false);
    expect(mockReplace).toHaveBeenCalledWith(WALLET, 143, []);
  });

  it("skips (no write) when the wallet has never traded PT on this chain", async () => {
    mockGetTracked.mockResolvedValue([]);
    const result = await seedPendleChainBalances("eip155", WALLET, 143);
    expect(result.skipped).toBe(true);
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("skips a non-Pendle chain without any DB or RPC work", async () => {
    const result = await seedPendleChainBalances("eip155", WALLET, 137); // polygon: not a Pendle chain
    expect(result.skipped).toBe(true);
    expect(mockGetTracked).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });
});

describe("fail-soft vs DB-read propagation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("MERGE keeps the base rows (same reference) untouched when assets/all fails", async () => {
    mockGetTracked.mockResolvedValue([PT]);
    mockGetAllAssets.mockRejectedValue(new Error("network"));
    const base = [row("0xother", 1)];
    const merged = await enrichPendleBalances("eip155", WALLET, 143, base);
    expect(merged).toBe(base);
  });

  it("SEED skips its write (keeps last-good rows) when the multicall RPC fails", async () => {
    mockGetTracked.mockResolvedValue([PT]);
    mockGetAllAssets.mockResolvedValue([asset(143, PT, 5, 18)]);
    mockMulticall.mockRejectedValue(new Error("rpc down"));
    const result = await seedPendleChainBalances("eip155", WALLET, 143);
    expect(result.skipped).toBe(true);
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("PROPAGATES a DB fault from the tracked-token read (never silently swallowed)", async () => {
    mockGetTracked.mockRejectedValue(new Error("db down"));
    await expect(seedPendleChainBalances("eip155", WALLET, 143)).rejects.toThrow("db down");
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
