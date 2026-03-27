import { describe, it, expect, vi } from "vitest";

// Mock 0G compute readiness to avoid .cts SDK bridge loading
vi.mock("@tools/0g-compute/readiness.js", () => ({
  loadComputeState: () => null,
}));

const { dispatchTool } = await import("../../../echo-agent/tools/dispatcher.js");

const baseContext = {
  sessionId: "test-session",
  loadedKnowledge: new Map<string, string>(),
  loopMode: "off" as const,
  approved: false,
};

describe("dispatcher", () => {
  // ── Protocol routing ─────────────────────────────────────────────

  it("routes discover_tools to protocol discovery", async () => {
    const result = await dispatchTool(
      { name: "discover_tools", args: { namespace: "khalani" }, toolCallId: "call_1" },
      baseContext,
    );

    expect(result.success).toBe(true);
    const parsed = JSON.parse(result.output);
    expect(parsed.count).toBeGreaterThan(0);
    expect(parsed.tools[0].toolId).toMatch(/^khalani\./);
  });

  it("discover_tools returns khalani tools with params", async () => {
    const result = await dispatchTool(
      { name: "discover_tools", args: { namespace: "khalani", includeMutating: true }, toolCallId: "call_2" },
      baseContext,
    );

    const parsed = JSON.parse(result.output);
    const bridge = parsed.tools.find((t: { toolId: string }) => t.toolId === "khalani.bridge");
    expect(bridge).toBeDefined();
    expect(bridge.mutating).toBe(true);
    expect(bridge.params.length).toBeGreaterThan(0);
  });

  it("discover_tools filters mutating by default", async () => {
    const result = await dispatchTool(
      { name: "discover_tools", args: { namespace: "khalani" }, toolCallId: "call_3" },
      baseContext,
    );

    const parsed = JSON.parse(result.output);
    const hasMutating = parsed.tools.some((t: { mutating: boolean }) => t.mutating);
    expect(hasMutating).toBe(false);
  });

  it("discover_tools respects query filter", async () => {
    const result = await dispatchTool(
      { name: "discover_tools", args: { query: "balance" }, toolCallId: "call_4" },
      baseContext,
    );

    const parsed = JSON.parse(result.output);
    expect(parsed.count).toBeGreaterThan(0);
    for (const tool of parsed.tools) {
      const matchesQuery =
        tool.toolId.includes("balance") ||
        tool.description.toLowerCase().includes("balance");
      expect(matchesQuery).toBe(true);
    }
  });

  it("discover_tools respects limit", async () => {
    const result = await dispatchTool(
      { name: "discover_tools", args: { limit: 2 }, toolCallId: "call_5" },
      baseContext,
    );

    const parsed = JSON.parse(result.output);
    expect(parsed.count).toBeLessThanOrEqual(2);
  });

  // ── execute_tool validation ──────────────────────────────────────

  it("execute_tool fails on missing toolId", async () => {
    const result = await dispatchTool(
      { name: "execute_tool", args: { params: {} }, toolCallId: "call_6" },
      baseContext,
    );

    expect(result.success).toBe(false);
    expect(result.output).toContain("toolId");
  });

  it("execute_tool fails on unknown toolId", async () => {
    const result = await dispatchTool(
      { name: "execute_tool", args: { toolId: "fake.tool", params: {} }, toolCallId: "call_7" },
      baseContext,
    );

    expect(result.success).toBe(false);
    expect(result.output).toContain("Unknown protocol tool");
  });

  it("execute_tool validates required params", async () => {
    const result = await dispatchTool(
      { name: "execute_tool", args: { toolId: "khalani.tokens.search", params: {} }, toolCallId: "call_8" },
      baseContext,
    );

    expect(result.success).toBe(false);
    expect(result.output).toContain("query");
  });

  // ── Internal tool routing (stubs) ────────────────────────────────

  it("routes web_search to internal stub", async () => {
    const result = await dispatchTool(
      { name: "web_search", args: { query: "test" }, toolCallId: "call_9" },
      baseContext,
    );

    expect(result.success).toBe(false);
    expect(result.output).toContain("[STUB]");
  });

  it("routes file_read to internal stub", async () => {
    const result = await dispatchTool(
      { name: "file_read", args: { path: "test.md" }, toolCallId: "call_10" },
      baseContext,
    );

    expect(result.success).toBe(false);
    expect(result.output).toContain("[STUB]");
  });

  it("routes memory_manage to internal stub", async () => {
    const result = await dispatchTool(
      { name: "memory_manage", args: { action: "list" }, toolCallId: "call_11" },
      baseContext,
    );

    expect(result.success).toBe(false);
    expect(result.output).toContain("[STUB]");
  });

  it("routes wallet_read to live handler (not stub)", async () => {
    // wallet_read action=address will fail without configured wallet, but NOT return [STUB]
    const result = await dispatchTool(
      { name: "wallet_read", args: { action: "address" }, toolCallId: "call_12" },
      baseContext,
    );

    // May succeed or fail (depends on wallet config) but should never be a stub
    expect(result.output).not.toContain("[STUB]");
  });

  // ── Unknown tool ─────────────────────────────────────────────────

  it("returns error for completely unknown tool", async () => {
    const result = await dispatchTool(
      { name: "nonexistent_tool", args: {}, toolCallId: "call_13" },
      baseContext,
    );

    expect(result.success).toBe(false);
    expect(result.output).toContain("Unknown tool");
  });
});
