import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks for money-moving handler tests (buy filled flag, cancel partial guard) ──
// These intercept the exact module specifiers the handlers import via the
// `@tools` / `@vex-agent` aliases (see vitest.config.ts). The existing
// validation tests fail on missing params BEFORE reaching any of these
// collaborators, and the live `bridge.assets` test uses the (unmocked) bridge
// client — so global mocks here do not disturb the existing suite.
// `mock`-prefixed names are required by vitest's hoisting guard for variables
// referenced inside a `vi.mock` factory (see repo pattern in khalani-bridge-wallet-scope).
const mockPostOrder = vi.fn();
const mockCancelOrder = vi.fn();
const mockGetFeeRate = vi.fn(() => Promise.resolve({ base_fee: 0 }));
const mockResolveMarket = vi.fn();

vi.mock("@tools/polymarket/clob/client.js", () => ({
  getPolyClobClient: () => ({
    postOrder: (...a: unknown[]) => mockPostOrder(...a),
    cancelOrder: (...a: unknown[]) => mockCancelOrder(...a),
    getFeeRate: (...a: unknown[]) => mockGetFeeRate(...a),
  }),
}));
vi.mock("@tools/polymarket/gamma/client.js", () => ({
  getPolyGammaClient: () => ({ resolveMarket: (...a: unknown[]) => mockResolveMarket(...a) }),
}));
vi.mock("@tools/polymarket/auth.js", () => ({
  requirePolyClobCredentials: () => ({ apiKey: "test-api-key", apiSecret: "secret", passphrase: "pass" }),
}));
vi.mock("@tools/polymarket/clob/signing.js", () => ({
  buildClobOrder: () => ({ maker: "0xMAKER", side: "BUY" }),
  signClobOrder: () => Promise.resolve("0xSIGNATURE"),
}));
vi.mock("@vex-agent/tools/internal/wallet/resolve.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@vex-agent/tools/internal/wallet/resolve.js")>();
  return {
    ...actual,
    resolveSelectedAddress: () => "0x1111111111111111111111111111111111111111",
    resolveSigningWallet: () => ({
      family: "eip155" as const,
      address: "0x1111111111111111111111111111111111111111",
      privateKey: "0xabc",
    }),
  };
});

const { POLYMARKET_HANDLERS } = await import("../../../vex-agent/tools/protocols/polymarket/handlers.js");
const { POLYMARKET_TOOLS } = await import("../../../vex-agent/tools/protocols/polymarket/manifest.js");

const SIGNING_CTX = {
  sessionPermission: "full" as const,
  approved: true,
  walletResolution: { source: "session" as const, evm: null, solana: null },
  walletPolicy: { kind: "none" as const },
};

beforeEach(() => {
  mockPostOrder.mockReset();
  mockCancelOrder.mockReset();
  mockGetFeeRate.mockReset().mockResolvedValue({ base_fee: 0 });
  mockResolveMarket.mockReset().mockResolvedValue({
    clobTokenIds: '["yesTok","noTok"]',
    negRisk: false,
    question: "Test market?",
  });
});

