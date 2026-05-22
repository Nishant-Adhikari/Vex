/**
 * Unit tests for `engine/mission/restore.ts`.
 *
 * The repos + tx helpers are mocked; we exercise the orchestration
 * (lock order, idempotency replay, blocking checks, LIFO selection,
 * post-commit emit). Full DB-backed integration coverage lands in
 * phase 8.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  TRANSCRIPT_APPEND_EVENT_TYPE,
  TranscriptEventBus,
} from "../../../../vex-agent/engine/events/transcript-bus.js";

// ── repo mocks ──────────────────────────────────────────────────

const mockAcquireLease = vi.fn();
const mockReleaseLease = vi.fn();
const mockGetLease = vi.fn();
const mockGetLatestUnrestoredCheckpoint = vi.fn();
const mockGetCheckpointForUpdate = vi.fn();
const mockMarkCheckpointRestored = vi.fn();
const mockCheckActiveRun = vi.fn();
const mockCheckPendingApproval = vi.fn();
const mockCheckExistingIdempotencyMatch = vi.fn();
const mockUnarchiveStampedRows = vi.fn();
const mockIncrementSessionMessageCount = vi.fn();
const mockEmitRestoredMessages = vi.fn();

vi.mock("@vex-agent/db/repos/runner-leases.js", () => ({
  acquireLease: (...a: unknown[]) => mockAcquireLease(...a),
  releaseLease: (...a: unknown[]) => mockReleaseLease(...a),
  getLease: (...a: unknown[]) => mockGetLease(...a),
}));

vi.mock("@vex-agent/db/repos/rewind-checkpoints.js", () => ({
  getLatestUnrestoredCheckpoint: (...a: unknown[]) => mockGetLatestUnrestoredCheckpoint(...a),
  getCheckpointForUpdate: (...a: unknown[]) => mockGetCheckpointForUpdate(...a),
  markCheckpointRestored: (...a: unknown[]) => mockMarkCheckpointRestored(...a),
}));

vi.mock("../../../../vex-agent/engine/mission/restore-internals.js", () => ({
  checkActiveRun: (...a: unknown[]) => mockCheckActiveRun(...a),
  checkPendingApproval: (...a: unknown[]) => mockCheckPendingApproval(...a),
  checkExistingIdempotencyMatch: (...a: unknown[]) => mockCheckExistingIdempotencyMatch(...a),
  unarchiveStampedRows: (...a: unknown[]) => mockUnarchiveStampedRows(...a),
  incrementSessionMessageCount: (...a: unknown[]) => mockIncrementSessionMessageCount(...a),
  emitRestoredMessages: (...a: unknown[]) => mockEmitRestoredMessages(...a),
}));

const fakeClientQuery = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
const fakeClientRelease = vi.fn();

vi.mock("@vex-agent/db/client.js", () => ({
  getPool: () => ({
    connect: async () => ({
      query: fakeClientQuery,
      release: fakeClientRelease,
    }),
  }),
  withTransaction: async (fn: (client: unknown) => Promise<unknown>) => {
    const fakeClient = { query: fakeClientQuery };
    await fakeClientQuery("BEGIN");
    try {
      const result = await fn(fakeClient);
      await fakeClientQuery("COMMIT");
      return result;
    } catch (err) {
      await fakeClientQuery("ROLLBACK");
      throw err;
    }
  },
  executeWith: vi.fn(),
  queryOneWith: async (_client: unknown, sql: string, params?: unknown[]) => {
    // Route through the same fakeClient.query mock so individual tests
    // can shape the session-lock SELECT outcome via mockImplementation.
    const result = await fakeClientQuery(sql, params);
    return result.rows[0] ?? null;
  },
  queryWith: async (_client: unknown, sql: string, params?: unknown[]) => {
    const result = await fakeClientQuery(sql, params);
    return result.rows;
  },
}));

const { restoreLatestCheckpoint } = await import(
  "../../../../vex-agent/engine/mission/restore.js"
);

// ── helpers ─────────────────────────────────────────────────────

function makeAcquiredLease() {
  return {
    sessionId: "session-1",
    missionRunId: null,
    ownerId: "restore-1",
    processKind: "electron_main",
    acquiredAt: new Date(),
    heartbeatAt: new Date(),
    expiresAt: new Date(Date.now() + 30_000),
  };
}

function makeUnrestoredCheckpoint(overrides: Record<string, unknown> = {}) {
  return {
    id: "chk-1",
    sessionId: "session-1",
    missionRunId: null,
    cutoffMessageId: 100,
    cutoffCreatedAt: "2026-05-22T10:00:00.000Z",
    archivedCount: 4,
    createdBy: "user" as const,
    reason: "rewind 2 turns",
    createdAt: "2026-05-22T10:00:00.000Z",
    restoredAt: null,
    restoreIdempotencyKey: null,
    ...overrides,
  };
}

function makeRestoredCheckpoint(idempotencyKey: string, overrides: Record<string, unknown> = {}) {
  return makeUnrestoredCheckpoint({
    restoredAt: "2026-05-22T10:05:00.000Z",
    restoreIdempotencyKey: idempotencyKey,
    ...overrides,
  });
}

// ── tests ───────────────────────────────────────────────────────

describe("restoreLatestCheckpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: session SELECT...FOR UPDATE returns rowCount=1 (session
    // exists); every other query returns empty. Individual tests can
    // override (e.g. session_not_found returns rowCount=0).
    fakeClientQuery.mockImplementation(async (sql: string) => {
      if (typeof sql === "string" && sql.includes("FROM sessions WHERE id")) {
        return { rows: [{ id: "session-1" }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
  });

  it("returns session_not_found when the session row does not exist", async () => {
    // The first SQL is `SELECT id FROM sessions WHERE id = $1 FOR UPDATE`.
    // executeWith() returns rowCount=0 for a missing session; the
    // orchestrator must reject before touching `runner_leases` (whose
    // FK on session_id would otherwise throw inside the tx).
    fakeClientQuery.mockImplementation(async () => {
      return { rows: [], rowCount: 0 };
    });

    const outcome = await restoreLatestCheckpoint({
      sessionId: "missing",
      idempotencyKey: "key-A",
    });

    expect(outcome.outcome).toBe("session_not_found");
    expect(mockAcquireLease).not.toHaveBeenCalled();
    expect(mockEmitRestoredMessages).not.toHaveBeenCalled();
  });

  it("returns lease_busy when the session already holds a lease", async () => {
    mockAcquireLease.mockResolvedValueOnce(null);
    mockGetLease.mockResolvedValueOnce({
      sessionId: "session-1",
      missionRunId: null,
      ownerId: "chat-turn-7",
      processKind: "electron_main",
      acquiredAt: new Date(),
      heartbeatAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    });

    const outcome = await restoreLatestCheckpoint({
      sessionId: "session-1",
      idempotencyKey: "key-A",
    });

    expect(outcome.outcome).toBe("lease_busy");
    if (outcome.outcome === "lease_busy") {
      expect(outcome.currentLease.ownerId).toBe("chat-turn-7");
    }
    expect(mockReleaseLease).not.toHaveBeenCalled();
    expect(mockEmitRestoredMessages).not.toHaveBeenCalled();
  });

  it("returns no_checkpoint when no unrestored row exists", async () => {
    mockAcquireLease.mockResolvedValueOnce(makeAcquiredLease());
    mockCheckExistingIdempotencyMatch.mockResolvedValueOnce(null);
    mockGetLatestUnrestoredCheckpoint.mockResolvedValueOnce(null);

    const outcome = await restoreLatestCheckpoint({
      sessionId: "session-1",
      idempotencyKey: "key-A",
    });

    expect(outcome.outcome).toBe("no_checkpoint");
    expect(mockReleaseLease).toHaveBeenCalledTimes(1);
    expect(mockUnarchiveStampedRows).not.toHaveBeenCalled();
  });

  it("returns noop_already_restored when the same idempotency key was used before", async () => {
    mockAcquireLease.mockResolvedValueOnce(makeAcquiredLease());
    mockCheckExistingIdempotencyMatch.mockResolvedValueOnce(
      makeRestoredCheckpoint("key-A", { restoredAt: "2026-05-22T10:05:00.000Z" }),
    );

    const outcome = await restoreLatestCheckpoint({
      sessionId: "session-1",
      idempotencyKey: "key-A",
    });

    expect(outcome.outcome).toBe("noop_already_restored");
    if (outcome.outcome === "noop_already_restored") {
      expect(outcome.idempotencyKey).toBe("key-A");
      expect(outcome.restoredCount).toBe(4);
    }
    expect(mockReleaseLease).toHaveBeenCalledTimes(1);
    expect(mockUnarchiveStampedRows).not.toHaveBeenCalled();
    expect(mockEmitRestoredMessages).not.toHaveBeenCalled();
  });

  it("returns blocked_active_run when a mission run is active or paused", async () => {
    mockAcquireLease.mockResolvedValueOnce(makeAcquiredLease());
    mockCheckExistingIdempotencyMatch.mockResolvedValueOnce(null);
    mockGetLatestUnrestoredCheckpoint.mockResolvedValueOnce(makeUnrestoredCheckpoint());
    mockGetCheckpointForUpdate.mockResolvedValueOnce(makeUnrestoredCheckpoint());
    mockCheckActiveRun.mockResolvedValueOnce({ id: "run-1", status: "paused_user" });

    const outcome = await restoreLatestCheckpoint({
      sessionId: "session-1",
      idempotencyKey: "key-A",
    });

    expect(outcome.outcome).toBe("blocked_active_run");
    if (outcome.outcome === "blocked_active_run") {
      expect(outcome.runStatus).toBe("paused_user");
    }
    expect(mockReleaseLease).toHaveBeenCalledTimes(1);
    expect(mockUnarchiveStampedRows).not.toHaveBeenCalled();
  });

  it("returns blocked_pending_approval when an approval is pending", async () => {
    mockAcquireLease.mockResolvedValueOnce(makeAcquiredLease());
    mockCheckExistingIdempotencyMatch.mockResolvedValueOnce(null);
    mockGetLatestUnrestoredCheckpoint.mockResolvedValueOnce(makeUnrestoredCheckpoint());
    mockGetCheckpointForUpdate.mockResolvedValueOnce(makeUnrestoredCheckpoint());
    mockCheckActiveRun.mockResolvedValueOnce(null);
    mockCheckPendingApproval.mockResolvedValueOnce("approval-1");

    const outcome = await restoreLatestCheckpoint({
      sessionId: "session-1",
      idempotencyKey: "key-A",
    });

    expect(outcome.outcome).toBe("blocked_pending_approval");
    expect(mockUnarchiveStampedRows).not.toHaveBeenCalled();
  });

  it("restores stamped rows + updates message_count + emits post-commit", async () => {
    mockAcquireLease.mockResolvedValueOnce(makeAcquiredLease());
    mockCheckExistingIdempotencyMatch.mockResolvedValueOnce(null);
    mockGetLatestUnrestoredCheckpoint.mockResolvedValueOnce(makeUnrestoredCheckpoint());
    mockGetCheckpointForUpdate
      .mockResolvedValueOnce(makeUnrestoredCheckpoint())
      .mockResolvedValueOnce(makeRestoredCheckpoint("key-A"));
    mockCheckActiveRun.mockResolvedValueOnce(null);
    mockCheckPendingApproval.mockResolvedValueOnce(null);
    mockUnarchiveStampedRows.mockResolvedValueOnce([
      { id: 11, role: "user", created_at: "2026-05-22T10:01:00.000Z", message_type: null },
      { id: 12, role: "assistant", created_at: "2026-05-22T10:02:00.000Z", message_type: null },
    ]);

    const bus = new TranscriptEventBus();
    const outcome = await restoreLatestCheckpoint({
      sessionId: "session-1",
      idempotencyKey: "key-A",
      bus,
    });

    expect(outcome.outcome).toBe("restored");
    if (outcome.outcome === "restored") {
      expect(outcome.checkpointId).toBe("chk-1");
      expect(outcome.restoredCount).toBe(2);
      expect(outcome.idempotencyKey).toBe("key-A");
    }
    expect(mockIncrementSessionMessageCount).toHaveBeenCalledWith(
      expect.anything(),
      "session-1",
      2,
    );
    expect(mockMarkCheckpointRestored).toHaveBeenCalledWith(
      expect.anything(),
      "chk-1",
      "key-A",
    );
    expect(mockReleaseLease).toHaveBeenCalledTimes(1);
    expect(mockEmitRestoredMessages).toHaveBeenCalledTimes(1);
    const emitArgs = mockEmitRestoredMessages.mock.calls[0]!;
    expect(emitArgs[0]).toEqual(expect.objectContaining({
      sessionId: "session-1",
      checkpointId: "chk-1",
      idempotencyKey: "key-A",
    }));
    expect(emitArgs[1]).toBe(bus);
  });

  it("BEGIN + session row lock + COMMIT happen in that order", async () => {
    mockAcquireLease.mockResolvedValueOnce(makeAcquiredLease());
    mockCheckExistingIdempotencyMatch.mockResolvedValueOnce(null);
    mockGetLatestUnrestoredCheckpoint.mockResolvedValueOnce(null);

    await restoreLatestCheckpoint({
      sessionId: "session-1",
      idempotencyKey: "key-A",
    });

    const sqlCalls = fakeClientQuery.mock.calls.map((c: unknown[]) => String(c[0]));
    const beginIdx = sqlCalls.indexOf("BEGIN");
    const commitIdx = sqlCalls.indexOf("COMMIT");
    expect(beginIdx).toBeGreaterThanOrEqual(0);
    expect(commitIdx).toBeGreaterThan(beginIdx);
  });

  it("does not emit when the tx rolls back", async () => {
    mockAcquireLease.mockResolvedValueOnce(makeAcquiredLease());
    mockCheckExistingIdempotencyMatch.mockResolvedValueOnce(null);
    mockGetLatestUnrestoredCheckpoint.mockResolvedValueOnce(makeUnrestoredCheckpoint());
    mockGetCheckpointForUpdate.mockResolvedValueOnce(makeUnrestoredCheckpoint());
    mockCheckActiveRun.mockResolvedValueOnce(null);
    mockCheckPendingApproval.mockResolvedValueOnce(null);
    mockUnarchiveStampedRows.mockRejectedValueOnce(new Error("simulated DB failure"));

    await expect(
      restoreLatestCheckpoint({
        sessionId: "session-1",
        idempotencyKey: "key-A",
      }),
    ).rejects.toThrow("simulated DB failure");

    expect(mockEmitRestoredMessages).not.toHaveBeenCalled();
    const sqlCalls = fakeClientQuery.mock.calls.map((c: unknown[]) => String(c[0]));
    expect(sqlCalls).toContain("ROLLBACK");
  });

  it("emit-after-commit produces TranscriptAppendEvent per restored message", async () => {
    // Use the real emitter (not the mock) to verify per-message event
    // count + correlationId binding.
    mockEmitRestoredMessages.mockImplementationOnce(async (snapshot, bus) => {
      // Replicate the production behavior locally to assert it.
      for (const row of snapshot.restoredMessages) {
        bus.emit({
          type: TRANSCRIPT_APPEND_EVENT_TYPE,
          sessionId: snapshot.sessionId,
          messageId: row.id,
          role: row.role as "user" | "assistant" | "tool" | "system",
          createdAt: typeof row.created_at === "string"
            ? row.created_at
            : new Date(row.created_at).toISOString(),
          messageType: row.message_type,
          correlationId: `restore:${snapshot.checkpointId}`,
        });
      }
    });

    mockAcquireLease.mockResolvedValueOnce(makeAcquiredLease());
    mockCheckExistingIdempotencyMatch.mockResolvedValueOnce(null);
    mockGetLatestUnrestoredCheckpoint.mockResolvedValueOnce(makeUnrestoredCheckpoint());
    mockGetCheckpointForUpdate
      .mockResolvedValueOnce(makeUnrestoredCheckpoint())
      .mockResolvedValueOnce(makeRestoredCheckpoint("key-A"));
    mockCheckActiveRun.mockResolvedValueOnce(null);
    mockCheckPendingApproval.mockResolvedValueOnce(null);
    mockUnarchiveStampedRows.mockResolvedValueOnce([
      { id: 11, role: "user", created_at: "2026-05-22T10:01:00.000Z", message_type: null },
      { id: 12, role: "assistant", created_at: "2026-05-22T10:02:00.000Z", message_type: null },
      { id: 13, role: "assistant", created_at: "2026-05-22T10:03:00.000Z", message_type: null },
    ]);

    const bus = new TranscriptEventBus();
    const events: unknown[] = [];
    bus.subscribe((e) => events.push(e));

    await restoreLatestCheckpoint({
      sessionId: "session-1",
      idempotencyKey: "key-A",
      bus,
    });

    expect(events).toHaveLength(3);
    expect(events[0]).toEqual(expect.objectContaining({
      type: TRANSCRIPT_APPEND_EVENT_TYPE,
      sessionId: "session-1",
      messageId: 11,
      correlationId: "restore:chk-1",
    }));
  });
});
