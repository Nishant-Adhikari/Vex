/**
 * Unit tests for the long_memory_search / get / history handlers (S3). The DB
 * repos and the embeddings client are mocked, so these tests exercise only the
 * handler control flow — embed → recall both stores → blend → inline cap +
 * truncate-with-steering → format — never a real database or embeddings service.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const TEST_DIM = 8;
const TEST_PROVIDER_MODEL = "ai/embeddinggemma:300M-Q8_0";

// ── Mocks ─────────────────────────────────────────────────────────

const mockRecallLongMemoryTopK = vi.fn();
const mockGetById = vi.fn();
const mockGetLineageChain = vi.fn();
vi.mock("@vex-agent/db/repos/knowledge.js", () => ({
  recallLongMemoryTopK: (...args: unknown[]) => mockRecallLongMemoryTopK(...args),
  getById: (...args: unknown[]) => mockGetById(...args),
  getLineageChain: (...args: unknown[]) => mockGetLineageChain(...args),
}));

const mockRecallCandidatesTopK = vi.fn();
vi.mock("@vex-agent/db/repos/memory-candidates/index.js", () => ({
  recallCandidatesTopK: (...args: unknown[]) => mockRecallCandidatesTopK(...args),
}));

const mockEmbedQuery = vi.fn();
vi.mock("@vex-agent/embeddings/client.js", () => ({
  embedQuery: (...args: unknown[]) => mockEmbedQuery(...args),
}));

const mockLoadEmbeddingConfig = vi.fn(() => ({
  baseUrl: "http://localhost:12434/engines/llama.cpp/v1",
  model: TEST_PROVIDER_MODEL,
  dim: TEST_DIM,
  provider: "local",
}));
vi.mock("@vex-agent/embeddings/config.js", () => ({
  loadEmbeddingConfig: () => mockLoadEmbeddingConfig(),
}));

const mockMemLog = vi.fn();
vi.mock("@vex-agent/memory/observability/logger.js", () => ({
  memLog: Object.assign((...args: unknown[]) => mockMemLog(...args), {
    warn: (...args: unknown[]) => mockMemLog(...args),
    error: (...args: unknown[]) => mockMemLog(...args),
  }),
}));

import { handleLongMemorySearch } from "@vex-agent/tools/internal/long-memory/search.js";
import { handleLongMemoryGet } from "@vex-agent/tools/internal/long-memory/get.js";
import { handleLongMemoryHistory } from "@vex-agent/tools/internal/long-memory/history.js";
import type { InternalToolContext } from "@vex-agent/tools/internal/types.js";
import { LONG_MEMORY_INLINE_CHARS_CAP } from "@vex-agent/memory/long-memory-retrieval-policy.js";

// ── Helpers ───────────────────────────────────────────────────────

function ctx(): InternalToolContext {
  return { sessionId: "session-1", loadedDocuments: new Map<string, string>() } as unknown as InternalToolContext;
}

function vector(): number[] {
  return Array.from({ length: TEST_DIM }, (_, i) => i / TEST_DIM);
}

/** A knowledge recall candidate (shape of recallLongMemoryTopK rows). */
function knowledgeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    kind: "risk_rule",
    title: "Position sizing rule",
    summary: "Keep risk under 2% per trade.",
    contentMd: "Full body.",
    similarity: 0.8,
    confidence: 0.9,
    status: "active",
    pinned: false,
    validUntil: null,
    validFrom: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-06-01T00:00:00.000Z"),
    sourceRefs: {},
    tags: ["risk"],
    source: "observed",
    maturityState: "established",
    ...overrides,
  };
}

