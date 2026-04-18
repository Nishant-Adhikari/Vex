/**
 * Unit tests for db/repos/session-episodes — guards + light integration.
 *
 * Full SQL-script tests for the transactional insert path are expensive and
 * low-ROI at this stage. We cover here the invariants that can fail silently:
 *   - embedding length vs. embeddingDim mismatch throws BEFORE any SQL is run
 *     (mirrors the DB CHECK constraint and gives a clearer error to callers).
 *   - recallTopK refuses queries whose dim disagrees with the filter.
 *   - recallTopK maps cosine distance to similarity and honors minSimilarity.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockQuery = vi.fn();
const mockPoolConnect = vi.fn();

vi.mock("@echo-agent/db/client.js", () => ({
  execute: vi.fn(),
  queryOne: vi.fn(),
  query: (...args: unknown[]) => mockQuery(...args),
  getPool: () => ({ connect: () => mockPoolConnect() }),
}));

const { insertEpisodes, recallTopK } = await import(
  "../../../../echo-agent/db/repos/session-episodes.js"
);

function makeRow(overrides: Partial<Parameters<typeof insertEpisodes>[0][number]> = {}) {
  return {
    sessionId: "session-1",
    memoryScopeKey: "scope-1",
    episodeKind: "fact" as const,
    title: "",
    summaryText: "a fact",
    sourceStartMessageId: 1,
    sourceEndMessageId: 9,
    episodeHash: "h".repeat(64),
    embeddingModel: "test-model",
    embeddingDim: 4,
    embedding: [0.1, 0.2, 0.3, 0.4],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("insertEpisodes guards", () => {
  it("throws before any SQL when embedding length does not match embeddingDim", async () => {
    const release = vi.fn();
    const clientQuery = vi.fn();
    mockPoolConnect.mockResolvedValue({ query: clientQuery, release });

    await expect(
      insertEpisodes([makeRow({ embedding: [0.1, 0.2], embeddingDim: 4 })]),
    ).rejects.toThrow(/does not match embeddingDim/);

    expect(clientQuery).not.toHaveBeenCalled();
    expect(mockPoolConnect).not.toHaveBeenCalled();
  });

  it("returns [] immediately when the input batch is empty", async () => {
    mockPoolConnect.mockResolvedValue({ query: vi.fn(), release: vi.fn() });
    const result = await insertEpisodes([]);
    expect(result).toEqual([]);
    expect(mockPoolConnect).not.toHaveBeenCalled();
  });
});

describe("recallTopK guards + similarity", () => {
  it("returns [] immediately when topK <= 0", async () => {
    const result = await recallTopK([0.1, 0.2, 0.3, 0.4], {
      memoryScopeKey: "scope-1",
      embeddingModel: "test-model",
      embeddingDim: 4,
      topK: 0,
    });
    expect(result).toEqual([]);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("throws when query embedding length does not match filter dim", async () => {
    await expect(
      recallTopK([0.1, 0.2], {
        memoryScopeKey: "scope-1",
        embeddingModel: "test-model",
        embeddingDim: 4,
        topK: 5,
      }),
    ).rejects.toThrow(/does not match filter dim/);
  });

  it("maps cosine distance to similarity and filters by minSimilarity", async () => {
    mockQuery.mockResolvedValue([
      {
        id: 1,
        session_id: "s",
        memory_scope_key: "scope-1",
        episode_kind: "fact",
        title: "close hit topic",
        summary_text: "close hit",
        facts_jsonb: {},
        decisions_jsonb: {},
        open_loops_jsonb: {},
        entities: [],
        tool_outcomes_jsonb: {},
        source_surface: "echo_agent",
        source_session: "s",
        source_start_message_id: 1,
        source_end_message_id: 2,
        episode_hash: "h".repeat(64),
        embedding_model: "test-model",
        embedding_dim: 4,
        created_at: "2026-04-01T00:00:00Z",
        cosine_distance: 0.1, // similarity = 0.9
      },
      {
        id: 2,
        session_id: "s",
        memory_scope_key: "scope-1",
        episode_kind: "fact",
        title: "far hit topic",
        summary_text: "far hit",
        facts_jsonb: {},
        decisions_jsonb: {},
        open_loops_jsonb: {},
        entities: [],
        tool_outcomes_jsonb: {},
        source_surface: "echo_agent",
        source_session: "s",
        source_start_message_id: 3,
        source_end_message_id: 4,
        episode_hash: "h".repeat(64),
        embedding_model: "test-model",
        embedding_dim: 4,
        created_at: "2026-04-01T00:00:00Z",
        cosine_distance: 0.9, // similarity = 0.1
      },
    ]);

    const hits = await recallTopK([0.1, 0.2, 0.3, 0.4], {
      memoryScopeKey: "scope-1",
      embeddingModel: "test-model",
      embeddingDim: 4,
      topK: 5,
      minSimilarity: 0.5,
    });

    expect(hits).toHaveLength(1);
    expect(hits[0].episode.id).toBe(1);
    expect(hits[0].similarity).toBeCloseTo(0.9, 5);
  });
});
