import { describe, it, expect } from "vitest";
import { SOLANA_JUPITER_TOOLS } from "../../../vex-agent/tools/protocols/solana-jupiter/manifest.js";

describe("solana-jupiter manifest", () => {
  // ── Completeness ─────────────────────────────────────────────────

  it("has 20 tools total", () => {
    expect(SOLANA_JUPITER_TOOLS).toHaveLength(20);
  });

  // ── All expected toolIds present ─────────────────────────────────

  const EXPECTED_TOOL_IDS = [
    // Core (3)
    "solana.prices",
    "solana.tokens.search",
    "solana.tokens.trending",
    // Swap (2)
    "solana.swap.quote",
    "solana.swap.execute",
    // Predict (11)
    "solana.predict.events",
    "solana.predict.search",
    "solana.predict.market",
    "solana.predict.event",
    "solana.predict.position",
    "solana.predict.positions",
    "solana.predict.history",
    "solana.predict.buy",
    "solana.predict.sell",
    "solana.predict.claim",
    "solana.predict.closeAll",
    // Lend (4)
    "solana.lend.rates",
    "solana.lend.positions",
    "solana.lend.deposit",
    "solana.lend.withdraw",
  ];

  it("expected toolId count matches manifest count", () => {
    expect(EXPECTED_TOOL_IDS).toHaveLength(20);
  });

  for (const toolId of EXPECTED_TOOL_IDS) {
    it(`declares ${toolId}`, () => {
      const tool = SOLANA_JUPITER_TOOLS.find(t => t.toolId === toolId);
      expect(tool).toBeDefined();
    });
  }

  // ── No extra/unexpected tools ────────────────────────────────────

  it("has no tools beyond expected list", () => {
    const expectedSet = new Set(EXPECTED_TOOL_IDS);
    const unexpected = SOLANA_JUPITER_TOOLS.filter(t => !expectedSet.has(t.toolId));
    expect(unexpected).toHaveLength(0);
  });

  // ── Namespace consistency ────────────────────────────────────────

  it("all tools belong to solana namespace", () => {
    for (const tool of SOLANA_JUPITER_TOOLS) {
      expect(tool.namespace).toBe("solana");
    }
  });

  it("all tools are active lifecycle", () => {
    for (const tool of SOLANA_JUPITER_TOOLS) {
      expect(tool.lifecycle).toBe("active");
    }
  });

  it("all toolIds start with solana.", () => {
    for (const tool of SOLANA_JUPITER_TOOLS) {
      expect(tool.toolId).toMatch(/^solana\./);
    }
  });

  // ── Mutating flags ───────────────────────────────────────────────

  const EXPECTED_MUTATING = [
    "solana.swap.execute",
    "solana.predict.buy",
    "solana.predict.sell",
    "solana.predict.claim",
    "solana.predict.closeAll",
    "solana.lend.deposit",
    "solana.lend.withdraw",
  ];

  it("has correct number of mutating tools", () => {
    const mutating = SOLANA_JUPITER_TOOLS.filter(t => t.mutating);
    expect(mutating).toHaveLength(EXPECTED_MUTATING.length);
  });

  for (const toolId of EXPECTED_MUTATING) {
    it(`${toolId} is mutating`, () => {
      const tool = SOLANA_JUPITER_TOOLS.find(t => t.toolId === toolId)!;
      expect(tool.mutating).toBe(true);
    });
  }

  it("non-mutating tools are correctly flagged", () => {
    const mutatingSet = new Set(EXPECTED_MUTATING);
    const nonMutating = SOLANA_JUPITER_TOOLS.filter(t => !mutatingSet.has(t.toolId));
    for (const tool of nonMutating) {
      expect(tool.mutating).toBe(false);
    }
  });

  // ── requiresEnv — ALL retained tools require JUPITER_API_KEY ────

  it("all tools require JUPITER_API_KEY", () => {
    for (const tool of SOLANA_JUPITER_TOOLS) {
      expect(tool.requiresEnv).toBe("JUPITER_API_KEY");
    }
  });

  // ── Required params ──────────────────────────────────────────────

  it("solana.swap.execute requires inputToken, outputToken, amount", () => {
    const tool = SOLANA_JUPITER_TOOLS.find(t => t.toolId === "solana.swap.execute")!;
    const required = tool.params.filter(p => p.required).map(p => p.key);
    expect(required).toContain("inputToken");
    expect(required).toContain("outputToken");
    expect(required).toContain("amount");
  });

  it("solana.predict.buy requires marketId, side, amountUsdc", () => {
    const tool = SOLANA_JUPITER_TOOLS.find(t => t.toolId === "solana.predict.buy")!;
    const required = tool.params.filter(p => p.required).map(p => p.key);
    expect(required).toContain("marketId");
    expect(required).toContain("side");
    expect(required).toContain("amountUsdc");
  });

  // ── Pagination on unbounded list tools (P1-11) ───────────────────
  // events + positions are unbounded lists and MUST expose limit/offset;
  // history already did. Both params are optional numbers.

  for (const toolId of ["solana.predict.events", "solana.predict.positions", "solana.predict.history"]) {
    it(`${toolId} declares optional number limit + offset params`, () => {
      const tool = SOLANA_JUPITER_TOOLS.find(t => t.toolId === toolId)!;
      const limit = tool.params.find(p => p.key === "limit");
      const offset = tool.params.find(p => p.key === "offset");
      expect(limit, `${toolId} missing limit param`).toBeDefined();
      expect(offset, `${toolId} missing offset param`).toBeDefined();
      expect(limit!.type).toBe("number");
      expect(offset!.type).toBe("number");
      expect(limit!.required).toBeFalsy();
      expect(offset!.required).toBeFalsy();
    });
  }

  // ── Descriptions quality ─────────────────────────────────────────

  it("every tool has non-empty description", () => {
    for (const tool of SOLANA_JUPITER_TOOLS) {
      expect(tool.description.length).toBeGreaterThan(15);
    }
  });

  it("every param has non-empty description", () => {
    for (const tool of SOLANA_JUPITER_TOOLS) {
      for (const param of tool.params) {
        expect(param.description.length).toBeGreaterThan(3);
      }
    }
  });

  it("every tool has non-empty discovery.embeddingText", () => {
    for (const tool of SOLANA_JUPITER_TOOLS) {
      expect(tool.discovery?.embeddingText, `${tool.toolId} missing discovery.embeddingText`).toBeTruthy();
      expect(tool.discovery!.embeddingText!.length).toBeGreaterThan(80);
    }
  });

  // Note: assertions below check intent-level content the agent-style
  // refactor preserves (e.g. "Solana", "swap", "earn yield", "YES", "NO").
  // Implementation-detail strings ("Price API", "Tokens API", "deposit
  // transaction", "settlement history") are intentionally absent in the
  // refactored passages — they were API-doc jargon, not user intent.
  // Router names (Metis/JupiterZ/Dflow/OKX) are kept in execute only,
  // since the user-facing "preview" intent doesn't need router model names.

  it("swap embeddings stay Solana-anchored; execute names the routers", () => {
    const quote = SOLANA_JUPITER_TOOLS.find(t => t.toolId === "solana.swap.quote")!;
    const execute = SOLANA_JUPITER_TOOLS.find(t => t.toolId === "solana.swap.execute")!;
    for (const tool of [quote, execute]) {
      expect(tool.discovery!.embeddingText).toContain("Solana");
      expect(tool.discovery!.embeddingText?.toLowerCase()).toContain("swap");
    }
    // execute-only: routers belong to the execute path
    expect(execute.discovery!.embeddingText).toContain("Jupiter");
    expect(execute.discovery!.embeddingText).toContain("Metis");
    expect(execute.discovery!.embeddingText).toContain("JupiterZ");
    expect(execute.discovery!.embeddingText).toContain("Dflow");
    expect(execute.discovery!.embeddingText).toContain("OKX");
  });

  it("core embeddings mention tokens and prices", () => {
    const prices = SOLANA_JUPITER_TOOLS.find(t => t.toolId === "solana.prices")!;
    const search = SOLANA_JUPITER_TOOLS.find(t => t.toolId === "solana.tokens.search")!;
    const trending = SOLANA_JUPITER_TOOLS.find(t => t.toolId === "solana.tokens.trending")!;
    expect(prices.discovery!.embeddingText).toContain("USD prices");
    expect(prices.discovery!.embeddingText).toContain("mint");
    expect(search.discovery!.embeddingText).toContain("SPL token");
    expect(search.discovery!.embeddingText).toContain("mint address");
    expect(trending.discovery!.embeddingText).toContain("top trending");
    expect(trending.discovery!.embeddingText).toContain("SPL tokens");
  });

  it("lend embeddings mention Jupiter Lend Earn semantics", () => {
    const rates = SOLANA_JUPITER_TOOLS.find(t => t.toolId === "solana.lend.rates")!;
    const deposit = SOLANA_JUPITER_TOOLS.find(t => t.toolId === "solana.lend.deposit")!;
    const withdraw = SOLANA_JUPITER_TOOLS.find(t => t.toolId === "solana.lend.withdraw")!;
    expect(rates.discovery!.embeddingText).toContain("Jupiter Lend Earn");
    expect(rates.discovery!.embeddingText).toContain("APY");
    expect(deposit.discovery!.embeddingText).toContain("vault");
    expect(deposit.discovery!.embeddingText).toContain("earn yield");
    expect(withdraw.discovery!.embeddingText).toContain("vault");
    expect(withdraw.discovery!.embeddingText?.toLowerCase()).toContain("withdraw");
  });

  it("prediction embeddings mention YES NO markets and portfolio intent", () => {
    const buy = SOLANA_JUPITER_TOOLS.find(t => t.toolId === "solana.predict.buy")!;
    const positions = SOLANA_JUPITER_TOOLS.find(t => t.toolId === "solana.predict.positions")!;
    const history = SOLANA_JUPITER_TOOLS.find(t => t.toolId === "solana.predict.history")!;
    expect(buy.discovery!.embeddingText).toContain("YES");
    expect(buy.discovery!.embeddingText).toContain("NO");
    expect(buy.discovery!.embeddingText?.toLowerCase()).toContain("bet");
    expect(positions.discovery!.embeddingText?.toLowerCase()).toContain("open prediction");
    expect(history.discovery!.embeddingText).toContain("realized PnL");
    expect(history.discovery!.embeddingText?.toLowerCase()).toContain("past prediction");
  });
});
