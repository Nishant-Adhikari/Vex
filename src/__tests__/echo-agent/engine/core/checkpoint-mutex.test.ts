/**
 * PR-8 — per-session serialization of `executeCheckpoint`.
 *
 * Two guarantees are tested here:
 *
 *   1. Process-local mutex: concurrent callers on the same session queue up on
 *      the promise chain and run sequentially. Unrelated sessions remain
 *      independent. Prevents double-entry into Phase I's remote LLM calls for
 *      the same session window.
 *
 *   2. Phase II generation bump: inside the atomic write tx, checkpoint.ts
 *      issues `SELECT checkpoint_generation ... FOR UPDATE`, stamps episodes
 *      with `current + 1`, and persists the new counter via `UPDATE sessions
 *      SET checkpoint_generation = $2`. The tx.query log asserts that order.
 *
 * The `executeCheckpoint` public surface is exercised through a fake provider
 * and mocked repos — same pattern as `checkpoint.test.ts`, scoped to the
 * behaviour introduced in PR-8.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────

const mockGetSession = vi.fn();
const mockSetRollingSummary = vi.fn();
const mockArchivePrefix = vi.fn();
const mockForkToolMessageToArchive = vi.fn();
const mockGetLiveMessagesWithId = vi.fn();
const mockInsertEpisodes = vi.fn();
const mockEmbedDocument = vi.fn();

vi.mock("@echo-agent/db/repos/sessions.js", () => ({
  getSession: (...a: unknown[]) => mockGetSession(...a),
  setRollingSummary: (...a: unknown[]) => mockSetRollingSummary(...a),
  archivePrefix: (...a: unknown[]) => mockArchivePrefix(...a),
  forkToolMessageToArchive: (...a: unknown[]) => mockForkToolMessageToArchive(...a),
}));

vi.mock("@echo-agent/db/repos/messages.js", async () => {
  const actual = await vi.importActual<typeof import("../../../../echo-agent/db/repos/messages.js")>(
    "@echo-agent/db/repos/messages.js",
  );
  return {
    ...actual,
    getLiveMessagesWithId: (...a: unknown[]) => mockGetLiveMessagesWithId(...a),
  };
});

vi.mock("@echo-agent/db/repos/session-episodes.js", async () => {
  const actual = await vi.importActual<typeof import("../../../../echo-agent/db/repos/session-episodes.js")>(
    "@echo-agent/db/repos/session-episodes.js",
  );
  return {
    ...actual,
    insertEpisodes: (...a: unknown[]) => mockInsertEpisodes(...a),
  };
});

vi.mock("@echo-agent/embeddings/client.js", () => ({
  embedDocument: (...a: unknown[]) => mockEmbedDocument(...a),
  embedQuery: vi.fn(),
}));

// Default tx.query mock — returns the generation SELECT result when the SQL
// matches, and empty rows otherwise (BEGIN/COMMIT/UPDATE ignore the rows).
// Per-test overrides can reset `currentGenerationValue` to simulate e.g. a
// first-time checkpoint (0 → 1) or a mid-life session (5 → 6).
let currentGenerationValue = 0;
const mockTxQuery = vi.fn().mockImplementation(async (sql: string) => {
  if (sql.includes("SELECT checkpoint_generation")) {
    return { rows: [{ checkpoint_generation: currentGenerationValue }], rowCount: 1 };
  }
  return { rows: [], rowCount: 0 };
});
const mockTxRelease = vi.fn();
const mockPoolConnect = vi.fn().mockImplementation(async () => ({
  query: mockTxQuery,
  release: mockTxRelease,
}));

vi.mock("@echo-agent/db/client.js", () => ({
  getPool: () => ({ connect: mockPoolConnect }),
  execute: vi.fn(),
  query: vi.fn().mockResolvedValue([]),
  queryOne: vi.fn().mockResolvedValue(null),
  queryWith: vi.fn().mockResolvedValue([]),
  queryOneWith: vi.fn().mockResolvedValue(null),
  executeWith: vi.fn(),
}));

const {
  executeCheckpoint,
  __resetCheckpointCooldownForTests,
  __resetCheckpointMutexForTests,
} = await import("../../../../echo-agent/engine/core/checkpoint.js");

// ── Helpers ───────────────────────────────────────────────────

function msg(
  id: number,
  role: "user" | "assistant" | "tool" | "system",
  content: string,
) {
  return {
    id,
    role,
    content,
    timestamp: `2026-04-01T00:00:${id.toString().padStart(2, "0")}Z`,
  };
}

// Minimal prefix-eligible session (> TAIL_WINDOW).
function buildPrefixSession() {
  const rows = [];
  for (let i = 1; i <= 14; i++) {
    rows.push(msg(i, i % 2 === 1 ? "user" : "assistant", `msg ${i}`));
  }
  rows.push(msg(15, "user", "last"));
  return rows;
}

function makeProvider(summary: string) {
  const simple = vi.fn().mockImplementation(async (messages: any[]) => {
    const prompt = messages[0]?.content ?? "";
    if (prompt.includes("rolling summary")) {
      return { content: summary, usage: {} };
    }
    // extract → one decision episode
    return {
      content: JSON.stringify({
        episodes: [
          {
            episode_kind: "decision",
            title: "t",
            summary_text: "decided",
            facts: {},
            decisions: {},
            open_loops: {},
            entities: [],
            tool_outcomes: {},
          },
        ],
        session_language_inferred: "en",
      }),
      usage: {},
    };
  });
  return { chatCompletionSimple: simple };
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetCheckpointCooldownForTests();
  __resetCheckpointMutexForTests();
  currentGenerationValue = 0;

  mockGetSession.mockResolvedValue({
    id: "session-1",
    summary: null,
    memoryLanguageCode: "en",
  });
  mockInsertEpisodes.mockImplementation(async (rows: any[]) =>
    rows.map((r, i) => ({ id: i + 100, episodeKind: r.episodeKind })),
  );
  mockEmbedDocument.mockResolvedValue({
    embedding: [0.1, 0.2, 0.3, 0.4],
    providerModel: "test-embed-model",
  });
});

// ── Generation bump (Phase II) ────────────────────────────────

describe("executeCheckpoint — Phase II generation bump", () => {
  it("reads current generation with FOR UPDATE, stamps episodes, persists the bumped value", async () => {
    currentGenerationValue = 0;
    mockGetLiveMessagesWithId.mockResolvedValue(buildPrefixSession());

    await executeCheckpoint(
      "session-1",
      "scope-1",
      makeProvider("summary") as any,
      { provider: "openrouter", model: "m", contextLimit: 128000 } as any,
    );

    // BEGIN → SELECT FOR UPDATE → UPDATE checkpoint_generation → COMMIT order.
    const sqls = mockTxQuery.mock.calls.map((c) => c[0] as string);
    const selectIdx = sqls.findIndex((s) =>
      s.includes("SELECT checkpoint_generation") && s.includes("FOR UPDATE"),
    );
    const updateIdx = sqls.findIndex((s) =>
      s.includes("UPDATE sessions SET checkpoint_generation"),
    );
    const beginIdx = sqls.findIndex((s) => s.trim().toUpperCase().startsWith("BEGIN"));
    const commitIdx = sqls.findIndex((s) => s.trim().toUpperCase().startsWith("COMMIT"));

    expect(beginIdx).toBeGreaterThanOrEqual(0);
    expect(selectIdx).toBeGreaterThan(beginIdx);
    expect(updateIdx).toBeGreaterThan(selectIdx);
    expect(commitIdx).toBeGreaterThan(updateIdx);

    // UPDATE binds the bumped value as its second param (nextGen = 0 + 1 = 1).
    const updateCall = mockTxQuery.mock.calls.find((c) =>
      (c[0] as string).includes("UPDATE sessions SET checkpoint_generation"),
    );
    expect(updateCall?.[1]?.[0]).toBe("session-1");
    expect(updateCall?.[1]?.[1]).toBe(1);

    // Episodes get stamped with the same bumped value before insertEpisodes.
    expect(mockInsertEpisodes).toHaveBeenCalledTimes(1);
    const [rows] = mockInsertEpisodes.mock.calls[0];
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows as any[]) {
      expect(r.checkpointGeneration).toBe(1);
    }
  });

  it("bumps from an arbitrary baseline (5 → 6)", async () => {
    currentGenerationValue = 5;
    mockGetLiveMessagesWithId.mockResolvedValue(buildPrefixSession());

    await executeCheckpoint(
      "session-1",
      "scope-1",
      makeProvider("summary") as any,
      { provider: "openrouter", model: "m", contextLimit: 128000 } as any,
    );

    const updateCall = mockTxQuery.mock.calls.find((c) =>
      (c[0] as string).includes("UPDATE sessions SET checkpoint_generation"),
    );
    expect(updateCall?.[1]?.[1]).toBe(6);
    const [rows] = mockInsertEpisodes.mock.calls[0];
    for (const r of rows as any[]) {
      expect(r.checkpointGeneration).toBe(6);
    }
  });
});

// ── Mutex (process-local serialization) ───────────────────────

describe("executeCheckpoint — per-session mutex", () => {
  it("serializes concurrent checkpoints on the same session", async () => {
    currentGenerationValue = 0;
    mockGetLiveMessagesWithId.mockResolvedValue(buildPrefixSession());

    // Track concurrent entries into the Phase II write (pool.connect) to
    // prove the second caller is blocked until the first releases the mutex.
    let inFlight = 0;
    let maxObservedInFlight = 0;
    mockPoolConnect.mockImplementation(async () => {
      inFlight++;
      maxObservedInFlight = Math.max(maxObservedInFlight, inFlight);
      // Tiny delay so if serialization is broken both entrants overlap.
      await new Promise((r) => setTimeout(r, 10));
      return {
        query: mockTxQuery,
        release: () => {
          inFlight--;
          mockTxRelease();
        },
      };
    });

    const provider = makeProvider("summary") as any;
    const config = { provider: "openrouter", model: "m", contextLimit: 128000 } as any;

    await Promise.all([
      executeCheckpoint("session-1", "scope-1", provider, config),
      executeCheckpoint("session-1", "scope-1", provider, config),
    ]);

    // If serialization holds, only one caller ever enters Phase II at a time.
    expect(maxObservedInFlight).toBe(1);
  });

  it("does NOT serialize checkpoints across unrelated sessions", async () => {
    currentGenerationValue = 0;
    mockGetLiveMessagesWithId.mockResolvedValue(buildPrefixSession());

    let inFlight = 0;
    let maxObservedInFlight = 0;
    mockPoolConnect.mockImplementation(async () => {
      inFlight++;
      maxObservedInFlight = Math.max(maxObservedInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 10));
      return {
        query: mockTxQuery,
        release: () => {
          inFlight--;
          mockTxRelease();
        },
      };
    });

    const provider = makeProvider("summary") as any;
    const config = { provider: "openrouter", model: "m", contextLimit: 128000 } as any;

    await Promise.all([
      executeCheckpoint("session-A", "scope-A", provider, config),
      executeCheckpoint("session-B", "scope-B", provider, config),
    ]);

    // Separate sessions should be free to run in parallel — two tx in flight.
    expect(maxObservedInFlight).toBe(2);
  });
});
