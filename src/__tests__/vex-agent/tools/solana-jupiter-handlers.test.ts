import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ProtocolExecutionContext } from "@vex-agent/tools/protocols/types.js";

// Mock the Jupiter tokens service so category-routing tests never hit the
// network and we can assert WHICH provider a category routes to. `vi.hoisted`
// is required because the `vi.mock` factory is hoisted above top-level imports.
const {
  getJupiterTokensByCategory,
  getJupiterRecentTokens,
  getJupiterTokensByTag,
  searchJupiterTokens,
} = vi.hoisted(() => ({
  getJupiterTokensByCategory: vi.fn(async () => []),
  getJupiterRecentTokens: vi.fn(async () => []),
  getJupiterTokensByTag: vi.fn(async () => []),
  searchJupiterTokens: vi.fn(async () => []),
}));

vi.mock("@tools/solana-ecosystem/jupiter/jupiter-tokens/service.js", () => ({
  getJupiterTokensByCategory,
  getJupiterRecentTokens,
  getJupiterTokensByTag,
  searchJupiterTokens,
}));

// Mock the prediction service so the projection (P1-11 compact-JSON) and
// pagination plumbing can be asserted without hitting the network. Only the
// read handlers exercised below are mocked; mutating handlers (buy/sell/...)
// are covered by their param-validation tests above and never resolve here.
const {
  getJupiterPredictionEvents,
  searchJupiterPredictionEvents,
  getJupiterPredictionEvent,
  getJupiterPredictionPositions,
  getJupiterPredictionPosition,
} = vi.hoisted(() => ({
  getJupiterPredictionEvents: vi.fn(),
  searchJupiterPredictionEvents: vi.fn(),
  getJupiterPredictionEvent: vi.fn(),
  getJupiterPredictionPositions: vi.fn(),
  getJupiterPredictionPosition: vi.fn(),
}));

vi.mock("@tools/solana-ecosystem/jupiter/jupiter-prediction/prediction-api/service.js", () => ({
  getJupiterPredictionEvents,
  searchJupiterPredictionEvents,
  getJupiterPredictionEvent,
  getJupiterPredictionPositions,
  getJupiterPredictionPosition,
  // Re-exported by the handler module but unused by these tests; provide inert
  // stubs so the mock fully replaces the real (network-bound) module.
  getJupiterPredictionMarket: vi.fn(),
  getJupiterPredictionHistory: vi.fn(),
  executeJupiterPredictionCreateOrder: vi.fn(),
  executeJupiterPredictionClosePosition: vi.fn(),
  executeJupiterPredictionCloseAllPositions: vi.fn(),
  executeJupiterPredictionClaimPosition: vi.fn(),
}));

// ── Prediction projection fixtures (full SDK-shaped objects) ──────
// Heavy/agent-irrelevant fields (imageUrl, rulesPdf, marketResultPubkey, event
// metadata.{slug,series,closeTime,imageUrl}) are present so the projection
// assertions prove they are dropped.

const FULL_MARKET = {
  marketId: "mkt-1",
  status: "open",
  result: null,
  openTime: 1,
  closeTime: 2,
  resolveAt: null,
  marketResultPubkey: "MarketResultPubkeyShouldBeDropped",
  imageUrl: "https://img/should-be-dropped.png",
  metadata: { marketId: "mkt-1", eventId: "evt-1", title: "Market title", subtitle: "Market sub", status: "open", result: null, description: "long noisy description" },
  pricing: { buyYesPriceUsd: 0.6, buyNoPriceUsd: 0.4, volume: 100 },
};

const FULL_EVENT = {
  eventId: "evt-1",
  isActive: true,
  isLive: true,
  category: "crypto",
  subcategory: "btc",
  tags: ["a", "b"],
  metadata: { eventId: "evt-1", title: "Event title", subtitle: "Event sub", slug: "slug-drop", series: "series-drop", closeTime: "2026-01-01", imageUrl: "https://img/drop.png", isLive: true },
  markets: [FULL_MARKET],
  volumeUsd: "12345",
  closeCondition: "cond",
  beginAt: null,
  rulesPdf: "https://rules/should-be-dropped.pdf",
};

