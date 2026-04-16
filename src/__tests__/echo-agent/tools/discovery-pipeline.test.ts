/**
 * Discovery pipeline integration test — verifies that the contract from
 * message #5 holds end-to-end: user speaks Polish → model translates to
 * English capability phrase → discover_tools returns expected tools.
 *
 * The "translation" step is a deterministic mock (no LLM call). The test
 * validates that the SCORER handles realistic English phrases correctly, and
 * that the pipeline assumption (model translates before calling) works.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { discoverProtocolCapabilities } from "../../../echo-agent/tools/protocols/runtime.js";

interface PipelineFixture {
  polishIntent: string;
  translatedEnglish: string;
  expectedAny: readonly string[];
  includeMutating?: boolean;
}

const PIPELINE_FIXTURES: readonly PipelineFixture[] = [
  {
    polishIntent: "zamień sol na usdc",
    translatedEnglish: "swap sol to usdc on solana",
    expectedAny: ["solana.swap"],
    includeMutating: true,
  },
  {
    polishIntent: "pokaż moje pozycje na polymarket",
    translatedEnglish: "polymarket positions",
    expectedAny: ["polymarket.data.positions", "polymarket.data.closedPositions"],
  },
  {
    polishIntent: "most usdc na base",
    translatedEnglish: "bridge usdc to base",
    expectedAny: ["khalani.bridge", "khalani.quote"],
    includeMutating: true,
  },
  {
    polishIntent: "szukaj tokenów na solanie",
    translatedEnglish: "solana token search",
    expectedAny: ["solana.tokens"],
  },
  {
    polishIntent: "portfel saldo tokenów",
    translatedEnglish: "wallet token balances",
    expectedAny: ["khalani.tokens", "solana.tokens"],
  },
  {
    polishIntent: "trendujące memy na dexscreenerze",
    translatedEnglish: "trending meme tokens",
    expectedAny: ["dexscreener.trending", "dexscreener.boosts"],
  },
];

describe("discovery pipeline — Polish intent → English query → discover_tools", () => {
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

  for (const fixture of PIPELINE_FIXTURES) {
    it(`"${fixture.polishIntent}" → "${fixture.translatedEnglish}" → top-3 match`, () => {
      // Step 1: mock translation (deterministic — no LLM)
      const englishQuery = fixture.translatedEnglish;

      // Step 2: call discover_tools with the English capability phrase
      const result = discoverProtocolCapabilities({
        query: englishQuery,
        limit: 3,
        includeMutating: fixture.includeMutating ?? false,
      });

      // Step 3: verify expected tool appears in top-3
      const topIds = result.tools.map((t) => t.toolId);
      const hit = fixture.expectedAny.some((expected) =>
        topIds.some((id) => id === expected || id.startsWith(`${expected}.`) || id.startsWith(expected)),
      );
      expect(hit, `Polish: "${fixture.polishIntent}" → topIds=${JSON.stringify(topIds)}`).toBe(true);
    });
  }
});