describe("polymarket handlers (bridge + clob + data + gamma)", () => {
  it("handler for every manifest toolId", () => {
    const keys = new Set(Object.keys(POLYMARKET_HANDLERS));
    const missing = POLYMARKET_TOOLS.map(t => t.toolId).filter(id => !keys.has(id));
    expect(missing).toEqual([]);
  });

  it("no extra handlers", () => {
    const ids = new Set(POLYMARKET_TOOLS.map(t => t.toolId));
    expect(Object.keys(POLYMARKET_HANDLERS).filter(k => !ids.has(k))).toEqual([]);
  });

  it("handler count matches manifest (79)", () => {
    expect(Object.keys(POLYMARKET_HANDLERS)).toHaveLength(79);
  });

  it("every handler is a function", () => {
    for (const [, h] of Object.entries(POLYMARKET_HANDLERS)) expect(typeof h).toBe("function");
  });

  // Bridge param validation
  it("bridge.deposit fails without address", async () => {
    const r = await POLYMARKET_HANDLERS["polymarket.bridge.deposit"]!({}, { sessionPermission: "restricted", approved: false });
    expect(r.success).toBe(false); expect(r.output).toContain("address");
  });
  it("bridge.quote fails without params", async () => {
    const r = await POLYMARKET_HANDLERS["polymarket.bridge.quote"]!({}, { sessionPermission: "restricted", approved: false });
    expect(r.success).toBe(false); expect(r.output).toContain("fromAmountBaseUnit");
  });
  it("bridge.status fails without address", async () => {
    const r = await POLYMARKET_HANDLERS["polymarket.bridge.status"]!({}, { sessionPermission: "restricted", approved: false });
    expect(r.success).toBe(false); expect(r.output).toContain("address");
  });

  // CLOB market data param validation
  it("clob.orderbook fails without tokenId", async () => {
    const r = await POLYMARKET_HANDLERS["polymarket.clob.orderbook"]!({}, { sessionPermission: "restricted", approved: false });
    expect(r.success).toBe(false); expect(r.output).toContain("tokenId");
  });
  it("clob.price fails without tokenId/side", async () => {
    const r = await POLYMARKET_HANDLERS["polymarket.clob.price"]!({}, { sessionPermission: "restricted", approved: false });
    expect(r.success).toBe(false); expect(r.output).toContain("tokenId");
  });
  it("clob.prices fails without tokenIds/sides", async () => {
    const r = await POLYMARKET_HANDLERS["polymarket.clob.prices"]!({}, { sessionPermission: "restricted", approved: false });
    expect(r.success).toBe(false); expect(r.output).toContain("tokenIds");
  });
  it("clob.midpoint fails without tokenId", async () => {
    const r = await POLYMARKET_HANDLERS["polymarket.clob.midpoint"]!({}, { sessionPermission: "restricted", approved: false });
    expect(r.success).toBe(false); expect(r.output).toContain("tokenId");
  });
  it("clob.spread fails without tokenId", async () => {
    const r = await POLYMARKET_HANDLERS["polymarket.clob.spread"]!({}, { sessionPermission: "restricted", approved: false });
    expect(r.success).toBe(false); expect(r.output).toContain("tokenId");
  });
  it("clob.lastTrade fails without tokenId", async () => {
    const r = await POLYMARKET_HANDLERS["polymarket.clob.lastTrade"]!({}, { sessionPermission: "restricted", approved: false });
    expect(r.success).toBe(false); expect(r.output).toContain("tokenId");
  });
  it("clob.priceHistory fails without market", async () => {
    const r = await POLYMARKET_HANDLERS["polymarket.clob.priceHistory"]!({}, { sessionPermission: "restricted", approved: false });
    expect(r.success).toBe(false); expect(r.output).toContain("market");
  });
  it("clob.tickSize fails without tokenId", async () => {
    const r = await POLYMARKET_HANDLERS["polymarket.clob.tickSize"]!({}, { sessionPermission: "restricted", approved: false });
    expect(r.success).toBe(false); expect(r.output).toContain("tokenId");
  });
  it("clob.feeRate fails without tokenId", async () => {
    const r = await POLYMARKET_HANDLERS["polymarket.clob.feeRate"]!({}, { sessionPermission: "restricted", approved: false });
    expect(r.success).toBe(false); expect(r.output).toContain("tokenId");
  });

  // CLOB trading param validation
  it("clob.buy fails without required", async () => {
    const r = await POLYMARKET_HANDLERS["polymarket.clob.buy"]!({}, { sessionPermission: "restricted", approved: false });
    expect(r.success).toBe(false); expect(r.output).toContain("conditionId");
  });
  it("clob.sell fails without required", async () => {
    const r = await POLYMARKET_HANDLERS["polymarket.clob.sell"]!({}, { sessionPermission: "restricted", approved: false });
    expect(r.success).toBe(false); expect(r.output).toContain("conditionId");
  });
  it("clob.cancel fails without orderId", async () => {
    const r = await POLYMARKET_HANDLERS["polymarket.clob.cancel"]!({}, { sessionPermission: "restricted", approved: false });
    expect(r.success).toBe(false); expect(r.output).toContain("orderId");
  });
  it("clob.cancelOrders fails without orderIds", async () => {
    const r = await POLYMARKET_HANDLERS["polymarket.clob.cancelOrders"]!({}, { sessionPermission: "restricted", approved: false });
    expect(r.success).toBe(false); expect(r.output).toContain("orderIds");
  });
  it("clob.cancelMarket fails without market/assetId", async () => {
    const r = await POLYMARKET_HANDLERS["polymarket.clob.cancelMarket"]!({}, { sessionPermission: "restricted", approved: false });
    expect(r.success).toBe(false); expect(r.output).toContain("market");
  });
  it("clob.order fails without orderId", async () => {
    const r = await POLYMARKET_HANDLERS["polymarket.clob.order"]!({}, { sessionPermission: "restricted", approved: false });
    expect(r.success).toBe(false); expect(r.output).toContain("orderId");
  });
  it("clob.orderScoring fails without orderId", async () => {
    const r = await POLYMARKET_HANDLERS["polymarket.clob.orderScoring"]!({}, { sessionPermission: "restricted", approved: false });
    expect(r.success).toBe(false); expect(r.output).toContain("orderId");
  });

  // Data param validation
  it("data.positions fails without user", async () => {
    const r = await POLYMARKET_HANDLERS["polymarket.data.positions"]!({}, { sessionPermission: "restricted", approved: false });
    expect(r.success).toBe(false); expect(r.output).toContain("user");
  });
  it("data.closedPositions fails without user", async () => {
    const r = await POLYMARKET_HANDLERS["polymarket.data.closedPositions"]!({}, { sessionPermission: "restricted", approved: false });
    expect(r.success).toBe(false); expect(r.output).toContain("user");
  });
  it("data.activity fails without user", async () => {
    const r = await POLYMARKET_HANDLERS["polymarket.data.activity"]!({}, { sessionPermission: "restricted", approved: false });
    expect(r.success).toBe(false); expect(r.output).toContain("user");
  });
  it("data.value fails without user", async () => {
    const r = await POLYMARKET_HANDLERS["polymarket.data.value"]!({}, { sessionPermission: "restricted", approved: false });
    expect(r.success).toBe(false); expect(r.output).toContain("user");
  });
  it("data.traded fails without user", async () => {
    const r = await POLYMARKET_HANDLERS["polymarket.data.traded"]!({}, { sessionPermission: "restricted", approved: false });
    expect(r.success).toBe(false); expect(r.output).toContain("user");
  });
  it("data.holders fails without market", async () => {
    const r = await POLYMARKET_HANDLERS["polymarket.data.holders"]!({}, { sessionPermission: "restricted", approved: false });
    expect(r.success).toBe(false); expect(r.output).toContain("market");
  });
  it("data.liveVolume fails without eventId", async () => {
    const r = await POLYMARKET_HANDLERS["polymarket.data.liveVolume"]!({}, { sessionPermission: "restricted", approved: false });
    expect(r.success).toBe(false); expect(r.output).toContain("eventId");
  });
  it("data.marketPositions fails without market", async () => {
    const r = await POLYMARKET_HANDLERS["polymarket.data.marketPositions"]!({}, { sessionPermission: "restricted", approved: false });
    expect(r.success).toBe(false); expect(r.output).toContain("market");
  });
  it("data.accountingSnapshot fails without user", async () => {
    const r = await POLYMARKET_HANDLERS["polymarket.data.accountingSnapshot"]!({}, { sessionPermission: "restricted", approved: false });
    expect(r.success).toBe(false); expect(r.output).toContain("user");
  });

  // Gamma param validation
  it("gamma.event fails without id", async () => {
    const r = await POLYMARKET_HANDLERS["polymarket.gamma.event"]!({}, { sessionPermission: "restricted", approved: false });
    expect(r.success).toBe(false); expect(r.output).toContain("id");
  });
  it("gamma.eventBySlug fails without slug", async () => {
    const r = await POLYMARKET_HANDLERS["polymarket.gamma.eventBySlug"]!({}, { sessionPermission: "restricted", approved: false });
    expect(r.success).toBe(false); expect(r.output).toContain("slug");
  });
  it("gamma.market fails without id", async () => {
    const r = await POLYMARKET_HANDLERS["polymarket.gamma.market"]!({}, { sessionPermission: "restricted", approved: false });
    expect(r.success).toBe(false); expect(r.output).toContain("id");
  });
  it("gamma.search fails without query", async () => {
    const r = await POLYMARKET_HANDLERS["polymarket.gamma.search"]!({}, { sessionPermission: "restricted", approved: false });
    expect(r.success).toBe(false); expect(r.output).toContain("query");
  });
  it("gamma.tag fails without id", async () => {
    const r = await POLYMARKET_HANDLERS["polymarket.gamma.tag"]!({}, { sessionPermission: "restricted", approved: false });
    expect(r.success).toBe(false); expect(r.output).toContain("id");
  });
  it("gamma.seriesById fails without id", async () => {
    const r = await POLYMARKET_HANDLERS["polymarket.gamma.seriesById"]!({}, { sessionPermission: "restricted", approved: false });
    expect(r.success).toBe(false); expect(r.output).toContain("id");
  });
  it("gamma.comment fails without id", async () => {
    const r = await POLYMARKET_HANDLERS["polymarket.gamma.comment"]!({}, { sessionPermission: "restricted", approved: false });
    expect(r.success).toBe(false); expect(r.output).toContain("id");
  });
  it("gamma.comments rejects parentEntityId without parentEntityType (R10)", async () => {
    const r = await POLYMARKET_HANDLERS["polymarket.gamma.comments"]!(
      { parentEntityId: 12345 },
      { sessionPermission: "restricted", approved: false },
    );
    expect(r.success).toBe(false);
    expect(r.output).toContain("parentEntityType");
  });

  it("gamma.commentsByUser fails without address", async () => {
    const r = await POLYMARKET_HANDLERS["polymarket.gamma.commentsByUser"]!({}, { sessionPermission: "restricted", approved: false });
    expect(r.success).toBe(false); expect(r.output).toContain("address");
  });
  it("gamma.profile fails without address", async () => {
    const r = await POLYMARKET_HANDLERS["polymarket.gamma.profile"]!({}, { sessionPermission: "restricted", approved: false });
    expect(r.success).toBe(false); expect(r.output).toContain("address");
  });

  // Live read-only
  it("bridge.assets returns data", async () => {
    const r = await POLYMARKET_HANDLERS["polymarket.bridge.assets"]!({}, { sessionPermission: "restricted", approved: false });
    expect(r.success).toBe(true);
    const d = JSON.parse(r.output);
    expect(typeof d.count).toBe("number");
  });
});