const FULL_POSITION = {
  pubkey: "pos-1",
  owner: "owner-1",
  ownerPubkey: "owner-1",
  market: "mkt-acct",
  marketId: "mkt-1",
  marketIdHash: "hash",
  isYes: true,
  contracts: "10",
  totalCostUsd: "6",
  sizeUsd: "6",
  valueUsd: "7",
  avgPriceUsd: "0.6",
  markPriceUsd: "0.7",
  sellPriceUsd: "0.7",
  pnlUsd: "1",
  pnlUsdPercent: 16,
  pnlUsdAfterFees: "0.9",
  pnlUsdAfterFeesPercent: 15,
  openOrders: 0,
  feesPaidUsd: "0.1",
  realizedPnlUsd: 0,
  claimed: false,
  claimedUsd: "0",
  openedAt: 1,
  updatedAt: 2,
  claimableAt: null,
  payoutUsd: "10",
  bump: 1,
  eventId: "evt-1",
  eventMetadata: { eventId: "evt-1", title: "Event title", subtitle: "Event sub", slug: "slug-drop", series: "series-drop", closeTime: "2026-01-01", imageUrl: "https://img/drop.png" },
  marketMetadata: { marketId: "mkt-1", eventId: "evt-1", title: "Market title", subtitle: "Market sub", status: "open", result: null },
  settlementDate: null,
  claimable: false,
};

import { SOLANA_JUPITER_HANDLERS } from "../../../vex-agent/tools/protocols/solana-jupiter/handlers.js";
import { SOLANA_JUPITER_TOOLS } from "../../../vex-agent/tools/protocols/solana-jupiter/manifest.js";

/** Type-complete ProtocolExecutionContext for param-validation handler tests. */
function ctx(over: Partial<ProtocolExecutionContext> = {}): ProtocolExecutionContext {
  return {
    sessionPermission: "restricted",
    approved: false,
    walletResolution: { source: "default" },
    walletPolicy: { kind: "none" },
    ...over,
  };
}

