import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock 0G compute to avoid .cts loading
vi.mock("@tools/0g-compute/readiness.js", () => ({
  loadComputeState: () => null,
}));

const { getOpenAITools, getAllTools } = await import(
  "../../../echo-agent/tools/registry.js"
);
const { discoverProtocolCapabilities } = await import(
  "../../../echo-agent/tools/protocols/runtime.js"
);
const { executeProtocolTool } = await import(
  "../../../echo-agent/tools/protocols/runtime.js"
);

describe("requiresEnv filtering", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.TAVILY_API_KEY;
    delete process.env.JUPITER_API_KEY;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  // ── Internal tools (registry) ──────────────────────────────────

  describe("internal tools (registry)", () => {
    it("hides web_search when TAVILY_API_KEY not set", () => {
      const tools = getOpenAITools("off");
      const hasWebSearch = tools.some(t => t.function.name === "web_search");
      expect(hasWebSearch).toBe(false);
    });

    it("hides web_fetch when TAVILY_API_KEY not set", () => {
      const tools = getOpenAITools("off");
      const hasWebFetch = tools.some(t => t.function.name === "web_fetch");
      expect(hasWebFetch).toBe(false);
    });

    it("shows web_search when TAVILY_API_KEY is set", () => {
      process.env.TAVILY_API_KEY = "tvly-test-key-12345678";
      const tools = getOpenAITools("off");
      const hasWebSearch = tools.some(t => t.function.name === "web_search");
      expect(hasWebSearch).toBe(true);
    });

    it("shows web_fetch when TAVILY_API_KEY is set", () => {
      process.env.TAVILY_API_KEY = "tvly-test-key-12345678";
      const tools = getOpenAITools("off");
      const hasWebFetch = tools.some(t => t.function.name === "web_fetch");
      expect(hasWebFetch).toBe(true);
    });

    it("non-ENV tools always present regardless of ENV state", () => {
      const tools = getOpenAITools("off");
      const hasDiscover = tools.some(t => t.function.name === "discover_tools");
      const hasFileRead = tools.some(t => t.function.name === "file_read");
      const hasMemory = tools.some(t => t.function.name === "memory_manage");
      expect(hasDiscover).toBe(true);
      expect(hasFileRead).toBe(true);
      expect(hasMemory).toBe(true);
    });

    it("getAllTools still returns all tools including ENV-gated ones", () => {
      const all = getAllTools();
      const webSearch = all.find(t => t.name === "web_search");
      expect(webSearch).toBeDefined();
      expect(webSearch!.requiresEnv).toBe("TAVILY_API_KEY");
    });
  });

  // ── Protocol tools (discovery) ─────────────────────────────────

  describe("protocol discovery", () => {
    it("hides studio tools when JUPITER_API_KEY not set", () => {
      const result = discoverProtocolCapabilities({
        namespace: "solana",
        query: "studio",
        includeMutating: true,
      });
      const studioTools = result.tools.filter(t => t.toolId.startsWith("solana.studio."));
      expect(studioTools).toHaveLength(0);
    });

    it("shows studio tools when JUPITER_API_KEY is set", () => {
      process.env.JUPITER_API_KEY = "test-jupiter-key";
      const result = discoverProtocolCapabilities({
        namespace: "solana",
        query: "studio",
        includeMutating: true,
      });
      const studioTools = result.tools.filter(t => t.toolId.startsWith("solana.studio."));
      expect(studioTools).toHaveLength(3);
    });

    it("non-studio solana tools visible without JUPITER_API_KEY", () => {
      const result = discoverProtocolCapabilities({
        namespace: "solana",
        includeMutating: true,
      });
      expect(result.count).toBeGreaterThan(0);
      const hasSwap = result.tools.some(t => t.toolId === "solana.swap.quote");
      const hasHoldings = result.tools.some(t => t.toolId === "solana.holdings");
      expect(hasSwap).toBe(true);
      expect(hasHoldings).toBe(true);
    });

    it("khalani tools unaffected by JUPITER_API_KEY", () => {
      const result = discoverProtocolCapabilities({ namespace: "khalani" });
      expect(result.count).toBeGreaterThan(0);
    });

    it("total tool count is lower without JUPITER_API_KEY", () => {
      const without = discoverProtocolCapabilities({ includeMutating: true, limit: 200 });
      process.env.JUPITER_API_KEY = "test-key";
      const withKey = discoverProtocolCapabilities({ includeMutating: true, limit: 200 });
      expect(withKey.count).toBe(without.count + 3);
    });
  });

  // ── Protocol execute guard ─────────────────────────────────────

  describe("protocol execute guard", () => {
    it("blocks studio.create without JUPITER_API_KEY", async () => {
      const result = await executeProtocolTool(
        { toolId: "solana.studio.create", params: { tokenName: "Test", tokenSymbol: "TST", imagePath: "/tmp/a.png", initialMarketCap: 1000, migrationMarketCap: 10000 } },
        { loopMode: "off", approved: false },
      );
      expect(result.success).toBe(false);
      expect(result.output).toContain("JUPITER_API_KEY");
    });

    it("blocks studio.fees without JUPITER_API_KEY", async () => {
      const result = await executeProtocolTool(
        { toolId: "solana.studio.fees", params: { mint: "abc" } },
        { loopMode: "off", approved: false },
      );
      expect(result.success).toBe(false);
      expect(result.output).toContain("JUPITER_API_KEY");
    });

    it("blocks studio.claimFees without JUPITER_API_KEY", async () => {
      const result = await executeProtocolTool(
        { toolId: "solana.studio.claimFees", params: { poolAddress: "abc" } },
        { loopMode: "off", approved: false },
      );
      expect(result.success).toBe(false);
      expect(result.output).toContain("JUPITER_API_KEY");
    });

    it("non-studio execute not blocked by missing JUPITER_API_KEY", async () => {
      const result = await executeProtocolTool(
        { toolId: "solana.tokens.search", params: { query: "SOL" } },
        { loopMode: "off", approved: false },
      );
      // Will fail at network level (no real API) but NOT blocked by ENV guard
      expect(result.output).not.toContain("JUPITER_API_KEY");
    });
  });
});