/** A dual-trace candidate recall row (shape of recallCandidatesTopK rows). */
function candidateRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    kind: "trade_lesson",
    title: "Fresh signal",
    summary: "A fresh un-consolidated observation.",
    contentMd: "",
    tags: [],
    evidenceRefs: [],
    source: "observed",
    retrievalUntil: null,
    similarity: 0.7,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockEmbedQuery.mockResolvedValue({ embedding: vector(), providerModel: TEST_PROVIDER_MODEL });
  mockRecallLongMemoryTopK.mockResolvedValue([knowledgeRow()]);
  mockRecallCandidatesTopK.mockResolvedValue([candidateRow()]);
});

// ── search: blended union ─────────────────────────────────────────

describe("long_memory_search — blended recall", () => {
  it("embeds the query and returns a blended union tagged by source", async () => {
    const res = await handleLongMemorySearch({ query: "risk preferences" }, ctx());
    expect(res.success).toBe(true);
    expect(mockEmbedQuery).toHaveBeenCalledTimes(1);

    const data = JSON.parse(res.output);
    const sources = data.results.map((r: { source: string }) => r.source);
    expect(sources).toContain("long_memory");
    expect(sources).toContain("memory_candidate");
    // Confirmed knowledge (observed, sim 0.8 + boosts) ranks above the candidate
    // (sim 0.7 × 0.6).
    expect(data.results[0].source).toBe("long_memory");
  });

  it("passes the providerModel + embedding length as the recall filter for BOTH stores", async () => {
    await handleLongMemorySearch({ query: "x" }, ctx());
    const kFilter = mockRecallLongMemoryTopK.mock.calls[0]![1] as Record<string, unknown>;
    expect(kFilter.embeddingModel).toBe(TEST_PROVIDER_MODEL);
    expect(kFilter.embeddingDim).toBe(TEST_DIM);
    expect(kFilter.includeExpired).toBe(false);

    const cFilter = mockRecallCandidatesTopK.mock.calls[0]![1] as Record<string, unknown>;
    expect(cFilter.embeddingModel).toBe(TEST_PROVIDER_MODEL);
    expect(cFilter.embeddingDim).toBe(TEST_DIM);
  });

  it("marks candidate results notConsolidated", async () => {
    const res = await handleLongMemorySearch({ query: "x" }, ctx());
    const data = JSON.parse(res.output);
    const cand = data.results.find((r: { source: string }) => r.source === "memory_candidate");
    expect(cand.notConsolidated).toBe(true);
  });
});

describe("long_memory_search — include_candidates flag", () => {
  it("returns only long_memory results when include_candidates is false", async () => {
    const res = await handleLongMemorySearch({ query: "x", include_candidates: false }, ctx());
    expect(mockRecallCandidatesTopK).not.toHaveBeenCalled();
    const data = JSON.parse(res.output);
    expect(data.results.every((r: { source: string }) => r.source === "long_memory")).toBe(true);
    expect(data.candidateCount).toBe(0);
  });
});

describe("long_memory_search — expand_graph hook", () => {
  it("returns no extra results for expand_graph (empty hook until S8)", async () => {
    mockRecallCandidatesTopK.mockResolvedValue([]);
    const withGraph = await handleLongMemorySearch({ query: "x", expand_graph: true }, ctx());
    const withoutGraph = await handleLongMemorySearch({ query: "x", expand_graph: false }, ctx());
    const a = JSON.parse(withGraph.output);
    const b = JSON.parse(withoutGraph.output);
    expect(a.results.length).toBe(b.results.length);
  });
});