// ── Money-moving output shaping + correctness guards (W2 / P1-10) ──────────────
describe("polymarket clob.buy output shaping (filled flag)", () => {
  const BUY_PARAMS = { conditionId: "0xCOND", outcome: "YES", amount: 10, price: 0.5 };

  it("sets filled=true and surfaces order fields when status is matched", async () => {
    mockPostOrder.mockResolvedValue({
      success: true,
      orderID: "0xORDER",
      status: "matched",
      makingAmount: "5000000",
      takingAmount: "10000000",
      transactionsHashes: ["0xtx"],
      tradeIDs: ["t1"],
      errorMsg: "",
    });
    const r = await POLYMARKET_HANDLERS["polymarket.clob.buy"]!(BUY_PARAMS, SIGNING_CTX);
    expect(r.success).toBe(true);
    const out = JSON.parse(r.output);
    expect(out.filled).toBe(true);
    expect(out.orderID).toBe("0xORDER");
    expect(out.status).toBe("matched");
    expect(out.conditionId).toBe("0xCOND");
    expect(out.outcome).toBe("YES");
    expect(out.amount).toBe(10);
    expect(out.price).toBe(0.5);
    expect(out.transactionsHashes).toEqual(["0xtx"]);
    // Empty errorMsg must be dropped from the lean output.
    expect("errorMsg" in out).toBe(false);
  });

  it("sets filled=false for a live (resting) order", async () => {
    mockPostOrder.mockResolvedValue({
      success: true,
      orderID: "0xLIVE",
      status: "live",
      errorMsg: "",
    });
    const r = await POLYMARKET_HANDLERS["polymarket.clob.buy"]!(BUY_PARAMS, SIGNING_CTX);
    const out = JSON.parse(r.output);
    expect(out.filled).toBe(false);
    expect(out.status).toBe("live");
    expect("errorMsg" in out).toBe(false);
  });

  it("preserves a non-empty errorMsg in the lean output", async () => {
    mockPostOrder.mockResolvedValue({
      success: false,
      orderID: "",
      status: "live",
      errorMsg: "order rejected",
    });
    const r = await POLYMARKET_HANDLERS["polymarket.clob.buy"]!(BUY_PARAMS, SIGNING_CTX);
    const out = JSON.parse(r.output);
    expect(out.errorMsg).toBe("order rejected");
    expect(out.filled).toBe(false);
  });
});

