import { describe, it, expect } from "vitest";
import { SOLANA_JUPITER_TOOLS } from "../../../echo-agent/tools/protocols/solana-jupiter/manifest.js";

describe("solana-jupiter manifest", () => {
  // ── Completeness ─────────────────────────────────────────────────

  it("has 52 tools total", () => {
    expect(SOLANA_JUPITER_TOOLS).toHaveLength(52);
  });

  // ── All expected toolIds present ─────────────────────────────────

  const EXPECTED_TOOL_IDS = [
    // Core (5)
    "solana.holdings",
    "solana.prices",
    "solana.tokens.search",
    "solana.tokens.trending",
    "solana.tokens.shield",
    // Swap (2)
    "solana.swap.quote",
    "solana.swap.execute",
    // Perps (11)
    "solana.perps.markets",
    "solana.perps.positions",
    "solana.perps.history",
    "solana.perps.open",
    "solana.perps.close",
    "solana.perps.closeAll",
    "solana.perps.tpsl",
    "solana.perps.cancelLimitOrder",
    "solana.perps.updateLimitOrder",
    "solana.perps.cancelTpsl",
    "solana.perps.updateTpsl",
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
    // DCA (3)
    "solana.dca.list",
    "solana.dca.create",
    "solana.dca.cancel",
    // Limit (3)
    "solana.limit.list",
    "solana.limit.create",
    "solana.limit.cancel",
    // Lend (4)
    "solana.lend.rates",
    "solana.lend.positions",
    "solana.lend.deposit",
    "solana.lend.withdraw",
    // Stake (4)
    "solana.stake.accounts",
    "solana.stake.delegate",
    "solana.stake.withdraw",
    "solana.stake.claimMev",
    // Send (3)
    "solana.send.pending",
    "solana.send.invite",
    "solana.send.clawback",
    // Studio (3)
    "solana.studio.fees",
    "solana.studio.create",
    "solana.studio.claimFees",
    // Account (2)
    "solana.account.burn",
    "solana.account.closeEmpty",
    // History (1)
    "solana.history.spot",
  ];

  it("expected toolId count matches manifest count", () => {
    expect(EXPECTED_TOOL_IDS).toHaveLength(52);
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
    "solana.perps.open",
    "solana.perps.close",
    "solana.perps.closeAll",
    "solana.perps.tpsl",
    "solana.perps.cancelLimitOrder",
    "solana.perps.updateLimitOrder",
    "solana.perps.cancelTpsl",
    "solana.perps.updateTpsl",
    "solana.predict.buy",
    "solana.predict.sell",
    "solana.predict.claim",
    "solana.predict.closeAll",
    "solana.dca.create",
    "solana.dca.cancel",
    "solana.limit.create",
    "solana.limit.cancel",
    "solana.lend.deposit",
    "solana.lend.withdraw",
    "solana.stake.delegate",
    "solana.stake.withdraw",
    "solana.stake.claimMev",
    "solana.send.invite",
    "solana.send.clawback",
    "solana.studio.create",
    "solana.studio.claimFees",
    "solana.account.burn",
    "solana.account.closeEmpty",
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

  // ── requiresEnv ──────────────────────────────────────────────────

  it("studio tools require JUPITER_API_KEY", () => {
    const studioTools = SOLANA_JUPITER_TOOLS.filter(t => t.toolId.startsWith("solana.studio."));
    expect(studioTools).toHaveLength(3);
    for (const tool of studioTools) {
      expect(tool.requiresEnv).toBe("JUPITER_API_KEY");
    }
  });

  it("non-studio tools do not require ENV", () => {
    const nonStudio = SOLANA_JUPITER_TOOLS.filter(t => !t.toolId.startsWith("solana.studio."));
    for (const tool of nonStudio) {
      expect(tool.requiresEnv).toBeUndefined();
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

  it("solana.perps.open requires asset, side, amountUsd", () => {
    const tool = SOLANA_JUPITER_TOOLS.find(t => t.toolId === "solana.perps.open")!;
    const required = tool.params.filter(p => p.required).map(p => p.key);
    expect(required).toContain("asset");
    expect(required).toContain("side");
    expect(required).toContain("amountUsd");
  });

  it("solana.predict.buy requires marketId, side, amountUsdc", () => {
    const tool = SOLANA_JUPITER_TOOLS.find(t => t.toolId === "solana.predict.buy")!;
    const required = tool.params.filter(p => p.required).map(p => p.key);
    expect(required).toContain("marketId");
    expect(required).toContain("side");
    expect(required).toContain("amountUsdc");
  });

  it("solana.perps.markets has no required params", () => {
    const tool = SOLANA_JUPITER_TOOLS.find(t => t.toolId === "solana.perps.markets")!;
    const required = tool.params.filter(p => p.required);
    expect(required).toHaveLength(0);
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
