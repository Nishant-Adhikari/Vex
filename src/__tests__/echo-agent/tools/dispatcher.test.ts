import { describe, it, expect, vi } from "vitest";

// Mock 0G compute readiness to avoid .cts SDK bridge loading
vi.mock("@tools/0g-compute/readiness.js", () => ({
  loadComputeState: () => null,
}));

vi.mock("@tools/wallet/multi-auth.js", () => ({
  requireEvmWallet: () => ({
    family: "eip155",
    address: "0x1234567890abcdef1234567890abcdef12345678",
    privateKey: `0x${"ab".repeat(32)}`,
  }),
  requireSolanaWallet: () => ({
    family: "solana",
    address: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
    secretKey: new Uint8Array(64),
  }),
}));

vi.mock("@tools/wallet/family.js", () => ({
  normalizeWalletChain: (input?: string) => {
    if (!input || input === "eip155" || input === "evm") return "eip155";
    if (input === "solana" || input === "sol") return "solana";
    throw new Error(`Unsupported wallet chain: ${input}`);
  },
}));

// Mock echo-agent DB repos (no real DB in unit tests)
vi.mock("@echo-agent/db/repos/search.js", () => ({
  getCached: vi.fn().mockResolvedValue(null),
  cacheResult: vi.fn().mockResolvedValue(undefined),
  getCachedFetch: vi.fn().mockResolvedValue(null),
  cacheFetchResult: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@echo-agent/db/repos/documents.js", () => ({
  getDocument: vi.fn().mockResolvedValue(null),
  upsertDocument: vi.fn().mockResolvedValue({ id: 1, space: "knowledge", folderId: null, title: "test", slug: "test", contentMd: "content", sizeBytes: 7, createdAt: "2024-01-01", updatedAt: "2024-01-01" }),
  listDocuments: vi.fn().mockResolvedValue([]),
  softDeleteDocument: vi.fn().mockResolvedValue(true),
  countDocuments: vi.fn().mockResolvedValue(1),
}));

vi.mock("@echo-agent/db/repos/folders.js", () => ({
  getFolderBySlug: vi.fn().mockResolvedValue(null),
  createFolder: vi.fn().mockResolvedValue({ id: 1, space: "knowledge", parentId: null, name: "test", slug: "test", createdAt: "2024-01-01" }),
  listFolders: vi.fn().mockResolvedValue([]),
  deleteFolder: vi.fn().mockResolvedValue(true),
}));

vi.mock("@echo-agent/db/repos/memory.js", () => ({
  listEntriesWithIds: vi.fn().mockResolvedValue([{ id: 1, contentMd: "remember this", category: null, createdAt: "2024-01-01" }]),
  appendMemory: vi.fn().mockResolvedValue(true),
  replaceEntry: vi.fn().mockResolvedValue(true),
  deleteEntry: vi.fn().mockResolvedValue(true),
}));

vi.mock("@echo-agent/db/repos/schedules.js", () => ({
  createSchedule: vi.fn().mockResolvedValue(undefined),
  deleteSchedule: vi.fn().mockResolvedValue(true),
}));

vi.mock("@echo-agent/db/repos/subagents.js", () => ({
  insert: vi.fn().mockResolvedValue(undefined),
  getById: vi.fn().mockResolvedValue(null),
  getActive: vi.fn().mockResolvedValue([]),
  getRecent: vi.fn().mockResolvedValue([]),
  updateStatus: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@echo-agent/db/repos/sessions.js", () => ({
  createSession: vi.fn().mockResolvedValue(undefined),
  setScope: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@echo-agent/db/repos/session-links.js", () => ({
  linkSessions: vi.fn().mockResolvedValue({ id: 1 }),
}));

vi.mock("@echo-agent/db/repos/executions.js", () => ({
  recordExecution: vi.fn().mockResolvedValue(1),
}));

vi.mock("@echo-agent/db/repos/sync.js", () => ({
  getJobsForNamespace: vi.fn().mockResolvedValue([]),
  enqueueRun: vi.fn().mockResolvedValue(1),
}));