describe("solana-jupiter handlers", () => {
  // ── Handler coverage — every manifest has a handler ──────────────

  it("has a handler for every manifest toolId", () => {
    const handlerKeys = new Set(Object.keys(SOLANA_JUPITER_HANDLERS));
    const manifestIds = SOLANA_JUPITER_TOOLS.map(t => t.toolId);

    const missing = manifestIds.filter(id => !handlerKeys.has(id));
    expect(missing).toEqual([]);
  });

  it("has no extra handlers without manifests", () => {
    const manifestIds = new Set(SOLANA_JUPITER_TOOLS.map(t => t.toolId));
    const handlerKeys = Object.keys(SOLANA_JUPITER_HANDLERS);

    const extra = handlerKeys.filter(key => !manifestIds.has(key));
    expect(extra).toEqual([]);
  });

  it("handler count matches manifest count", () => {
    expect(Object.keys(SOLANA_JUPITER_HANDLERS)).toHaveLength(SOLANA_JUPITER_TOOLS.length);
  });

  // ── Handler type — all are async functions ──────────────────────

  it("every handler is a function", () => {
    for (const [toolId, handler] of Object.entries(SOLANA_JUPITER_HANDLERS)) {
      expect(typeof handler).toBe("function");
    }
  });

  // ── Required param validation (handlers should fail on missing) ──

  it("solana.tokens.search fails without query", async () => {
    const result = await SOLANA_JUPITER_HANDLERS["solana.tokens.search"]!(
      {},
      ctx(),
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("query");
  });

  it("solana.predict.market fails without marketId", async () => {
    const result = await SOLANA_JUPITER_HANDLERS["solana.predict.market"]!(
      {},
      ctx(),
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("marketId");
  });

  it("solana.swap.quote fails without required params", async () => {
    const result = await SOLANA_JUPITER_HANDLERS["solana.swap.quote"]!(
      { inputToken: "SOL" },
      ctx(),
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("Missing required");
  });

  it("solana.predict.buy fails without required params", async () => {
    const result = await SOLANA_JUPITER_HANDLERS["solana.predict.buy"]!(
      { marketId: "abc" },
      ctx(),
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("Missing required");
  });

  it("solana.predict.buy rejects invalid side", async () => {
    const result = await SOLANA_JUPITER_HANDLERS["solana.predict.buy"]!(
      { marketId: "abc", side: "maybe", amountUsdc: 10 },
      ctx(),
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("yes");
    expect(result.output).toContain("no");
  });

  it("solana.predict.buy rejects typo side silently treated as NO before fix", async () => {
    const result = await SOLANA_JUPITER_HANDLERS["solana.predict.buy"]!(
      { marketId: "abc", side: "Yes!", amountUsdc: 10 },
      ctx(),
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("yes");
  });

  it("solana.lend.deposit fails without required params", async () => {
    const result = await SOLANA_JUPITER_HANDLERS["solana.lend.deposit"]!(
      {},
      ctx(),
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("Missing required");
  });

  it("solana.predict.event fails without eventId", async () => {
    const result = await SOLANA_JUPITER_HANDLERS["solana.predict.event"]!(
      {},
      ctx(),
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("eventId");
  });

  it("solana.prices fails without mints", async () => {
    const result = await SOLANA_JUPITER_HANDLERS["solana.prices"]!(
      { mints: "" },
      ctx(),
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("mints");
  });

  it("solana.predict.search fails without query", async () => {
    const result = await SOLANA_JUPITER_HANDLERS["solana.predict.search"]!(
      {},
      ctx(),
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("query");
  });

  // ── Prediction compact-JSON projection + pagination (P1-11) ──────

  describe("prediction read handlers — projection + pagination", () => {
    beforeEach(() => {
      getJupiterPredictionEvents.mockReset();
      searchJupiterPredictionEvents.mockReset();
      getJupiterPredictionEvent.mockReset();
      getJupiterPredictionPositions.mockReset();
      getJupiterPredictionPosition.mockReset();
    });

    /** Event-shape assertions shared across events/search/event handlers. */
    function expectProjectedEvent(event: Record<string, unknown>): void {
      expect(event).toEqual({
        eventId: "evt-1",
        category: "crypto",
        volumeUsd: "12345",
        metadata: { eventId: "evt-1", title: "Event title", subtitle: "Event sub" },
        markets: [
          {
            marketId: "mkt-1",
            status: "open",
            result: null,
            openTime: 1,
            closeTime: 2,
            resolveAt: null,
            pricing: { buyYesPriceUsd: 0.6, buyNoPriceUsd: 0.4, volume: 100 },
            metadata: { marketId: "mkt-1", eventId: "evt-1", title: "Market title", subtitle: "Market sub", status: "open", result: null },
          },
        ],
      });
      // Explicit drop guards (event + market + event-metadata noise).
      expect(event).not.toHaveProperty("rulesPdf");
      expect(event).not.toHaveProperty("isActive");
      const metadata = event.metadata as Record<string, unknown>;
      expect(metadata).not.toHaveProperty("slug");
      expect(metadata).not.toHaveProperty("series");
      expect(metadata).not.toHaveProperty("closeTime");
      expect(metadata).not.toHaveProperty("imageUrl");
      const market = (event.markets as Record<string, unknown>[])[0]!;
      expect(market).not.toHaveProperty("imageUrl");
      expect(market).not.toHaveProperty("marketResultPubkey");
    }

    it("events: projects each event, paginates limit/offset → start/end, preserves pagination", async () => {
      getJupiterPredictionEvents.mockResolvedValue({
        data: [structuredClone(FULL_EVENT)],
        pagination: { start: 5, end: 8, total: 50, hasNext: true },
      });
      const result = await SOLANA_JUPITER_HANDLERS["solana.predict.events"]!(
        { category: "crypto", filter: "trending", limit: 3, offset: 5 },
        ctx(),
      );
      expect(result.success).toBe(true);
      expect(getJupiterPredictionEvents).toHaveBeenCalledWith(
        expect.objectContaining({ category: "crypto", filter: "trending", includeMarkets: true, start: 5, end: 8 }),
      );
      const data = result.data as { data: Record<string, unknown>[]; pagination: unknown };
      expect(data.pagination).toEqual({ start: 5, end: 8, total: 50, hasNext: true });
      expectProjectedEvent(data.data[0]!);
    });

    it("events: defaults to start=0,end=10 when limit/offset absent", async () => {
      getJupiterPredictionEvents.mockResolvedValue({ data: [], pagination: { start: 0, end: 10, total: 0, hasNext: false } });
      await SOLANA_JUPITER_HANDLERS["solana.predict.events"]!({}, ctx());
      expect(getJupiterPredictionEvents).toHaveBeenCalledWith(
        expect.objectContaining({ start: 0, end: 10 }),
      );
    });

    // P1-11 non-negative guard: a negative limit/offset must be clamped to 0
    // (Math.max) so the SDK never receives an invalid/negative start/end window.
    it("events: clamps negative limit/offset to a non-negative start/end window", async () => {
      getJupiterPredictionEvents.mockResolvedValue({ data: [], pagination: { start: 0, end: 0, total: 0, hasNext: false } });
      const result = await SOLANA_JUPITER_HANDLERS["solana.predict.events"]!(
        { limit: -5, offset: -3 },
        ctx(),
      );
      expect(result.success).toBe(true);
      const call = getJupiterPredictionEvents.mock.calls[0]![0] as { start: number; end: number };
      expect(call.start).toBe(0);
      expect(call.end).toBe(0);
      expect(call.start).toBeGreaterThanOrEqual(0);
      expect(call.end).toBeGreaterThanOrEqual(0);
    });

    it("positions: clamps negative limit/offset to a non-negative start/end window", async () => {
      getJupiterPredictionPositions.mockResolvedValue({ data: [], pagination: { start: 0, end: 0, total: 0, hasNext: false } });
      const result = await SOLANA_JUPITER_HANDLERS["solana.predict.positions"]!(
        { address: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM", limit: -10, offset: -2 },
        ctx(),
      );
      expect(result.success).toBe(true);
      const call = getJupiterPredictionPositions.mock.calls[0]![0] as { start: number; end: number };
      expect(call.start).toBe(0);
      expect(call.end).toBe(0);
      expect(call.start).toBeGreaterThanOrEqual(0);
      expect(call.end).toBeGreaterThanOrEqual(0);
    });

    it("search: projects each event in the result", async () => {
      searchJupiterPredictionEvents.mockResolvedValue({ data: [structuredClone(FULL_EVENT)] });
      const result = await SOLANA_JUPITER_HANDLERS["solana.predict.search"]!({ query: "btc" }, ctx());
      expect(result.success).toBe(true);
      const data = result.data as { data: Record<string, unknown>[] };
      expectProjectedEvent(data.data[0]!);
    });

    it("event: projects the single event", async () => {
      getJupiterPredictionEvent.mockResolvedValue(structuredClone(FULL_EVENT));
      const result = await SOLANA_JUPITER_HANDLERS["solana.predict.event"]!({ eventId: "evt-1" }, ctx());
      expect(result.success).toBe(true);
      expectProjectedEvent(result.data as Record<string, unknown>);
    });

    it("positions: projects each position, paginates, requires no resolution with explicit address", async () => {
      getJupiterPredictionPositions.mockResolvedValue({
        data: [structuredClone(FULL_POSITION)],
        pagination: { start: 0, end: 10, total: 1, hasNext: false },
      });
      const result = await SOLANA_JUPITER_HANDLERS["solana.predict.positions"]!(
        { address: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM", limit: 5, offset: 2 },
        ctx(),
      );
      expect(result.success).toBe(true);
      expect(getJupiterPredictionPositions).toHaveBeenCalledWith(
        expect.objectContaining({ ownerPubkey: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM", start: 2, end: 7 }),
      );
      const data = result.data as { data: Record<string, unknown>[] };
      const pos = data.data[0]!;
      expect(pos).toEqual({
        pubkey: "pos-1",
        owner: "owner-1",
        contracts: "10",
        sizeUsd: "6",
        valueUsd: "7",
        avgPriceUsd: "0.6",
        markPriceUsd: "0.7",
        pnlUsd: "1",
        claimed: false,
        payoutUsd: "10",
        eventId: "evt-1",
        eventMetadata: { eventId: "evt-1", title: "Event title", subtitle: "Event sub" },
        marketMetadata: { marketId: "mkt-1", eventId: "evt-1", title: "Market title", subtitle: "Market sub", status: "open", result: null },
      });
      // Dropped position noise.
      expect(pos).not.toHaveProperty("ownerPubkey");
      expect(pos).not.toHaveProperty("totalCostUsd");
      expect(pos).not.toHaveProperty("realizedPnlUsd");
      expect((pos.eventMetadata as Record<string, unknown>)).not.toHaveProperty("imageUrl");
    });

    it("position: projects the single position", async () => {
      getJupiterPredictionPosition.mockResolvedValue(structuredClone(FULL_POSITION));
      const result = await SOLANA_JUPITER_HANDLERS["solana.predict.position"]!({ positionPubkey: "pos-1" }, ctx());
      expect(result.success).toBe(true);
      const pos = result.data as Record<string, unknown>;
      expect(pos.pubkey).toBe("pos-1");
      expect(pos).not.toHaveProperty("marketResultPubkey");
      expect(pos).not.toHaveProperty("ownerPubkey");
    });
  });

  // ── solana.tokens.trending — category/interval routing & guards ──

  const trending = (p: Record<string, unknown>) =>
    SOLANA_JUPITER_HANDLERS["solana.tokens.trending"]!(p, ctx());

  beforeEach(() => {
    getJupiterTokensByCategory.mockClear();
    getJupiterRecentTokens.mockClear();
    getJupiterTokensByTag.mockClear();
  });

  it("solana.tokens.trending rejects a present-but-unknown category", async () => {
    const result = await trending({ category: "hot" });
    expect(result.success).toBe(false);
    for (const valid of ["toptrending", "toptraded", "toporganicscore", "recent", "lst", "verified"]) {
      expect(result.output).toContain(valid);
    }
    expect(getJupiterTokensByCategory).not.toHaveBeenCalled();
    expect(getJupiterRecentTokens).not.toHaveBeenCalled();
    expect(getJupiterTokensByTag).not.toHaveBeenCalled();
  });

  // Codex BLOCKER regression: a prototype key must NOT pass membership and must
  // NOT route to any provider (previously `"constructor" in TAG_MAP` was true).
  it("solana.tokens.trending rejects prototype keys (constructor / toString)", async () => {
    for (const proto of ["constructor", "toString", "hasOwnProperty"]) {
      const result = await trending({ category: proto });
      expect(result.success).toBe(false);
      expect(result.output).toContain("Unknown category");
    }
    expect(getJupiterTokensByCategory).not.toHaveBeenCalled();
    expect(getJupiterRecentTokens).not.toHaveBeenCalled();
    expect(getJupiterTokensByTag).not.toHaveBeenCalled();
  });

  it("solana.tokens.trending rejects a present-but-unknown interval", async () => {
    const result = await trending({ interval: "4h" });
    expect(result.success).toBe(false);
    for (const valid of ["5m", "1h", "6h", "24h"]) {
      expect(result.output).toContain(valid);
    }
    expect(getJupiterTokensByCategory).not.toHaveBeenCalled();
  });

  it("solana.tokens.trending defaults absent category/interval to toptrending/1h via category provider", async () => {
    const result = await trending({});
    expect(result.success).toBe(true);
    expect(getJupiterTokensByCategory).toHaveBeenCalledTimes(1);
    expect(getJupiterTokensByCategory).toHaveBeenCalledWith(
      expect.objectContaining({ category: "toptrending", interval: "1h" }),
    );
    expect(getJupiterRecentTokens).not.toHaveBeenCalled();
    expect(getJupiterTokensByTag).not.toHaveBeenCalled();
  });

  it("solana.tokens.trending routes 'recent' to the recent provider", async () => {
    const result = await trending({ category: "recent" });
    expect(result.success).toBe(true);
    expect(getJupiterRecentTokens).toHaveBeenCalledTimes(1);
    expect(getJupiterTokensByCategory).not.toHaveBeenCalled();
    expect(getJupiterTokensByTag).not.toHaveBeenCalled();
  });

  it("solana.tokens.trending routes 'lst' and 'verified' to the tag provider", async () => {
    for (const tag of ["lst", "verified"] as const) {
      getJupiterTokensByTag.mockClear();
      const result = await trending({ category: tag });
      expect(result.success).toBe(true);
      expect(getJupiterTokensByTag).toHaveBeenCalledTimes(1);
      expect(getJupiterTokensByTag).toHaveBeenCalledWith(tag);
    }
    expect(getJupiterTokensByCategory).not.toHaveBeenCalled();
    expect(getJupiterRecentTokens).not.toHaveBeenCalled();
  });

  it("solana.tokens.trending routes 'toptraded' to the category provider", async () => {
    const result = await trending({ category: "toptraded" });
    expect(result.success).toBe(true);
    expect(getJupiterTokensByCategory).toHaveBeenCalledTimes(1);
    expect(getJupiterTokensByCategory).toHaveBeenCalledWith(
      expect.objectContaining({ category: "toptraded" }),
    );
    expect(getJupiterTokensByTag).not.toHaveBeenCalled();
    expect(getJupiterRecentTokens).not.toHaveBeenCalled();
  });
});
