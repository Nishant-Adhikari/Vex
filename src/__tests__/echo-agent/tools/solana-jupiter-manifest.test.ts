import { describe, it, expect } from "vitest";
import { SOLANA_JUPITER_TOOLS } from "../../../echo-agent/tools/protocols/solana-jupiter/manifest.js";

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
});
