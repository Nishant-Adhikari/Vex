import { describe, expect, it } from "vitest";
import { formatPairRow, PAIR_COLUMNS } from "@commands/dexscreener/helpers.js";
import type { DexPair } from "@tools/dexscreener/types.js";

const FULL_PAIR: DexPair = {
  chainId: "solana",
  dexId: "raydium",
  url: "https://dexscreener.com/solana/58oQ",
  pairAddress: "58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2",
  labels: ["v2"],
  baseToken: { address: "So111", name: "Wrapped SOL", symbol: "SOL" },
  quoteToken: { address: "EPjF", name: "USD Coin", symbol: "USDC" },
  priceNative: "1.0",
  priceUsd: "152.34",
  txns: { h24: { buys: 1234, sells: 567 } },
  volume: { h24: 1234567.89, h6: 345678.12 },
  priceChange: { h24: 2.5, h6: -0.3 },
  liquidity: { usd: 5678901.23, base: 37000, quote: 5600000 },
  fdv: 89000000000,
  marketCap: 67000000000,
  pairCreatedAt: 1672531200000,
  info: null,
  boosts: null,
};

describe("PAIR_COLUMNS", () => {
  it("has 7 columns with expected headers", () => {
    expect(PAIR_COLUMNS).toHaveLength(7);
    const headers = PAIR_COLUMNS.map((c) => c.header);
    expect(headers).toEqual(["Pair", "Chain", "DEX", "Price USD", "Vol 24h", "Liq USD", "Chg 24h"]);
  });
});

describe("formatPairRow", () => {
  it("formats complete pair data", () => {
    const row = formatPairRow(FULL_PAIR);
    expect(row).toHaveLength(7);
    expect(row[0]).toBe("SOL/USDC");
    expect(row[1]).toBe("solana");
    expect(row[2]).toBe("raydium");
    expect(row[3]).toContain("152.34");
    expect(row[4]).toContain("1.23M");
    expect(row[5]).toContain("5.68M");
    // h24 change is positive
    expect(row[6]).toContain("+2.50%");
  });

  it("handles missing optional fields gracefully", () => {
    const minimal: DexPair = {
      ...FULL_PAIR,
      priceUsd: null,
      priceChange: null,
      liquidity: null,
      quoteToken: { address: null, name: null, symbol: null },
    };
    const row = formatPairRow(minimal);
    expect(row[0]).toBe("SOL/?");
    expect(row[3]).toBe("-");
    expect(row[5]).toBe("-");
    expect(row[6]).toBe("-");
  });

  it("formats small volumes with K suffix", () => {
    const pair: DexPair = { ...FULL_PAIR, volume: { h24: 5678, h6: 100 } };
    const row = formatPairRow(pair);
    expect(row[4]).toContain("5.68K");
  });

  it("formats very large volumes with B suffix", () => {
    const pair: DexPair = { ...FULL_PAIR, volume: { h24: 2500000000 } };
    const row = formatPairRow(pair);
    expect(row[4]).toContain("2.50B");
  });

  it("formats negative price change", () => {
    const pair: DexPair = { ...FULL_PAIR, priceChange: { h24: -5.75 } };
    const row = formatPairRow(pair);
    expect(row[6]).toContain("-5.75%");
  });
});
