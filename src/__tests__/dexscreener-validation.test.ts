import { describe, expect, it } from "vitest";
import {
  validatePairsResponse,
  validateSearchResponse,
  validateTokensResponse,
  validateTokensPairsResponse,
  validateProfilesResponse,
  validateBoostsResponse,
  validateOrdersResponse,
  validateWsHandshake,
  validateWsProfile,
  validateWsBoost,
} from "../dexscreener/validation.js";

// ── Fixtures ────────────────────────────────────────────────────────

const FIXTURE_PAIR = {
  chainId: "solana",
  dexId: "raydium",
  url: "https://dexscreener.com/solana/58oQ",
  pairAddress: "58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2",
  labels: ["v2"],
  baseToken: { address: "So111", name: "Wrapped SOL", symbol: "SOL" },
  quoteToken: { address: "EPjF", name: "USD Coin", symbol: "USDC" },
  priceNative: "1.0",
  priceUsd: "152.34",
  txns: { h24: { buys: 1234, sells: 567 }, m5: { buys: 10, sells: 5 } },
  volume: { h24: 1234567.89, h6: 345678.12 },
  priceChange: { h24: 2.5, h6: -0.3 },
  liquidity: { usd: 5678901.23, base: 37000, quote: 5600000 },
  fdv: 89000000000,
  marketCap: 67000000000,
  pairCreatedAt: 1672531200000,
  info: {
    imageUrl: "https://img.dexscreener.com/test.png",
    websites: [{ url: "https://solana.com" }],
    socials: [{ platform: "twitter", handle: "solana" }],
  },
  boosts: { active: 5 },
};

const FIXTURE_PROFILE = {
  url: "https://dexscreener.com/solana/abc",
  chainId: "solana",
  tokenAddress: "So111111111111111111111111111111111111112",
  icon: "https://img.dexscreener.com/icon.png",
  header: "https://img.dexscreener.com/header.png",
  description: "A test token",
  links: [{ type: "website", label: "Website", url: "https://example.com" }],
};

const FIXTURE_BOOST = {
  url: "https://dexscreener.com/solana/abc",
  chainId: "solana",
  tokenAddress: "So111111111111111111111111111111111111112",
  amount: 100,
  totalAmount: 500,
  icon: "https://img.dexscreener.com/icon.png",
  header: null,
  description: "Boosted token",
  links: null,
};

const FIXTURE_ORDER = {
  type: "tokenProfile",
  status: "approved",
  paymentTimestamp: 1700000000,
};

// ── validatePairsResponse ───────────────────────────────────────────

describe("validatePairsResponse", () => {
  it("parses valid pairs response", () => {
    const result = validatePairsResponse({ schemaVersion: "1.0.0", pairs: [FIXTURE_PAIR] });
    expect(result.schemaVersion).toBe("1.0.0");
    expect(result.pairs).toHaveLength(1);
    expect(result.pairs![0].chainId).toBe("solana");
    expect(result.pairs![0].baseToken.symbol).toBe("SOL");
    expect(result.pairs![0].volume.h24).toBe(1234567.89);
  });

  it("accepts null pairs", () => {
    const result = validatePairsResponse({ schemaVersion: "1.0.0", pairs: null });
    expect(result.pairs).toBeNull();
  });

  it("rejects non-object input", () => {
    expect(() => validatePairsResponse("not-an-object")).toThrow();
    expect(() => validatePairsResponse(null)).toThrow();
    expect(() => validatePairsResponse(42)).toThrow();
  });

  it("parses pair with missing optional fields", () => {
    const minimal = {
      ...FIXTURE_PAIR,
      priceUsd: null,
      priceChange: null,
      liquidity: null,
      fdv: null,
      marketCap: null,
      pairCreatedAt: null,
      info: null,
      boosts: null,
      labels: null,
    };
    const result = validatePairsResponse({ schemaVersion: "1.0.0", pairs: [minimal] });
    expect(result.pairs![0].priceUsd).toBeNull();
    expect(result.pairs![0].liquidity).toBeNull();
    expect(result.pairs![0].info).toBeNull();
  });
});

// ── validateSearchResponse ──────────────────────────────────────────

describe("validateSearchResponse", () => {
  it("parses valid search response", () => {
    const result = validateSearchResponse({ schemaVersion: "1.0.0", pairs: [FIXTURE_PAIR] });
    expect(result.pairs).toHaveLength(1);
    expect(result.pairs[0].dexId).toBe("raydium");
  });

  it("returns empty array when no pairs", () => {
    const result = validateSearchResponse({ schemaVersion: "1.0.0", pairs: [] });
    expect(result.pairs).toHaveLength(0);
  });

  it("rejects non-object input", () => {
    expect(() => validateSearchResponse(null)).toThrow();
    expect(() => validateSearchResponse([])).toThrow();
  });
});

// ── validateTokensResponse ──────────────────────────────────────────

describe("validateTokensResponse", () => {
  it("parses valid token array", () => {
    const result = validateTokensResponse([FIXTURE_PAIR]);
    expect(result).toHaveLength(1);
    expect(result[0].pairAddress).toBe(FIXTURE_PAIR.pairAddress);
  });

  it("parses empty array", () => {
    expect(validateTokensResponse([])).toHaveLength(0);
  });

  it("rejects non-array input", () => {
    expect(() => validateTokensResponse("not-array")).toThrow();
    expect(() => validateTokensResponse(null)).toThrow();
    expect(() => validateTokensResponse({})).toThrow();
  });
});

