import { describe, it, expect } from "vitest";
import "./_dispatcher-test-mocks.js";
import { makeTestContext } from "./_test-context.js";

const { dispatchTool } = await import("../../../echo-agent/tools/dispatcher.js");

const baseContext = makeTestContext();

describe("dispatcher — web + document tools", () => {
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
    expect(parsed.space).toBe("notes");
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
    expect(parsed.space).toBe("notes");
    expect(Array.isArray(parsed.documents)).toBe(true);
    expect(Array.isArray(parsed.folders)).toBe(true);
  });
});