describe("long_memory_search — truncation with steering (no silent drop)", () => {
  it("truncates to the inline cap, emits search.truncated, and adds a steering hint", async () => {
    // 12 knowledge entries (above the inline cap of 10), all active/observed.
    const many = Array.from({ length: 12 }, (_, i) =>
      knowledgeRow({ id: i + 1, similarity: 0.9 - i * 0.01 }),
    );
    mockRecallLongMemoryTopK.mockResolvedValue(many);
    mockRecallCandidatesTopK.mockResolvedValue([]);

    const res = await handleLongMemorySearch({ query: "x" }, ctx());
    const data = JSON.parse(res.output);

    expect(data.count).toBe(10);
    expect(data.truncated).toBe(true);
    expect(data.droppedCount).toBe(2);
    expect(data.steering).toMatch(/refine your query/);

    const truncatedEvents = mockMemLog.mock.calls.filter(
      (c) => c[0] === "search" && c[1] === "truncated",
    );
    expect(truncatedEvents).toHaveLength(1);
    expect(truncatedEvents[0]![2]).toEqual({ count: 2 });
  });

  it("does not emit search.truncated when the set fits inline", async () => {
    const res = await handleLongMemorySearch({ query: "x" }, ctx());
    const data = JSON.parse(res.output);
    expect(data.truncated).toBe(false);
    const truncatedEvents = mockMemLog.mock.calls.filter(
      (c) => c[0] === "search" && c[1] === "truncated",
    );
    expect(truncatedEvents).toHaveLength(0);
  });

  it("does not apply the chars cap to a concise response (concise omits contentMd)", async () => {
    // 5 entries, each contentMd alone busts the 50KB chars cap; concise must
    // still return all 5 (under the count cap) because it never sends contentMd.
    const big = "x".repeat(LONG_MEMORY_INLINE_CHARS_CAP);
    const rows = Array.from({ length: 5 }, (_, i) =>
      knowledgeRow({ id: i + 1, similarity: 0.9 - i * 0.01, contentMd: big }),
    );
    mockRecallLongMemoryTopK.mockResolvedValue(rows);
    mockRecallCandidatesTopK.mockResolvedValue([]);
    const res = await handleLongMemorySearch({ query: "x", response_format: "concise" }, ctx());
    const data = JSON.parse(res.output);
    expect(data.count).toBe(5);
    expect(data.truncated).toBe(false);
  });
});

describe("long_memory_search — response shapes", () => {
  it("concise omits content/summary detail", async () => {
    mockRecallCandidatesTopK.mockResolvedValue([]);
    const res = await handleLongMemorySearch({ query: "x", response_format: "concise" }, ctx());
    const data = JSON.parse(res.output);
    const item = data.results[0];
    expect(item).toHaveProperty("id");
    expect(item).toHaveProperty("similarity");
    expect(item).toHaveProperty("score");
    expect(item).not.toHaveProperty("contentMd");
    expect(item).not.toHaveProperty("summary");
  });

  it("detailed adds summary, content, tags, maturity, source tier", async () => {
    mockRecallCandidatesTopK.mockResolvedValue([]);
    const res = await handleLongMemorySearch({ query: "x", response_format: "detailed" }, ctx());
    const data = JSON.parse(res.output);
    const item = data.results[0];
    expect(item).toHaveProperty("summary");
    expect(item).toHaveProperty("contentMd");
    expect(item).toHaveProperty("tags");
    expect(item).toHaveProperty("maturityState");
    expect(item).toHaveProperty("sourceTier");
  });
});

describe("long_memory_search — empty + failure paths", () => {
  it("returns a clean nothing-found steering message when no memory matches", async () => {
    mockRecallLongMemoryTopK.mockResolvedValue([]);
    mockRecallCandidatesTopK.mockResolvedValue([]);
    const res = await handleLongMemorySearch({ query: "nothing" }, ctx());
    expect(res.success).toBe(false);
    expect(res.output).toMatch(/No long-term memory matched/);
  });

  it("fails loud on an embedding outage (no fallback)", async () => {
    mockEmbedQuery.mockRejectedValue(new Error("sidecar down"));
    const res = await handleLongMemorySearch({ query: "x" }, ctx());
    expect(res.success).toBe(false);
    expect(res.output).toMatch(/embedding service unavailable/);
    expect(mockRecallLongMemoryTopK).not.toHaveBeenCalled();
  });

  it("rejects an empty query at the boundary", async () => {
    const res = await handleLongMemorySearch({ query: "" }, ctx());
    expect(res.success).toBe(false);
    expect(mockEmbedQuery).not.toHaveBeenCalled();
  });

  it("rejects an unknown param with a steering message (no silent drop)", async () => {
    // A removed/typo'd param like `scope` must be REJECTED, not silently ignored,
    // so the agent gets actionable feedback (final-gate fix).
    const res = await handleLongMemorySearch({ query: "x", scope: "all" }, ctx());
    expect(res.success).toBe(false);
    expect(res.output).toMatch(/unknown parameter/i);
    expect(res.output).toMatch(/scope/);
    expect(mockEmbedQuery).not.toHaveBeenCalled();
  });
});