const { dispatchTool } = await import("../../../echo-agent/tools/dispatcher.js");
import { makeTestContext } from "./_test-context.js";

const baseContext = makeTestContext();

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

  // ── Internal tool routing (live handlers) ────────────────────────

  it("routes web_search to live handler (fails without TAVILY_API_KEY, not stub)", async () => {
    const result = await dispatchTool(
      { name: "web_search", args: { query: "test" }, toolCallId: "call_9" },
      baseContext,
    );

    // Without TAVILY_API_KEY: returns error but NOT a [STUB]
    expect(result.output).not.toContain("[STUB]");
  });

  it("web_search fails on missing query", async () => {
    const result = await dispatchTool(
      { name: "web_search", args: {}, toolCallId: "call_9b" },
      baseContext,
    );

    expect(result.success).toBe(false);
    expect(result.output).toContain("query");
  });

  it("web_fetch fails on invalid URL", async () => {
    const result = await dispatchTool(
      { name: "web_fetch", args: { url: "not-a-url" }, toolCallId: "call_9c" },
      baseContext,
    );

    expect(result.success).toBe(false);
    expect(result.output).toContain("http");
  });

  it("routes document_read to handler (returns not found, not stub)", async () => {
    const result = await dispatchTool(
      { name: "document_read", args: { slug: "nonexistent" }, toolCallId: "call_10" },
      baseContext,
    );

    expect(result.output).not.toContain("[STUB]");
    expect(result.success).toBe(false);
    expect(result.output).toContain("Not found");
  });

  it("document_write creates document", async () => {
    const result = await dispatchTool(
      { name: "document_write", args: { title: "Test Doc", content: "Hello world" }, toolCallId: "call_10b" },
      baseContext,
    );

    expect(result.success).toBe(true);
    const parsed = JSON.parse(result.output);
    expect(parsed.slug).toBe("test");
    expect(parsed.space).toBe("knowledge");
  });

  it("document_write fails without title", async () => {
    const result = await dispatchTool(
      { name: "document_write", args: { content: "No title" }, toolCallId: "call_10c" },
      baseContext,
    );

    expect(result.success).toBe(false);
    expect(result.output).toContain("title");
  });

  it("document_list returns results", async () => {
    const result = await dispatchTool(
      { name: "document_list", args: {}, toolCallId: "call_10d" },
      baseContext,
    );

    expect(result.success).toBe(true);
    const parsed = JSON.parse(result.output);
    expect(parsed.space).toBe("knowledge");
    expect(Array.isArray(parsed.documents)).toBe(true);
    expect(Array.isArray(parsed.folders)).toBe(true);
  });

  it("routes memory_manage list to handler", async () => {
    const result = await dispatchTool(
      { name: "memory_manage", args: { action: "list" }, toolCallId: "call_11" },
      baseContext,
    );

    expect(result.output).not.toContain("[STUB]");
    expect(result.success).toBe(true);
    const parsed = JSON.parse(result.output);
    expect(parsed.count).toBe(1);
    expect(parsed.entries[0].contentMd).toBe("remember this");
  });

  it("memory_manage append works", async () => {
    const result = await dispatchTool(
      { name: "memory_manage", args: { action: "append", append: "new entry" }, toolCallId: "call_11b" },
      baseContext,
    );

    expect(result.success).toBe(true);
    const parsed = JSON.parse(result.output);
    expect(parsed.appended).toBe(true);
  });

  it("memory_manage fails on unknown action", async () => {
    const result = await dispatchTool(
      { name: "memory_manage", args: { action: "unknown" }, toolCallId: "call_11c" },
      baseContext,
    );

    expect(result.success).toBe(false);
    expect(result.output).toContain("Unknown memory action");
  });

  it("schedule_create validates cron", async () => {
    const result = await dispatchTool(
      { name: "schedule_create", args: { name: "test", cron: "invalid-cron", type: "wake_agent" }, toolCallId: "call_12b" },
      baseContext,
    );

    expect(result.success).toBe(false);
    expect(result.output).toContain("Invalid cron");
  });

  it("schedule_create rejects cli_execute", async () => {
    const result = await dispatchTool(
      { name: "schedule_create", args: { name: "test", cron: "* * * * *", type: "cli_execute" }, toolCallId: "call_12c" },
      baseContext,
    );

    expect(result.success).toBe(false);
    expect(result.output).toContain("Invalid task type");
  });

  it("schedule_create with wake_agent succeeds", async () => {
    const result = await dispatchTool(
      { name: "schedule_create", args: { name: "wake test", cron: "0 * * * *", type: "wake_agent", payload: { prompt: "check markets" } }, toolCallId: "call_12d" },
      baseContext,
    );

    expect(result.success).toBe(true);
    const parsed = JSON.parse(result.output);
    expect(parsed.type).toBe("wake_agent");
    expect(parsed.taskId).toMatch(/^task-/);
  });

  it("schedule_remove works", async () => {
    const result = await dispatchTool(
      { name: "schedule_remove", args: { id: "task-123" }, toolCallId: "call_12e" },
      baseContext,
    );

    expect(result.success).toBe(true);
  });

  it("subagent_spawn returns id", async () => {
    const result = await dispatchTool(
      { name: "subagent_spawn", args: { name: "EchoTest", task: "research markets" }, toolCallId: "call_13" },
      baseContext,
    );

    expect(result.success).toBe(true);
    const parsed = JSON.parse(result.output);
    expect(parsed.id).toMatch(/^subagent-/);
    expect(parsed.name).toBe("EchoTest");
  });

  it("subagent_spawn fails without name", async () => {
    const result = await dispatchTool(
      { name: "subagent_spawn", args: { task: "do something" }, toolCallId: "call_13b" },
      baseContext,
    );

    expect(result.success).toBe(false);
    expect(result.output).toContain("name");
  });

  it("subagent_status returns empty when none active", async () => {
    const result = await dispatchTool(
      { name: "subagent_status", args: {}, toolCallId: "call_13c" },
      baseContext,
    );

    expect(result.success).toBe(true);
    const parsed = JSON.parse(result.output);
    expect(parsed.message).toContain("No active");
  });

  it("routes wallet_read to live handler (not stub)", async () => {
    const result = await dispatchTool(
      { name: "wallet_read", args: { action: "address" }, toolCallId: "call_14" },
      baseContext,
    );

    expect(result.success).toBe(true);
    const parsed = JSON.parse(result.output);
    expect(parsed.chain).toBe("eip155");
    expect(parsed.address).toBe("0x1234567890abcdef1234567890abcdef12345678");
    expect(result.output).not.toContain("[STUB]");
  });

  // ── Unknown tool ─────────────────────────────────────────────────

  it("returns error for completely unknown tool", async () => {
    const result = await dispatchTool(
      { name: "nonexistent_tool", args: {}, toolCallId: "call_15" },
      baseContext,
    );

    expect(result.success).toBe(false);
    expect(result.output).toContain("Unknown tool");
  });

  // ── No stubs remaining ──────────────────────────────────────────

  it("no internal tool returns [STUB]", async () => {
    const internalTools = [
      { name: "web_search", args: { query: "test" } },
      { name: "web_fetch", args: { url: "https://example.com" } },
      { name: "document_read", args: { slug: "test" } },
      { name: "document_write", args: { title: "t", content: "c" } },
      { name: "document_list", args: {} },
      { name: "document_delete", args: { slug: "test" } },
      { name: "memory_manage", args: { action: "list" } },
      { name: "schedule_create", args: { name: "t", cron: "0 * * * *", type: "wake_agent", payload: { prompt: "hi" } } },
      { name: "schedule_remove", args: { id: "task-1" } },
      { name: "subagent_spawn", args: { name: "EchoX", task: "t" } },
      { name: "subagent_status", args: {} },
      { name: "subagent_stop", args: { id: "sub-1" } },
    ];

    for (const tool of internalTools) {
      const result = await dispatchTool(
        { name: tool.name, args: tool.args, toolCallId: `stub_check_${tool.name}` },
        baseContext,
      );
      expect(result.output).not.toContain("[STUB]");
    }
  });
});