describe("polymarket clob.sell output shaping (lean, P1-10)", () => {
  const SELL_PARAMS = { conditionId: "0xCOND", outcome: "YES", amount: 8, price: 0.4 };

  it("emits a lean output with filled flag and drops empty errorMsg when matched", async () => {
    mockPostOrder.mockResolvedValue({
      success: true,
      orderID: "0xSELLORDER",
      status: "matched",
      makingAmount: "3200000",
      takingAmount: "8000000",
      errorMsg: "",
    });
    const r = await POLYMARKET_HANDLERS["polymarket.clob.sell"]!(SELL_PARAMS, SIGNING_CTX);
    expect(r.success).toBe(true);
    const out = JSON.parse(r.output);
    expect(out.filled).toBe(true);
    expect(out.orderID).toBe("0xSELLORDER");
    expect(out.status).toBe("matched");
    expect(out.conditionId).toBe("0xCOND");
    expect(out.outcome).toBe("YES");
    expect(out.amount).toBe(8);
    expect(out.price).toBe(0.4);
    expect(out.makingAmount).toBe("3200000");
    // Empty errorMsg must be dropped from the lean output (was emitted before P1-10).
    expect("errorMsg" in out).toBe(false);
    // _tradeCapture stays intact on data (raw, unchanged).
    expect(r.data?._tradeCapture).toBeDefined();
  });

  it("sets filled=false for a live (resting) sell order", async () => {
    mockPostOrder.mockResolvedValue({
      success: true,
      orderID: "0xSELLLIVE",
      status: "live",
      errorMsg: "",
    });
    const r = await POLYMARKET_HANDLERS["polymarket.clob.sell"]!(SELL_PARAMS, SIGNING_CTX);
    const out = JSON.parse(r.output);
    expect(out.filled).toBe(false);
    expect(out.status).toBe("live");
    expect("errorMsg" in out).toBe(false);
  });
});

