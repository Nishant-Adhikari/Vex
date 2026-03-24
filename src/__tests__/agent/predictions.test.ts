import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRequireSolanaWallet = vi.fn();
const mockRequireEvmWallet = vi.fn();
const mockGetJupiterPositions = vi.fn();
const mockGetJupiterMarket = vi.fn();
const mockPolyGetPositions = vi.fn();
const mockPolyGetValue = vi.fn();
const mockPolyGetOrders = vi.fn();
const mockHasPolyClobCredentials = vi.fn();

vi.mock("../../wallet/multi-auth.js", () => ({
  requireSolanaWallet: (...args: unknown[]) => mockRequireSolanaWallet(...args),
  requireEvmWallet: (...args: unknown[]) => mockRequireEvmWallet(...args),
}));

vi.mock("../../chains/solana/prediction-service.js", () => ({
  getPositions: (...args: unknown[]) => mockGetJupiterPositions(...args),
  getMarket: (...args: unknown[]) => mockGetJupiterMarket(...args),
}));

vi.mock("../../polymarket/data/client.js", () => ({
  getPolyDataClient: () => ({
    getPositions: (...args: unknown[]) => mockPolyGetPositions(...args),
    getValue: (...args: unknown[]) => mockPolyGetValue(...args),
  }),
}));

vi.mock("../../polymarket/clob/client.js", () => ({
  getPolyClobClient: () => ({
    getOrders: (...args: unknown[]) => mockPolyGetOrders(...args),
  }),
}));

vi.mock("../../polymarket/auth.js", () => ({
  hasPolyClobCredentials: (...args: unknown[]) => mockHasPolyClobCredentials(...args),
}));

vi.mock("../../utils/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

const { getJupiterPredictionState, getPolymarketPredictionState } = await import("../../agent/predictions.js");

describe("prediction state builders", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireSolanaWallet.mockReturnValue({ address: "SoLAddr" });
    mockRequireEvmWallet.mockReturnValue({ address: "0xwallet" });
    mockHasPolyClobCredentials.mockReturnValue(true);
  });

  it("maps Jupiter positions into the shared prediction state", async () => {
    mockGetJupiterPositions.mockResolvedValue([
      {
        pubkey: "pos-1",
        marketId: "market-1",
        isYes: true,
        contracts: 10,
        totalCostUsd: 6.5,
        valueUsd: 7.0,
        pnlUsd: 0.5,
        pnlUsdPercent: 7.7,
        claimable: false,
      },
    ]);
    mockGetJupiterMarket.mockResolvedValue({
      marketId: "market-1",
      title: "Will SOL hit $200?",
      status: "live",
      result: "",
      buyYesPriceUsd: 0.7,
      buyNoPriceUsd: 0.3,
      volume: 1000,
    });

    const state = await getJupiterPredictionState();

    expect(state.available).toBe(true);
    expect(state.positions).toHaveLength(1);
    expect(state.positions[0]).toMatchObject({
      source: "jupiter",
      title: "Will SOL hit $200?",
      outcome: "YES",
      currentPrice: 0.7,
      pnlUsd: 0.5,
      pnlPct: 7.7,
    });
    expect(state.summary).toMatchObject({
      positionCount: 1,
      totalValueUsd: 7,
      totalPnlUsd: 0.5,
      claimableCount: 0,
    });
  });

  it("returns unavailable Jupiter state when Solana wallet is missing", async () => {
    mockRequireSolanaWallet.mockImplementation(() => {
      throw new Error("No Solana wallet configured.");
    });

    const state = await getJupiterPredictionState();

    expect(state.available).toBe(false);
    expect(state.warnings[0]).toContain("No Solana wallet configured");
    expect(state.positions).toEqual([]);
  });

  it("maps Polymarket positions and orders into the shared prediction state", async () => {
    mockPolyGetPositions.mockResolvedValue([
      {
        proxyWallet: "0xwallet",
        asset: "asset-1",
        conditionId: "condition-1",
        size: 50,
        avgPrice: 0.42,
        initialValue: 21,
        currentValue: 29,
        cashPnl: 8,
        percentPnl: 0.3809,
        totalBought: 21,
        realizedPnl: 0,
        curPrice: 0.58,
        redeemable: true,
        mergeable: false,
        title: "Will ETH hold $4k?",
        slug: "eth-4k",
        eventSlug: "eth",
        outcome: "YES",
        outcomeIndex: 0,
        endDate: null,
        negativeRisk: false,
      },
    ]);
    mockPolyGetValue.mockResolvedValue({ user: "0xwallet", value: 29 });
    mockPolyGetOrders.mockResolvedValue({
      limit: 100,
      next_cursor: "",
      count: 1,
      data: [{
        id: "order-1",
        status: "live",
        owner: "owner",
        maker_address: "0xwallet",
        market: "condition-1",
        asset_id: "asset-1",
        side: "BUY",
        original_size: "12",
        size_matched: "2",
        price: "0.41",
        outcome: "YES",
        expiration: "",
        order_type: "GTC",
        associate_trades: [],
        created_at: 1700000000,
      }],
    });

    const state = await getPolymarketPredictionState();

    expect(state.available).toBe(true);
    expect(state.positions[0]).toMatchObject({
      source: "polymarket",
      title: "Will ETH hold $4k?",
      outcome: "YES",
      pnlUsd: 8,
      pnlPct: 38.09,
    });
    expect(state.orders[0]).toMatchObject({
      id: "order-1",
      side: "BUY",
      price: 0.41,
      size: 12,
      matchedSize: 2,
    });
    expect(state.summary).toMatchObject({
      totalValueUsd: 29,
      totalPnlUsd: 8,
      positionCount: 1,
      orderCount: 1,
      redeemableCount: 1,
    });
  });

  it("keeps Polymarket available without live creds and reports warnings", async () => {
    mockHasPolyClobCredentials.mockReturnValue(false);
    mockPolyGetPositions.mockResolvedValue([]);
    mockPolyGetValue.mockResolvedValue({ user: "0xwallet", value: 0 });

    const state = await getPolymarketPredictionState();

    expect(state.available).toBe(true);
    expect(state.liveStatus.available).toBe(false);
    expect(state.warnings).toContain("Polymarket live orders require CLOB credentials.");
  });
});
