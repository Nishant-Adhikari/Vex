import { describe, it, expect } from "vitest";
import { KHALANI_TOOLS } from "../../../echo-agent/tools/protocols/khalani/manifest.js";

describe("khalani manifest", () => {
  // ── Completeness ─────────────────────────────────────────────────

  it("has exactly 9 tools", () => {
    expect(KHALANI_TOOLS).toHaveLength(9);
  });

  const EXPECTED_TOOL_IDS = [
    "khalani.chains.list",
    "khalani.tokens.top",
    "khalani.tokens.search",
    "khalani.tokens.autocomplete",
    "khalani.tokens.balances",
    "khalani.quote.get",
    "khalani.orders.list",
    "khalani.orders.get",
    "khalani.bridge",
  ];

  for (const toolId of EXPECTED_TOOL_IDS) {
    it(`declares ${toolId}`, () => {
      const tool = KHALANI_TOOLS.find(t => t.toolId === toolId);
      expect(tool).toBeDefined();
    });
  }

  // ── Namespace consistency ────────────────────────────────────────

  it("all tools belong to khalani namespace", () => {
    for (const tool of KHALANI_TOOLS) {
      expect(tool.namespace).toBe("khalani");
    }
  });

  it("all tools are active lifecycle", () => {
    for (const tool of KHALANI_TOOLS) {
      expect(tool.lifecycle).toBe("active");
    }
  });

  it("all toolIds start with khalani.", () => {
    for (const tool of KHALANI_TOOLS) {
      expect(tool.toolId).toMatch(/^khalani\./);
    }
  });

  // ── Mutating flags ───────────────────────────────────────────────

  it("only khalani.bridge is mutating", () => {
    const mutating = KHALANI_TOOLS.filter(t => t.mutating);
    expect(mutating).toHaveLength(1);
    expect(mutating[0].toolId).toBe("khalani.bridge");
  });

  it("read-only tools are not mutating", () => {
    const readOnly = KHALANI_TOOLS.filter(t => t.toolId !== "khalani.bridge");
    for (const tool of readOnly) {
      expect(tool.mutating).toBe(false);
    }
  });

  // ── Required params ──────────────────────────────────────────────

  it("khalani.tokens.search requires query", () => {
    const tool = KHALANI_TOOLS.find(t => t.toolId === "khalani.tokens.search")!;
    const queryParam = tool.params.find(p => p.key === "query");
    expect(queryParam).toBeDefined();
    expect(queryParam!.required).toBe(true);
  });

  it("khalani.tokens.autocomplete requires keyword", () => {
    const tool = KHALANI_TOOLS.find(t => t.toolId === "khalani.tokens.autocomplete")!;
    const keywordParam = tool.params.find(p => p.key === "keyword");
    expect(keywordParam).toBeDefined();
    expect(keywordParam!.required).toBe(true);
  });

  it("khalani.quote.get requires fromChain, fromToken, toChain, toToken, amount", () => {
    const tool = KHALANI_TOOLS.find(t => t.toolId === "khalani.quote.get")!;
    const requiredKeys = tool.params.filter(p => p.required).map(p => p.key);
    expect(requiredKeys).toContain("fromChain");
    expect(requiredKeys).toContain("fromToken");
    expect(requiredKeys).toContain("toChain");
    expect(requiredKeys).toContain("toToken");
    expect(requiredKeys).toContain("amount");
  });

  it("khalani.bridge requires fromChain, fromToken, toChain, toToken, amount", () => {
    const tool = KHALANI_TOOLS.find(t => t.toolId === "khalani.bridge")!;
    const requiredKeys = tool.params.filter(p => p.required).map(p => p.key);
    expect(requiredKeys).toContain("fromChain");
    expect(requiredKeys).toContain("fromToken");
    expect(requiredKeys).toContain("toChain");
    expect(requiredKeys).toContain("toToken");
    expect(requiredKeys).toContain("amount");
  });

  it("khalani.orders.get requires orderId", () => {
    const tool = KHALANI_TOOLS.find(t => t.toolId === "khalani.orders.get")!;
    const requiredKeys = tool.params.filter(p => p.required).map(p => p.key);
    expect(requiredKeys).toEqual(["orderId"]);
  });

  it("khalani.chains.list has no required params", () => {
    const tool = KHALANI_TOOLS.find(t => t.toolId === "khalani.chains.list")!;
    const requiredKeys = tool.params.filter(p => p.required);
    expect(requiredKeys).toHaveLength(0);
  });

  // ── Descriptions quality ─────────────────────────────────────────

  it("every tool has non-empty description", () => {
    for (const tool of KHALANI_TOOLS) {
      expect(tool.description.length).toBeGreaterThan(15);
    }
  });

  it("every param has non-empty description", () => {
    for (const tool of KHALANI_TOOLS) {
      for (const param of tool.params) {
        expect(param.description.length).toBeGreaterThan(5);
      }
    }
  });

  it("every tool has retrieval-only embedding text", () => {
    for (const tool of KHALANI_TOOLS) {
      expect(
        tool.discovery?.embeddingText,
        `${tool.toolId} missing discovery.embeddingText`,
      ).toBeTruthy();
      expect(tool.discovery!.embeddingText!.length).toBeGreaterThan(80);
      expect(tool.discovery!.embeddingText).toContain("Solana");
    }
  });

  it("quote embedding text captures bridge quote routes and fillers", () => {
    const quote = KHALANI_TOOLS.find(t => t.toolId === "khalani.quote.get")!;
    expect(quote.discovery?.embeddingText).toContain("cross-chain bridge quote");
    expect(quote.discovery?.embeddingText).toContain("Hyperstream");
    expect(quote.discovery?.embeddingText).toContain("Across");
  });

  it("bridge embedding text captures execution and deposit methods", () => {
    const bridge = KHALANI_TOOLS.find(t => t.toolId === "khalani.bridge")!;
    expect(bridge.discovery?.embeddingText).toContain("execute cross-chain bridge transfer");
    expect(bridge.discovery?.embeddingText).toContain("CONTRACT_CALL");
    expect(bridge.discovery?.embeddingText).toContain("PERMIT2");
    expect(bridge.discovery?.embeddingText).toContain("TRANSFER");
  });

  it("token resolver embeddings distinguish search, autocomplete, and balances", () => {
    const search = KHALANI_TOOLS.find(t => t.toolId === "khalani.tokens.search")!;
    const autocomplete = KHALANI_TOOLS.find(t => t.toolId === "khalani.tokens.autocomplete")!;
    const balances = KHALANI_TOOLS.find(t => t.toolId === "khalani.tokens.balances")!;
    expect(search.discovery?.embeddingText).toContain("canonical cross-chain token resolver");
    expect(autocomplete.discovery?.embeddingText).toContain("semantic token autocomplete");
    expect(balances.discovery?.embeddingText).toContain("wallet token balances");
  });

  it("order embeddings capture lifecycle and transaction lookup intent", () => {
    const list = KHALANI_TOOLS.find(t => t.toolId === "khalani.orders.list")!;
    const get = KHALANI_TOOLS.find(t => t.toolId === "khalani.orders.get")!;
    expect(list.discovery?.embeddingText).toContain("created deposited published filled refund pending refunded failed");
    expect(list.discovery?.embeddingText).toContain("transaction hash");
    expect(get.discovery?.embeddingText).toContain("deposit fill refund transactions");
    expect(get.discovery?.embeddingText).toContain("provider status");
  });

  // ── Example params ───────────────────────────────────────────────

  it("khalani.bridge has example params", () => {
    const tool = KHALANI_TOOLS.find(t => t.toolId === "khalani.bridge")!;
    expect(Object.keys(tool.exampleParams).length).toBeGreaterThan(0);
    expect(tool.exampleParams.fromChain).toBeDefined();
  });

  it("khalani.quote.get has example params with all required fields", () => {
    const tool = KHALANI_TOOLS.find(t => t.toolId === "khalani.quote.get")!;
    const required = tool.params.filter(p => p.required).map(p => p.key);
    for (const key of required) {
      expect(tool.exampleParams[key]).toBeDefined();
    }
  });

  // ── Canonical resolver ─────────────────────────────────────────

  it("khalani.tokens.search is described as canonical resolver", () => {
    const tool = KHALANI_TOOLS.find(t => t.toolId === "khalani.tokens.search")!;
    expect(tool.description).toContain("canonical");
    expect(tool.description).toContain("cross-chain token resolver");
  });
});