// ── get ───────────────────────────────────────────────────────────

describe("long_memory_get", () => {
  it("returns an active entry and loads its content into context", async () => {
    mockGetById.mockResolvedValue({
      id: 5,
      kind: "risk_rule",
      title: "T",
      summary: "S",
      contentMd: "BODY",
      tags: [],
      sourceRefs: {},
      confidence: null,
      status: "active",
      pinned: false,
      validUntil: null,
      source: "observed",
      maturityState: "established",
      supersedesId: null,
      supersededBy: null,
      statusReason: null,
      changeSummary: null,
      whatFailed: null,
    });
    const context = ctx();
    const res = await handleLongMemoryGet({ id: 5 }, context);
    expect(res.success).toBe(true);
    const data = JSON.parse(res.output);
    expect(data.id).toBe(5);
    expect(data.contentMd).toBe("BODY");
    expect(context.loadedDocuments.get("long_memory:5")).toBe("BODY");
  });

  it("steers to the successor when the entry was superseded", async () => {
    mockGetById.mockResolvedValue({
      id: 5,
      status: "superseded",
      supersededBy: 9,
      contentMd: "x",
    });
    const res = await handleLongMemoryGet({ id: 5 }, ctx());
    expect(res.success).toBe(false);
    expect(res.output).toMatch(/entry 9/);
  });

  it("returns a not-found steering message for a missing id", async () => {
    mockGetById.mockResolvedValue(null);
    const res = await handleLongMemoryGet({ id: 404 }, ctx());
    expect(res.success).toBe(false);
    expect(res.output).toMatch(/not found/);
  });
});

// ── history ───────────────────────────────────────────────────────

describe("long_memory_history", () => {
  it("returns the lineage chain merged with the entry's reinforcement fields", async () => {
    mockGetLineageChain.mockResolvedValue({
      requestedId: 5,
      headId: 9,
      headStatus: "active",
      chain: [
        { id: 5, kind: "k", title: "old", status: "superseded", supersedesId: null },
        { id: 9, kind: "k", title: "new", status: "active", supersedesId: 5 },
      ],
    });
    mockGetById.mockResolvedValue({
      id: 5,
      firstPromotedAt: "2026-05-01T00:00:00.000Z",
      lastReinforcedAt: "2026-06-01T00:00:00.000Z",
      outcomeVersion: 3,
      maturityState: "reinforced",
    });

    const res = await handleLongMemoryHistory({ id: 5 }, ctx());
    expect(res.success).toBe(true);
    const data = JSON.parse(res.output);
    expect(data.chainLength).toBe(2);
    expect(data.headId).toBe(9);
    expect(data.reinforcement.firstPromotedAt).toBe("2026-05-01T00:00:00.000Z");
    expect(data.reinforcement.lastReinforcedAt).toBe("2026-06-01T00:00:00.000Z");
    expect(data.reinforcement.outcomeVersion).toBe(3);
  });

  it("returns a not-found steering message when the chain is empty", async () => {
    mockGetLineageChain.mockResolvedValue(null);
    const res = await handleLongMemoryHistory({ id: 404 }, ctx());
    expect(res.success).toBe(false);
    expect(res.output).toMatch(/not found/);
  });
});
