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
