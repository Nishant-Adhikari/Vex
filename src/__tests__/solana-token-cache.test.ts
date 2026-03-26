import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const testDir = join(tmpdir(), `echo-cache-test-${Date.now()}`);
const testCacheFile = join(testDir, "solana-token-cache.json");

vi.mock("../config/paths.js", () => ({
  SOLANA_TOKEN_CACHE_FILE: testCacheFile,
}));
vi.mock("../config/store.js", () => ({
  ensureConfigDir: () => { if (!existsSync(testDir)) mkdirSync(testDir, { recursive: true }); },
}));

const { loadTokenCache, saveTokenCache, getCachedToken, cacheTokens } =
  await import("../tools/chains/solana/token-cache.js");

describe("token cache", () => {
  beforeEach(() => {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true });
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true });
  });

  it("returns empty cache when file does not exist", () => {
    const cache = loadTokenCache();
    expect(cache.version).toBe(1);
    expect(Object.keys(cache.tokens)).toHaveLength(0);
  });

  it("saves and loads cache", () => {
    cacheTokens([{ chain: "solana", address: "mint1", symbol: "TST", name: "Test", decimals: 6 }]);

    const cache = loadTokenCache();
    expect(cache.tokens.mint1).toBeDefined();
    expect(cache.tokens.mint1.meta.symbol).toBe("TST");
  });

  it("getCachedToken returns by mint address", () => {
    cacheTokens([{ chain: "solana", address: "mint1", symbol: "TST", name: "Test", decimals: 6 }]);

    const token = getCachedToken("mint1");
    expect(token).toBeDefined();
    expect(token!.symbol).toBe("TST");
  });

  it("getCachedToken returns by symbol (case-insensitive)", () => {
    cacheTokens([{ chain: "solana", address: "mint1", symbol: "TST", name: "Test", decimals: 6 }]);

    expect(getCachedToken("tst")).toBeDefined();
    expect(getCachedToken("TST")).toBeDefined();
  });

  it("getCachedToken returns undefined for unknown token", () => {
    expect(getCachedToken("NOPE")).toBeUndefined();
  });

  it("respects 24h TTL — stale entries return undefined", () => {
    // Write cache with old timestamp
    const cache = loadTokenCache();
    cache.tokens.old = {
      meta: { chain: "solana", address: "old", symbol: "OLD", name: "Old", decimals: 6 },
      updatedAt: Date.now() - 25 * 60 * 60 * 1000, // 25h ago
    };
    saveTokenCache(cache);

    expect(getCachedToken("old")).toBeUndefined();
    expect(getCachedToken("OLD")).toBeUndefined();
  });

  it("fresh entries within TTL are returned", () => {
    cacheTokens([{ chain: "solana", address: "fresh", symbol: "FRESH", name: "Fresh", decimals: 9 }]);

    expect(getCachedToken("fresh")).toBeDefined();
    expect(getCachedToken("FRESH")!.decimals).toBe(9);
  });

  it("cacheTokens overwrites existing entries", () => {
    cacheTokens([{ chain: "solana", address: "m1", symbol: "V1", name: "V1", decimals: 6 }]);
    cacheTokens([{ chain: "solana", address: "m1", symbol: "V2", name: "V2", decimals: 9 }]);

    const token = getCachedToken("m1");
    expect(token!.symbol).toBe("V2");
    expect(token!.decimals).toBe(9);
  });
});