describe("polymarket clob.cancel partial-cancel correctness guard", () => {
  it("reports success=false when the requested order lands in not_canceled", async () => {
    mockCancelOrder.mockResolvedValue({ canceled: [], not_canceled: { "0xORDER": "order not found" } });
    const r = await POLYMARKET_HANDLERS["polymarket.clob.cancel"]!({ orderId: "0xORDER" }, SIGNING_CTX);
    expect(r.success).toBe(false);
    const out = JSON.parse(r.output);
    expect(out.cancelled).toBe(false);
    expect(out.reason).toBe("order not found");
    // Failed cancels must NOT emit a "cancelled" trade-capture.
    expect(r.data?._tradeCapture).toBeUndefined();
  });

  it("reports success=true when the order is actually cancelled", async () => {
    mockCancelOrder.mockResolvedValue({ canceled: ["0xORDER"], not_canceled: {} });
    const r = await POLYMARKET_HANDLERS["polymarket.clob.cancel"]!({ orderId: "0xORDER" }, SIGNING_CTX);
    expect(r.success).toBe(true);
    const out = JSON.parse(r.output);
    expect(out.cancelled).toBe(true);
    expect(r.data?._tradeCapture).toBeDefined();
  });
});

describe("polymarket bridge empty-address guards (money-moving)", () => {
  it("deposit fails on empty address before any bridge API call", async () => {
    const r = await POLYMARKET_HANDLERS["polymarket.bridge.deposit"]!({ address: "" }, SIGNING_CTX);
    expect(r.success).toBe(false);
    expect(r.output).toContain("address");
  });

  it("withdraw fails on empty address even when other fields are present", async () => {
    const r = await POLYMARKET_HANDLERS["polymarket.bridge.withdraw"]!(
      { address: "", toChainId: "137", toTokenAddress: "0xTOKEN", recipientAddr: "0xRECIP" },
      SIGNING_CTX,
    );
    expect(r.success).toBe(false);
    expect(r.output).toContain("address");
  });
});
