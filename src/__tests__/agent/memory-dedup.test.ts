/**
 * Tests for hash-based memory deduplication in appendMemory and replaceEntry.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "node:crypto";

const mockQuery = vi.fn();
const mockQueryOne = vi.fn();
const mockExecute = vi.fn();

vi.mock("../../agent/db/client.js", () => ({
  query: (...args: unknown[]) => mockQuery(...args),
  queryOne: (...args: unknown[]) => mockQueryOne(...args),
  execute: (...args: unknown[]) => mockExecute(...args),
}));

const { appendMemory, replaceEntry, getMemoryAsText } = await import("../../agent/db/repos/memory.js");

function md5(text: string): string {
  return createHash("md5").update(text).digest("hex");
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("appendMemory with hash dedup", () => {
  it("inserts new entry with content_hash using ON CONFLICT", () => {
    mockExecute.mockResolvedValueOnce(1);
    appendMemory("test entry", "agent", "agent");

    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining("ON CONFLICT (content_hash) WHERE content_hash IS NOT NULL DO NOTHING"),
      expect.arrayContaining(["test entry", "agent", "agent", md5("test entry")]),
    );
  });

  it("returns true when entry is inserted (rowCount=1)", async () => {
    mockExecute.mockResolvedValueOnce(1);
    const result = await appendMemory("new content");
    expect(result).toBe(true);
  });

  it("returns false when duplicate exists (rowCount=0, ON CONFLICT)", async () => {
    mockExecute.mockResolvedValueOnce(0);
    const result = await appendMemory("duplicate content");
    expect(result).toBe(false);
  });

  it("returns false for empty content", async () => {
    const result = await appendMemory("");
    expect(result).toBe(false);
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it("returns false for whitespace-only content", async () => {
    const result = await appendMemory("   \n\t  ");
    expect(result).toBe(false);
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it("trims content before hashing", async () => {
    mockExecute.mockResolvedValueOnce(1);
    await appendMemory("  hello  ");

    expect(mockExecute).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining(["hello", null, "agent", md5("hello")]),
    );
  });

  it("uses correct default source when not provided", async () => {
    mockExecute.mockResolvedValueOnce(1);
    await appendMemory("content");

    expect(mockExecute).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining(["content", null, "agent", expect.any(String)]),
    );
  });

  it("stores category when provided", async () => {
    mockExecute.mockResolvedValueOnce(1);
    await appendMemory("insight text", "compaction", "compaction");

    expect(mockExecute).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining(["insight text", "compaction", "compaction", expect.any(String)]),
    );
  });
});

describe("replaceEntry with hash collision handling", () => {
  it("updates content and content_hash when no collision", async () => {
    mockQueryOne.mockResolvedValueOnce(null); // no collision
    mockExecute.mockResolvedValueOnce(1);

    const result = await replaceEntry(1, "new content");

    expect(result).toBe(true);
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE memory_entries SET content"),
      expect.arrayContaining(["new content", md5("new content"), 1]),
    );
  });

  it("deletes entry when new content matches another entry's hash", async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 5 }); // collision with entry 5
    mockExecute.mockResolvedValueOnce(1);

    const result = await replaceEntry(1, "duplicate of entry 5");

    expect(result).toBe(true);
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining("DELETE FROM memory_entries WHERE id"),
      expect.arrayContaining([1]),
    );
  });

  it("returns false for id <= 0", async () => {
    expect(await replaceEntry(0, "content")).toBe(false);
    expect(await replaceEntry(-1, "content")).toBe(false);
    expect(mockQueryOne).not.toHaveBeenCalled();
  });

  it("returns false for empty content", async () => {
    expect(await replaceEntry(1, "")).toBe(false);
    expect(await replaceEntry(1, "   ")).toBe(false);
    expect(mockQueryOne).not.toHaveBeenCalled();
  });

  it("trims content before hashing for replacement", async () => {
    mockQueryOne.mockResolvedValueOnce(null);
    mockExecute.mockResolvedValueOnce(1);

    await replaceEntry(1, "  trimmed  ");

    expect(mockQueryOne).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining([md5("trimmed"), 1]),
    );
  });

  it("checks collision excluding self (id != $2)", async () => {
    mockQueryOne.mockResolvedValueOnce(null);
    mockExecute.mockResolvedValueOnce(1);

    await replaceEntry(7, "content");

    expect(mockQueryOne).toHaveBeenCalledWith(
      expect.stringContaining("AND id != $2"),
      expect.arrayContaining([expect.any(String), 7]),
    );
  });
});

describe("getMemoryAsText with limit", () => {
  it("uses 500 entry limit by default", async () => {
    mockQuery.mockResolvedValueOnce([]);
    await getMemoryAsText();
    expect(mockQuery).toHaveBeenCalledWith(expect.any(String), [500]);
  });

  it("uses specified limit when provided", async () => {
    mockQuery.mockResolvedValueOnce([]);
    await getMemoryAsText(50);
    expect(mockQuery).toHaveBeenCalledWith(expect.any(String), [50]);
  });

  it("returns empty string when no entries", async () => {
    mockQuery.mockResolvedValueOnce([]);
    const result = await getMemoryAsText();
    expect(result).toBe("");
  });

  it("joins entries with double newline", async () => {
    mockQuery.mockResolvedValueOnce([
      { id: 1, content: "first", category: null, source: null, created_at: "" },
      { id: 2, content: "second", category: null, source: null, created_at: "" },
    ]);
    const result = await getMemoryAsText();
    expect(result).toBe("first\n\nsecond");
  });
});
