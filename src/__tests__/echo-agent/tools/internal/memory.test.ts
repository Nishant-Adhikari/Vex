import { describe, it, expect, vi, beforeEach } from "vitest";

const mockList = vi.fn();
const mockAppend = vi.fn();
const mockReplace = vi.fn();
const mockDelete = vi.fn();

vi.mock("@echo-agent/db/repos/memory.js", () => ({
  listEntriesWithIds: (...args: unknown[]) => mockList(...args),
  appendMemory: (...args: unknown[]) => mockAppend(...args),
  replaceEntry: (...args: unknown[]) => mockReplace(...args),
  deleteEntry: (...args: unknown[]) => mockDelete(...args),
}));

const { handleMemoryManage } = await import("../../../../echo-agent/tools/internal/memory.js");

const baseContext = {
  sessionId: "test",
  loadedDocuments: new Map<string, string>(),
  loopMode: "off" as const,
  approved: false,
};

describe("handleMemoryManage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockList.mockResolvedValue([]);
    mockAppend.mockResolvedValue(true);
    mockReplace.mockResolvedValue(true);
    mockDelete.mockResolvedValue(true);
  });

  // ── list ───────────────────────────────────────────────────────

  it("list returns entries", async () => {
    mockList.mockResolvedValueOnce([
      { id: 1, contentMd: "entry one", category: null, createdAt: "2024-01-01" },
      { id: 2, contentMd: "entry two", category: "trading", createdAt: "2024-01-02" },
    ]);

    const result = await handleMemoryManage({ action: "list" }, baseContext);
    expect(result.success).toBe(true);
    const parsed = JSON.parse(result.output);
    expect(parsed.count).toBe(2);
    expect(parsed.entries[0].contentMd).toBe("entry one");
    expect(parsed.entries[1].category).toBe("trading");
  });

  it("list returns empty when no entries", async () => {
    const result = await handleMemoryManage({ action: "list" }, baseContext);
    expect(result.success).toBe(true);
    const parsed = JSON.parse(result.output);
    expect(parsed.count).toBe(0);
  });

  // ── append ────────────────────────────────────────────────────

  it("append succeeds with 'append' param", async () => {
    const result = await handleMemoryManage({ action: "append", append: "remember this" }, baseContext);
    expect(result.success).toBe(true);
    expect(mockAppend).toHaveBeenCalledWith("remember this", undefined, "echo-agent");
    const parsed = JSON.parse(result.output);
    expect(parsed.appended).toBe(true);
  });

  it("append also accepts 'content' param", async () => {
    const result = await handleMemoryManage({ action: "append", content: "also works" }, baseContext);
    expect(result.success).toBe(true);
    expect(mockAppend).toHaveBeenCalledWith("also works", undefined, "echo-agent");
  });

  it("append fails without text", async () => {
    const result = await handleMemoryManage({ action: "append" }, baseContext);
    expect(result.success).toBe(false);
    expect(result.output).toContain("Missing");
  });

  it("append reports duplicate", async () => {
    mockAppend.mockResolvedValueOnce(false);
    const result = await handleMemoryManage({ action: "append", append: "dup" }, baseContext);
    expect(result.success).toBe(true);
    const parsed = JSON.parse(result.output);
    expect(parsed.appended).toBe(false);
    expect(parsed.message).toContain("Duplicate");
  });

  // ── replace ───────────────────────────────────────────────────

  it("replace succeeds with id and content", async () => {
    const result = await handleMemoryManage({ action: "replace", id: 5, content: "updated" }, baseContext);
    expect(result.success).toBe(true);
    expect(mockReplace).toHaveBeenCalledWith(5, "updated");
  });

  it("replace fails without id", async () => {
    const result = await handleMemoryManage({ action: "replace", content: "no id" }, baseContext);
    expect(result.success).toBe(false);
    expect(result.output).toContain("id");
  });

  it("replace fails without content", async () => {
    const result = await handleMemoryManage({ action: "replace", id: 1 }, baseContext);
    expect(result.success).toBe(false);
    expect(result.output).toContain("content");
  });

  it("replace returns not found", async () => {
    mockReplace.mockResolvedValueOnce(false);
    const result = await handleMemoryManage({ action: "replace", id: 999, content: "x" }, baseContext);
    expect(result.success).toBe(false);
    expect(result.output).toContain("not found");
  });

  // ── delete ────────────────────────────────────────────────────

  it("delete succeeds", async () => {
    const result = await handleMemoryManage({ action: "delete", id: 3 }, baseContext);
    expect(result.success).toBe(true);
    expect(mockDelete).toHaveBeenCalledWith(3);
  });

  it("delete fails without id", async () => {
    const result = await handleMemoryManage({ action: "delete" }, baseContext);
    expect(result.success).toBe(false);
    expect(result.output).toContain("id");
  });

  it("delete returns not found", async () => {
    mockDelete.mockResolvedValueOnce(false);
    const result = await handleMemoryManage({ action: "delete", id: 999 }, baseContext);
    expect(result.success).toBe(false);
    expect(result.output).toContain("not found");
  });

  // ── unknown action ────────────────────────────────────────────

  it("fails on unknown action", async () => {
    const result = await handleMemoryManage({ action: "purge" }, baseContext);
    expect(result.success).toBe(false);
    expect(result.output).toContain("Unknown memory action");
  });

  it("fails on empty action", async () => {
    const result = await handleMemoryManage({ action: "" }, baseContext);
    expect(result.success).toBe(false);
  });
});