// ── validateTokensPairsResponse ─────────────────────────────────────

describe("validateTokensPairsResponse", () => {
  it("parses valid token-pairs array", () => {
    const result = validateTokensPairsResponse([FIXTURE_PAIR]);
    expect(result).toHaveLength(1);
  });

  it("rejects non-array input", () => {
    expect(() => validateTokensPairsResponse(null)).toThrow();
    expect(() => validateTokensPairsResponse({})).toThrow();
  });
});

// ── validateProfilesResponse ────────────────────────────────────────

describe("validateProfilesResponse", () => {
  it("parses valid profiles array", () => {
    const result = validateProfilesResponse([FIXTURE_PROFILE]);
    expect(result).toHaveLength(1);
    expect(result[0].chainId).toBe("solana");
    expect(result[0].icon).toContain("icon.png");
    expect(result[0].links).toHaveLength(1);
  });

  it("handles profile with null optional fields", () => {
    const minimal = { ...FIXTURE_PROFILE, header: null, description: null, links: null };
    const result = validateProfilesResponse([minimal]);
    expect(result[0].header).toBeNull();
    expect(result[0].description).toBeNull();
    expect(result[0].links).toBeNull();
  });

  it("rejects non-array input", () => {
    expect(() => validateProfilesResponse(null)).toThrow();
    expect(() => validateProfilesResponse({})).toThrow();
  });
});

// ── validateBoostsResponse ──────────────────────────────────────────

describe("validateBoostsResponse", () => {
  it("parses valid boosts array", () => {
    const result = validateBoostsResponse([FIXTURE_BOOST]);
    expect(result).toHaveLength(1);
    expect(result[0].amount).toBe(100);
    expect(result[0].totalAmount).toBe(500);
  });

  it("rejects boost with missing amount", () => {
    const bad = { ...FIXTURE_BOOST, amount: "not-a-number" };
    expect(() => validateBoostsResponse([bad])).toThrow();
  });

  it("rejects non-array input", () => {
    expect(() => validateBoostsResponse(null)).toThrow();
  });
});

// ── validateOrdersResponse ──────────────────────────────────────────

describe("validateOrdersResponse", () => {
  it("parses valid orders array", () => {
    const result = validateOrdersResponse([FIXTURE_ORDER]);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("tokenProfile");
    expect(result[0].status).toBe("approved");
    expect(result[0].paymentTimestamp).toBe(1700000000);
  });

  it("parses empty orders", () => {
    expect(validateOrdersResponse([])).toHaveLength(0);
  });

  it("rejects non-array input", () => {
    expect(() => validateOrdersResponse(null)).toThrow();
    expect(() => validateOrdersResponse({})).toThrow();
  });

  it("rejects order with missing fields", () => {
    expect(() => validateOrdersResponse([{ type: "tokenProfile" }])).toThrow();
  });
});

// ── validateWsHandshake ─────────────────────────────────────────────

describe("validateWsHandshake", () => {
  it("parses valid handshake with profile items", () => {
    const raw = { limit: 50, data: [FIXTURE_PROFILE] };
    const result = validateWsHandshake(raw, validateWsProfile);
    expect(result.limit).toBe(50);
    expect(result.data).toHaveLength(1);
    expect(result.data[0].chainId).toBe("solana");
  });

  it("parses valid handshake with boost items", () => {
    const raw = { limit: 100, data: [FIXTURE_BOOST] };
    const result = validateWsHandshake(raw, validateWsBoost);
    expect(result.limit).toBe(100);
    expect(result.data).toHaveLength(1);
    expect(result.data[0].amount).toBe(100);
  });

  it("handles missing data gracefully", () => {
    const raw = { limit: 50 };
    const result = validateWsHandshake(raw, validateWsProfile);
    expect(result.data).toHaveLength(0);
  });

  it("rejects non-object input", () => {
    expect(() => validateWsHandshake(null, validateWsProfile)).toThrow();
    expect(() => validateWsHandshake("string", validateWsProfile)).toThrow();
  });
});

// ── Pair nested field parsing ───────────────────────────────────────

describe("pair nested fields", () => {
  it("parses txns correctly", () => {
    const result = validateTokensResponse([FIXTURE_PAIR]);
    expect(result[0].txns.h24.buys).toBe(1234);
    expect(result[0].txns.h24.sells).toBe(567);
    expect(result[0].txns.m5.buys).toBe(10);
  });

  it("parses liquidity correctly", () => {
    const result = validateTokensResponse([FIXTURE_PAIR]);
    expect(result[0].liquidity!.usd).toBe(5678901.23);
    expect(result[0].liquidity!.base).toBe(37000);
  });

  it("parses info with socials and websites", () => {
    const result = validateTokensResponse([FIXTURE_PAIR]);
    expect(result[0].info!.socials).toHaveLength(1);
    expect(result[0].info!.socials![0].platform).toBe("twitter");
    expect(result[0].info!.websites).toHaveLength(1);
  });

  it("handles missing quoteToken fields gracefully", () => {
    const pair = { ...FIXTURE_PAIR, quoteToken: { address: null, name: null, symbol: null } };
    const result = validateTokensResponse([pair]);
    expect(result[0].quoteToken.address).toBeNull();
    expect(result[0].quoteToken.name).toBeNull();
  });
});
