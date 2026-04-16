import { describe, it, expect } from "vitest";
import "./_dispatcher-test-mocks.js";
import { makeTestContext } from "./_test-context.js";

const { dispatchTool } = await import("../../../echo-agent/tools/dispatcher.js");

const baseContext = makeTestContext();

describe("dispatcher — schedule, subagent, wallet, unknown, no-stubs", () => {
  // ── Schedule ─────────────────────────────────────────────────────

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

  // ── Subagent ─────────────────────────────────────────────────────

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

  // ── Wallet ───────────────────────────────────────────────────────

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
      { name: "knowledge_write", args: { kind: "memo", title: "t", summary: "s" } },
      { name: "knowledge_recall", args: { query: "test" } },
      { name: "knowledge_recall_overflow", args: { cacheKey: "rcl-test" } },
      { name: "knowledge_get", args: { id: 1 } },
      { name: "knowledge_update_status", args: { id: 1, status: "archived" } },
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
