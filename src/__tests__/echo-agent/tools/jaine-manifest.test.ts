import { describe, it, expect } from "vitest";
import { JAINE_TOOLS } from "../../../echo-agent/tools/protocols/0g/jaine/manifest.js";

describe("jaine manifest", () => {
  // ── Completeness ─────────────────────────────────────────────────

  it("has 23 tools total", () => {
    expect(JAINE_TOOLS).toHaveLength(23);
  });

  const EXPECTED_TOOL_IDS = [
    // Pools discovery (5)
    "jaine.meta",
    "jaine.pools.top",
    "jaine.pools.forToken",
    "jaine.pools.forPair",
    "jaine.pools.newest",
    // Single pool (7)
    "jaine.pool.info",
    "jaine.pool.days",
    "jaine.pool.hours",
    "jaine.pool.swaps",
    "jaine.pool.mints",
    "jaine.pool.burns",
    "jaine.pool.collects",
    // Tokens (3)
    "jaine.token.info",
    "jaine.tokens.top",
    "jaine.tokens.list",
    // DEX (1)
    "jaine.dex.stats",
    // Swap (2)
    "jaine.swap.quote",
    "jaine.swap.sell",
    // Allowance (3)
    "jaine.allowance.check",
    "jaine.allowance.approve",
    "jaine.allowance.revoke",
    // W0G (2)
    "jaine.w0g.wrap",
    "jaine.w0g.unwrap",
  ];

  it("expected toolId count matches manifest count", () => {
    expect(EXPECTED_TOOL_IDS).toHaveLength(23);
  });

  for (const toolId of EXPECTED_TOOL_IDS) {
    it(`declares ${toolId}`, () => {
      const tool = JAINE_TOOLS.find(t => t.toolId === toolId);
      expect(tool).toBeDefined();
    });
  }

  it("has no tools beyond expected list", () => {
    const expectedSet = new Set(EXPECTED_TOOL_IDS);
    const unexpected = JAINE_TOOLS.filter(t => !expectedSet.has(t.toolId));
    expect(unexpected).toHaveLength(0);
  });

  // ── Namespace ────────────────────────────────────────────────────

  it("all tools belong to jaine namespace", () => {
    for (const tool of JAINE_TOOLS) {
      expect(tool.namespace).toBe("jaine");
    }
  });

  it("all tools are active lifecycle", () => {
    for (const tool of JAINE_TOOLS) {
      expect(tool.lifecycle).toBe("active");
    }
  });

  it("all toolIds start with jaine.", () => {
    for (const tool of JAINE_TOOLS) {
      expect(tool.toolId).toMatch(/^jaine\./);
    }
  });

  // ── Mutating flags ────────────────────────────────────────────────

  const EXPECTED_MUTATING = [
    "jaine.swap.sell",
    "jaine.allowance.approve",
    "jaine.allowance.revoke",
    "jaine.w0g.wrap",
    "jaine.w0g.unwrap",
  ];

  it("has correct number of mutating tools (5)", () => {
    const mutating = JAINE_TOOLS.filter(t => t.mutating);
    expect(mutating).toHaveLength(EXPECTED_MUTATING.length);
  });

  for (const toolId of EXPECTED_MUTATING) {
    it(`${toolId} is mutating`, () => {
      const tool = JAINE_TOOLS.find(t => t.toolId === toolId)!;
      expect(tool.mutating).toBe(true);
    });
  }

  it("read-only tools are not mutating", () => {
    const mutatingSet = new Set(EXPECTED_MUTATING);
    const readOnly = JAINE_TOOLS.filter(t => !mutatingSet.has(t.toolId));
    for (const tool of readOnly) {
      expect(tool.mutating).toBe(false);
    }
  });

  // ── Required params ──────────────────────────────────────────────

  it("jaine.meta has no required params", () => {
    const tool = JAINE_TOOLS.find(t => t.toolId === "jaine.meta")!;
    expect(tool.params.filter(p => p.required)).toHaveLength(0);
  });

  it("jaine.pools.top has no required params", () => {
    const tool = JAINE_TOOLS.find(t => t.toolId === "jaine.pools.top")!;
    expect(tool.params.filter(p => p.required)).toHaveLength(0);
  });

  it("jaine.pools.forToken requires token", () => {
    const tool = JAINE_TOOLS.find(t => t.toolId === "jaine.pools.forToken")!;
    const required = tool.params.filter(p => p.required).map(p => p.key);
    expect(required).toEqual(["token"]);
  });

  it("jaine.pools.forPair requires tokenA and tokenB", () => {
    const tool = JAINE_TOOLS.find(t => t.toolId === "jaine.pools.forPair")!;
    const required = tool.params.filter(p => p.required).map(p => p.key);
    expect(required).toContain("tokenA");
    expect(required).toContain("tokenB");
  });

  it("jaine.pool.info requires poolId", () => {
    const tool = JAINE_TOOLS.find(t => t.toolId === "jaine.pool.info")!;
    const required = tool.params.filter(p => p.required).map(p => p.key);
    expect(required).toEqual(["poolId"]);
  });

  it("jaine.token.info requires address", () => {
    const tool = JAINE_TOOLS.find(t => t.toolId === "jaine.token.info")!;
    const required = tool.params.filter(p => p.required).map(p => p.key);
    expect(required).toEqual(["address"]);
  });

  it("jaine.swap.quote requires tokenIn, tokenOut, amountIn", () => {
    const tool = JAINE_TOOLS.find(t => t.toolId === "jaine.swap.quote")!;
    const required = tool.params.filter(p => p.required).map(p => p.key);
    expect(required).toContain("tokenIn");
    expect(required).toContain("tokenOut");
    expect(required).toContain("amountIn");
  });

  it("jaine.swap.sell requires tokenIn, tokenOut, amountIn", () => {
    const tool = JAINE_TOOLS.find(t => t.toolId === "jaine.swap.sell")!;
    const required = tool.params.filter(p => p.required).map(p => p.key);
    expect(required).toContain("tokenIn");
    expect(required).toContain("tokenOut");
    expect(required).toContain("amountIn");
  });

  it("jaine.allowance.check requires token", () => {
    const tool = JAINE_TOOLS.find(t => t.toolId === "jaine.allowance.check")!;
    const required = tool.params.filter(p => p.required).map(p => p.key);
    expect(required).toEqual(["token"]);
  });

  it("jaine.allowance.approve requires token and spender", () => {
    const tool = JAINE_TOOLS.find(t => t.toolId === "jaine.allowance.approve")!;
    const required = tool.params.filter(p => p.required).map(p => p.key);
    expect(required).toContain("token");
    expect(required).toContain("spender");
  });

  it("jaine.allowance.revoke requires token and spender", () => {
    const tool = JAINE_TOOLS.find(t => t.toolId === "jaine.allowance.revoke")!;
    const required = tool.params.filter(p => p.required).map(p => p.key);
    expect(required).toContain("token");
    expect(required).toContain("spender");
  });

  it("jaine.w0g.wrap requires amount", () => {
    const tool = JAINE_TOOLS.find(t => t.toolId === "jaine.w0g.wrap")!;
    const required = tool.params.filter(p => p.required).map(p => p.key);
    expect(required).toEqual(["amount"]);
  });

  it("jaine.w0g.unwrap requires amount", () => {
    const tool = JAINE_TOOLS.find(t => t.toolId === "jaine.w0g.unwrap")!;
    const required = tool.params.filter(p => p.required).map(p => p.key);
    expect(required).toEqual(["amount"]);
  });

  // ── No requiresEnv (Jaine subgraph is free) ──────────────────────

  it("no tools require ENV", () => {
    for (const tool of JAINE_TOOLS) {
      expect(tool.requiresEnv).toBeUndefined();
    }
  });

  // ── Descriptions quality ──────────────────────────────────────────

  it("every tool has non-empty description", () => {
    for (const tool of JAINE_TOOLS) {
      expect(tool.description.length).toBeGreaterThan(15);
    }
  });

  it("every param has non-empty description", () => {
    for (const tool of JAINE_TOOLS) {
      for (const param of tool.params) {
        expect(param.description.length).toBeGreaterThan(3);
      }
    }
  });
});
