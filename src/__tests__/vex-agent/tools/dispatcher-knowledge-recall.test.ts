import { describe, it, expect } from "vitest";
import "./_dispatcher-test-mocks.js";
import {
  mockEmbedQuery,
  mockKnowledgeRecallTopK,
  mockCacheCleanup,
  mockCacheWrite,
  mockCacheRead,
  mockGenerateCacheKey,
} from "./_dispatcher-test-mocks.js";
import { makeTestContext } from "./_test-context.js";

const { dispatchTool } = await import("../../../vex-agent/tools/dispatcher.js");

const baseContext = makeTestContext();

describe("dispatcher — knowledge_recall + knowledge_recall_overflow", () => {
  it("routes knowledge_recall with k <= 10 returns inline only, no overflow", async () => {
    mockKnowledgeRecallTopK.mockResolvedValueOnce(
      Array.from({ length: 5 }, (_, i) => ({
        id: i + 1,
        kind: "memo",
        title: `t${i}`,
        summary: "s",
        contentMd: "c",
        similarity: 0.5,
        confidence: null,
        status: "active" as const,
        pinned: false,
        validUntil: null,
        validFrom: new Date(),
        updatedAt: new Date(),
        sourceRefs: {},
        tags: [],
      })),
    );

    const result = await dispatchTool(
      { name: "knowledge_recall", args: { query: "test", k: 5 }, toolCallId: "call_kr_1" },
      baseContext,
    );

    expect(result.success).toBe(true);
    expect(mockCacheCleanup).toHaveBeenCalledTimes(1); // lazy cleanup
    // embedQuery is called with config (configOverride argument)
    expect(mockEmbedQuery).toHaveBeenCalledTimes(1);
    expect(mockEmbedQuery.mock.calls[0]?.[0]).toBe("test");
    expect(mockCacheWrite).not.toHaveBeenCalled(); // no overflow
    const parsed = JSON.parse(result.output);
    expect(parsed.count).toBe(5);
    expect(parsed.inline).toHaveLength(5);
    expect(parsed.overflow).toBeUndefined();
  });

  it("routes knowledge_recall with k > 10 splits inline + writes overflow cache", async () => {
    mockKnowledgeRecallTopK.mockResolvedValueOnce(
      Array.from({ length: 12 }, (_, i) => ({
        id: i + 1,
        kind: "memo",
        title: `t${i}`,
        summary: "s",
        contentMd: "c",
        similarity: 0.9 - i * 0.01, // descending so order is stable
        confidence: null,
        status: "active" as const,
        pinned: false,
        validUntil: null,
        validFrom: new Date(),
        updatedAt: new Date(),
        sourceRefs: {},
        tags: [],
      })),
    );

    const result = await dispatchTool(
      { name: "knowledge_recall", args: { query: "test", k: 12 }, toolCallId: "call_kr_2" },
      baseContext,
    );

    expect(result.success).toBe(true);
    // Sequence: cleanupExpired must be called BEFORE writeCache
    const cleanupOrder = mockCacheCleanup.mock.invocationCallOrder[0]!;
    const writeOrder = mockCacheWrite.mock.invocationCallOrder[0]!;
    expect(cleanupOrder).toBeLessThan(writeOrder);

    expect(mockCacheWrite).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(result.output);
    expect(parsed.inline).toHaveLength(10);
    expect(parsed.overflow).toBeDefined();
    expect(parsed.overflow.cacheKey).toBe("rcl-test");
    expect(parsed.overflow.remainingCount).toBe(2);
  });

  it("knowledge_recall fails loud when embedding service throws", async () => {
    mockEmbedQuery.mockRejectedValueOnce(new Error("sidecar offline"));
    const result = await dispatchTool(
      { name: "knowledge_recall", args: { query: "test" }, toolCallId: "call_kr_3" },
      baseContext,
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("embedding service unavailable");
  });

  it("knowledge_recall fails loud when overflow cache write throws (fix 3)", async () => {
    mockKnowledgeRecallTopK.mockResolvedValueOnce(
      Array.from({ length: 12 }, (_, i) => ({
        id: i + 1,
        kind: "memo",
        title: `t${i}`,
        summary: "s",
        contentMd: "c",
        similarity: 0.9 - i * 0.01,
        confidence: null,
        status: "active" as const,
        pinned: false,
        validUntil: null,
        validFrom: new Date(),
        updatedAt: new Date(),
        sourceRefs: {},
        tags: [],
      })),
    );
    mockCacheWrite.mockRejectedValueOnce(new Error("disk full"));

    const result = await dispatchTool(
      { name: "knowledge_recall", args: { query: "test", k: 12 }, toolCallId: "call_kr_4" },
      baseContext,
    );
    expect(result.success).toBe(false);
    // Helpful retry hint instructs the agent how to recover.
    expect(result.output).toContain("overflow cache write failed");
    expect(result.output).toContain("Retry with k=10");
  });

  it("knowledge_recall passes full filter set to generateCacheKey (fix 2)", async () => {
    mockKnowledgeRecallTopK.mockResolvedValueOnce(
      Array.from({ length: 12 }, (_, i) => ({
        id: i + 1,
        kind: "memo",
        title: `t${i}`,
        summary: "s",
        contentMd: "c",
        similarity: 0.9 - i * 0.01,
        confidence: null,
        status: "active" as const,
        pinned: false,
        validUntil: null,
        validFrom: new Date(),
        updatedAt: new Date(),
        sourceRefs: {},
        tags: [],
      })),
    );
    mockGenerateCacheKey.mockClear();
    mockCacheWrite.mockResolvedValueOnce({ cacheKey: "rcl-test", expiresAt: "2026-04-06T12:15:00Z" });

    await dispatchTool(
      {
        name: "knowledge_recall",
        args: { query: "early holder", k: 12, kind: "memo", include_expired: false },
        toolCallId: "call_kr_5",
      },
      baseContext,
    );

    expect(mockGenerateCacheKey).toHaveBeenCalledTimes(1);
    const [calledQuery, calledFilters] = mockGenerateCacheKey.mock.calls[0]!;
    expect(calledQuery).toBe("early holder");
    expect(calledFilters).toEqual({ k: 12, kind: "memo", includeExpired: false });
  });

  it("knowledge_recall_overflow returns cached results", async () => {
    mockCacheRead.mockResolvedValueOnce({
      results: [{ id: 1, kind: "memo", title: "t", summary: "s", contentMd: "c", similarity: 0.5, confidence: null, status: "active", pinned: false, validUntil: null, sourceRefs: {}, tags: [] }],
      expiresAt: "2026-04-06T12:15:00Z",
    });
    const result = await dispatchTool(
      { name: "knowledge_recall_overflow", args: { cacheKey: "rcl-test" }, toolCallId: "call_ko_1" },
      baseContext,
    );
    expect(result.success).toBe(true);
    const parsed = JSON.parse(result.output);
    expect(parsed.results).toHaveLength(1);
  });

  it("knowledge_recall_overflow fails on cache miss", async () => {
    mockCacheRead.mockResolvedValueOnce(null);
    const result = await dispatchTool(
      { name: "knowledge_recall_overflow", args: { cacheKey: "missing" }, toolCallId: "call_ko_2" },
      baseContext,
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("not found or expired");
  });
});
