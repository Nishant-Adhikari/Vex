/**
 * Discovery golden harness — measures top-3 retrieval quality on realistic
 * English capability-phrase intents. PR1 baseline (18); PR4 extends to 32.
 *
 * Fixtures stay English-only (message #5: model translates intent to English
 * before calling discover_tools). Polish pipeline lives in
 * discovery-pipeline.test.ts.
 *
 * NOTE: Fixtures whose `expectedAny` targets a 0G-ecosystem (jaine, slop,
 * slop-app, chainscan) or EchoBook tool are marked `disabled: true` because
 * those namespaces are currently unadvertised in discovery. Re-enable when
 * the corresponding `advertised` flags flip back to `true` in
 * src/echo-agent/tools/protocols/navigation/entries-0g.ts.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { discoverProtocolCapabilities } from "../../../echo-agent/tools/protocols/runtime.js";

interface GoldenFixture {
  intent: string;
  expectedAny: readonly string[];
  k?: number;
  includeMutating?: boolean;
  notes?: string;
  /** Skip while target namespace is unadvertised in discovery. */
  disabled?: boolean;
}

const FIXTURES: readonly GoldenFixture[] = [
  // ── namespace-specific ────────────────────────────────────────────
  { intent: "bridge usdc to base", expectedAny: ["khalani.bridge", "khalani.quote"], includeMutating: true },
  { intent: "cross chain token search", expectedAny: ["khalani.tokens"] },
  { intent: "supported bridge chains", expectedAny: ["khalani.chains"] },
  { intent: "swap on base", expectedAny: ["kyberswap.swap"], includeMutating: true },
  { intent: "limit order on ethereum", expectedAny: ["kyberswap.limitOrder"], includeMutating: true },
  { intent: "honeypot token check", expectedAny: ["kyberswap.tokens"] },
  { intent: "swap on solana", expectedAny: ["solana.swap"], includeMutating: true },
  { intent: "solana token search", expectedAny: ["solana.tokens"] },
  { intent: "jupiter price lookup", expectedAny: ["solana.prices"] },
  { intent: "polymarket orderbook", expectedAny: ["polymarket.clob.orderbook", "polymarket.clob.orderbooks"] },
  { intent: "polymarket positions", expectedAny: ["polymarket.data.positions", "polymarket.data.closedPositions"] },
  { intent: "polymarket rewards earnings", expectedAny: ["polymarket.rewards"] },
  { intent: "buy yes on polymarket", expectedAny: ["polymarket.clob.buy", "polymarket.clob"], includeMutating: true },
  { intent: "trending meme tokens", expectedAny: ["dexscreener.trending", "dexscreener.boosts"] },
  { intent: "community takeover", expectedAny: ["dexscreener.communityTakeovers"] },
  { intent: "pair liquidity analytics", expectedAny: ["dexscreener.pairs", "dexscreener.tokens"] },
  { intent: "0g chain explorer", expectedAny: ["chainscan."], disabled: true },
  { intent: "0g block height", expectedAny: ["chainscan.block", "chainscan."], disabled: true },
  { intent: "0g account balance", expectedAny: ["chainscan.account"], disabled: true },
  { intent: "echobook comments thread", expectedAny: ["echobook.comments"], includeMutating: true, disabled: true },
  { intent: "0g social feed", expectedAny: ["echobook.feed", "echobook."], disabled: true },
  { intent: "my slop tokens", expectedAny: ["slop.tokens.mine"], disabled: true },
  { intent: "slop profile image", expectedAny: ["slop-app."], disabled: true },
  { intent: "0g dex swap quote", expectedAny: ["jaine.swap"], includeMutating: true, disabled: true },
  { intent: "wrap w0g", expectedAny: ["jaine.w0g"], includeMutating: true, disabled: true },

  // ── ambiguous / cross-namespace ───────────────────────────────────
  { intent: "wallet token balances", expectedAny: ["khalani.tokens", "solana.tokens", "polymarket.data"] },
  { intent: "prediction market events", expectedAny: ["polymarket.gamma.events", "solana.predict.events"] },
  { intent: "token search", expectedAny: ["khalani.tokens", "solana.tokens", "kyberswap.tokens", "dexscreener.search", "dexscreener.tokens"] },

  // ── param-driven ──────────────────────────────────────────────────
  { intent: "slippage tolerance swap quote", expectedAny: ["kyberswap.swap", "solana.swap"], includeMutating: true },
  { intent: "amount in chain id", expectedAny: ["khalani.quote", "kyberswap.swap"], includeMutating: true },
  { intent: "token address contract info", expectedAny: ["chainscan.", "dexscreener.", "khalani.tokens", "solana.tokens"] },

  // ── read-only default excludes mutating ───────────────────────────
  { intent: "swap on solana", expectedAny: ["solana.swap.quote", "solana.tokens"], includeMutating: false, notes: "without includeMutating, swap.execute excluded — read-side should appear" },
];

describe("discovery golden harness", () => {
  const ENV_KEYS = ["JUPITER_API_KEY", "POLYMARKET_API_KEY"] as const;
  const original: Record<string, string | undefined> = {};

  beforeAll(() => {
    for (const k of ENV_KEYS) original[k] = process.env[k];
    process.env.JUPITER_API_KEY = "test-jupiter-key";
    process.env.POLYMARKET_API_KEY = "test-polymarket-key";
  });

  afterAll(() => {
    for (const k of ENV_KEYS) {
      if (original[k] === undefined) delete process.env[k];
      else process.env[k] = original[k];
    }
  });

  for (const fixture of FIXTURES) {
    const k = fixture.k ?? 3;
    const itFn = fixture.disabled ? it.skip : it;
    itFn(`top-${k} for "${fixture.intent}" contains expected`, () => {
      const result = discoverProtocolCapabilities({
        query: fixture.intent,
        limit: k,
        includeMutating: fixture.includeMutating ?? false,
      });
      const topIds = result.tools.map((t) => t.toolId);
      const hit = fixture.expectedAny.some((expected) =>
        topIds.some((id) => id === expected || id.startsWith(`${expected}.`) || id.startsWith(expected)),
      );
      expect(hit, `topIds=${JSON.stringify(topIds)}`).toBe(true);
    });
  }

  it("baseline summary: top-3 recall across all fixtures", () => {
    // Recall is computed only over enabled fixtures so the threshold remains
    // meaningful while disabled-namespace fixtures are skipped above.
    const activeFixtures = FIXTURES.filter((f) => !f.disabled);
    let hits = 0;
    const misses: string[] = [];
    for (const fixture of activeFixtures) {
      const k = fixture.k ?? 3;
      const result = discoverProtocolCapabilities({
        query: fixture.intent,
        limit: k,
        includeMutating: fixture.includeMutating ?? false,
      });
      const topIds = result.tools.map((t) => t.toolId);
      const hit = fixture.expectedAny.some((expected) =>
        topIds.some((id) => id === expected || id.startsWith(`${expected}.`) || id.startsWith(expected)),
      );
      if (hit) hits += 1;
      else misses.push(`${fixture.intent} -> got ${JSON.stringify(topIds)}`);
    }
    const recall = hits / activeFixtures.length;
    // PR4 floor: 70% (raised from 50% after PR1-3 consistently hit 100%).
    expect(
      recall,
      `top-3 recall ${(recall * 100).toFixed(1)}% (${hits}/${activeFixtures.length}). misses:\n${misses.join("\n")}`,
    ).toBeGreaterThanOrEqual(0.7);
  });
});
