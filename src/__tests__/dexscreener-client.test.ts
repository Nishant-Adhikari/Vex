import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DexScreenerClient } from "../tools/dexscreener/client.js";
import { ErrorCodes } from "../errors.js";

vi.mock("../config/store.js", () => ({
  loadConfig: () => ({ services: { dexScreenerApiUrl: "https://api.dexscreener.com" } }),
}));

vi.mock("../utils/logger.js", () => ({
  default: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ── Fixtures ────────────────────────────────────────────────────────

const FIXTURE_PAIR = {
  chainId: "solana",
  dexId: "raydium",
  url: "https://dexscreener.com/solana/58oQ",
  pairAddress: "58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2",
  labels: null,
  baseToken: { address: "So111", name: "Wrapped SOL", symbol: "SOL" },
  quoteToken: { address: "EPjF", name: "USD Coin", symbol: "USDC" },
  priceNative: "1.0",
  priceUsd: "152.34",
  txns: { h24: { buys: 100, sells: 50 } },
  volume: { h24: 500000 },
  priceChange: { h24: 1.5 },
  liquidity: { usd: 1000000, base: 6500, quote: 1000000 },
  fdv: 80000000000,
  marketCap: 65000000000,
  pairCreatedAt: 1672531200000,
  info: null,
  boosts: null,
};

const FIXTURE_PROFILE = {
  url: "https://dexscreener.com/solana/abc",
  chainId: "solana",
  tokenAddress: "So111",
  icon: "https://img.dexscreener.com/icon.png",
  header: null,
  description: "Test token",
  links: null,
};

const FIXTURE_BOOST = {
  url: "https://dexscreener.com/solana/abc",
  chainId: "solana",
  tokenAddress: "So111",
  amount: 50,
  totalAmount: 200,
  icon: null,
  header: null,
  description: null,
  links: null,
};

const FIXTURE_ORDER = {
  type: "tokenProfile",
  status: "approved",
  paymentTimestamp: 1700000000,
};

// ── Setup ───────────────────────────────────────────────────────────

const originalFetch = globalThis.fetch;
let client: DexScreenerClient;

beforeEach(() => {
  globalThis.fetch = vi.fn();
  client = new DexScreenerClient("https://api.dexscreener.com");
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function mockOk(data: unknown) {
  (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
    ok: true,
    json: async () => data,
  });
}

function mockError(status: number, body?: unknown) {
  (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
    ok: false,
    status,
    json: async () => body ?? null,
  });
}

function lastFetchUrl(): string {
  const calls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls;
  return calls[calls.length - 1][0] as string;
}

// ── search ──────────────────────────────────────────────────────────

describe("search", () => {
  it("sends correct URL with query param", async () => {
    mockOk({ schemaVersion: "1.0.0", pairs: [FIXTURE_PAIR] });
    await client.search("SOL/USDC");
    expect(lastFetchUrl()).toContain("/latest/dex/search");
    expect(lastFetchUrl()).toContain("q=SOL%2FUSDC");
  });

  it("parses search results", async () => {
    mockOk({ schemaVersion: "1.0.0", pairs: [FIXTURE_PAIR] });
    const result = await client.search("SOL");
    expect(result.pairs).toHaveLength(1);
    expect(result.pairs[0].baseToken.symbol).toBe("SOL");
  });
});

// ── getPairs ────────────────────────────────────────────────────────

describe("getPairs", () => {
  it("sends correct URL path", async () => {
    mockOk({ schemaVersion: "1.0.0", pairs: [FIXTURE_PAIR] });
    await client.getPairs("solana", "58oQ");
    expect(lastFetchUrl()).toContain("/latest/dex/pairs/solana/58oQ");
  });

  it("parses pair response", async () => {
    mockOk({ schemaVersion: "1.0.0", pairs: [FIXTURE_PAIR] });
    const result = await client.getPairs("solana", "58oQ");
    expect(result.pairs).toHaveLength(1);
    expect(result.pairs![0].priceUsd).toBe("152.34");
  });
});

// ── getTokens ───────────────────────────────────────────────────────

describe("getTokens", () => {
  it("sends correct URL with comma-separated addresses", async () => {
    mockOk([FIXTURE_PAIR]);
    await client.getTokens("solana", "addr1,addr2");
    expect(lastFetchUrl()).toContain("/tokens/v1/solana/addr1%2Caddr2");
  });

  it("parses token array response", async () => {
    mockOk([FIXTURE_PAIR, FIXTURE_PAIR]);
    const result = await client.getTokens("solana", "addr1");
    expect(result).toHaveLength(2);
  });
});

// ── getTokenPairs ───────────────────────────────────────────────────

describe("getTokenPairs", () => {
  it("sends correct URL", async () => {
    mockOk([FIXTURE_PAIR]);
    await client.getTokenPairs("ethereum", "0xabc");
    expect(lastFetchUrl()).toContain("/token-pairs/v1/ethereum/0xabc");
  });

  it("parses response", async () => {
    mockOk([FIXTURE_PAIR]);
    const result = await client.getTokenPairs("solana", "So111");
    expect(result).toHaveLength(1);
  });
});

// ── getProfiles ─────────────────────────────────────────────────────

describe("getProfiles", () => {
  it("fetches from correct endpoint", async () => {
    mockOk([FIXTURE_PROFILE]);
    await client.getProfiles();
    expect(lastFetchUrl()).toContain("/token-profiles/latest/v1");
  });

  it("parses profiles", async () => {
    mockOk([FIXTURE_PROFILE]);
    const result = await client.getProfiles();
    expect(result).toHaveLength(1);
    expect(result[0].chainId).toBe("solana");
  });
});

// ── getBoosts / getTopBoosts ────────────────────────────────────────

describe("getBoosts", () => {
  it("fetches latest boosts", async () => {
    mockOk([FIXTURE_BOOST]);
    await client.getBoosts();
    expect(lastFetchUrl()).toContain("/token-boosts/latest/v1");
  });

  it("parses boosts", async () => {
    mockOk([FIXTURE_BOOST]);
    const result = await client.getBoosts();
    expect(result).toHaveLength(1);
    expect(result[0].totalAmount).toBe(200);
  });
});

describe("getTopBoosts", () => {
  it("fetches top boosts from correct endpoint", async () => {
    mockOk([FIXTURE_BOOST]);
    await client.getTopBoosts();
    expect(lastFetchUrl()).toContain("/token-boosts/top/v1");
  });
});

// ── getOrders ───────────────────────────────────────────────────────

describe("getOrders", () => {
  it("fetches orders for token", async () => {
    mockOk([FIXTURE_ORDER]);
    await client.getOrders("solana", "A55X");
    expect(lastFetchUrl()).toContain("/orders/v1/solana/A55X");
  });

  it("parses orders", async () => {
    mockOk([FIXTURE_ORDER]);
    const result = await client.getOrders("solana", "A55X");
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe("approved");
  });
});

// ── Error handling ──────────────────────────────────────────────────

describe("error handling", () => {
  it("maps 429 to DEXSCREENER_RATE_LIMITED", async () => {
    mockError(429);
    await expect(client.search("test")).rejects.toMatchObject({
      code: ErrorCodes.DEXSCREENER_RATE_LIMITED,
    });
  });

  it("maps 404 to DEXSCREENER_NOT_FOUND", async () => {
    mockError(404);
    await expect(client.getPairs("solana", "bad")).rejects.toMatchObject({
      code: ErrorCodes.DEXSCREENER_NOT_FOUND,
    });
  });

  it("maps 500 to DEXSCREENER_API_ERROR", async () => {
    mockError(500);
    await expect(client.getProfiles()).rejects.toMatchObject({
      code: ErrorCodes.DEXSCREENER_API_ERROR,
    });
  });

  it("maps network failure to DEXSCREENER_API_ERROR", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new TypeError("Failed to fetch"),
    );
    await expect(client.search("test")).rejects.toThrow();
  });
});
