import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getActiveRunBySession: vi.fn(),
  getLiveMessages: vi.fn(),
  archiveSuffix: vi.fn(),
  cancelForSession: vi.fn(),
  stopActiveMissionForEdit: vi.fn(),
  rejectPendingApprovalsForSession: vi.fn(),
  createCheckpoint: vi.fn(),
  setCheckpointArchivedCount: vi.fn(),
}));

const fakeTxClient = { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }) };

vi.mock("@vex-agent/db/repos/mission-runs.js", () => ({
  getActiveRunBySession: (...args: unknown[]) => mocks.getActiveRunBySession(...args),
}));

vi.mock("@vex-agent/db/repos/messages.js", () => ({
  getLiveMessages: (...args: unknown[]) => mocks.getLiveMessages(...args),
}));

vi.mock("@vex-agent/db/repos/sessions.js", () => ({
  archiveSuffix: (...args: unknown[]) => mocks.archiveSuffix(...args),
}));

vi.mock("@vex-agent/db/repos/loop-wake.js", () => ({
  cancelForSession: (...args: unknown[]) => mocks.cancelForSession(...args),
}));

vi.mock("@vex-agent/db/repos/rewind-checkpoints.js", () => ({
  createCheckpoint: (...args: unknown[]) => mocks.createCheckpoint(...args),
  setCheckpointArchivedCount: (...args: unknown[]) => mocks.setCheckpointArchivedCount(...args),
}));

vi.mock("@vex-agent/db/client.js", () => ({
  // Puzzle 04 phase 5 — rewind now opens its own tx for the
  // checkpoint + archive + count-update sequence. The mock runs
  // the closure with a fake client whose `query` returns empty
  // rows for the session-row-lock SELECT.
  withTransaction: async (fn: (client: unknown) => Promise<unknown>) => fn(fakeTxClient),
  queryOneWith: vi.fn().mockResolvedValue({ id: "session-1" }),
}));

vi.mock("../../../../vex-agent/engine/core/runner/abort.js", () => ({
  stopActiveMissionForEdit: (...args: unknown[]) => mocks.stopActiveMissionForEdit(...args),
}));

vi.mock("../../../../vex-agent/engine/core/runner/approvals-cleanup.js", () => ({
  rejectPendingApprovalsForSession: (...args: unknown[]) =>
    mocks.rejectPendingApprovalsForSession(...args),
}));

vi.mock("@utils/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { rewindSession } = await import("../../../../vex-agent/engine/core/rewind.js");

function msg(id: number, role: string) {
  // Puzzle 04: `selectCutoffMessage` now reads `timestamp` to record
  // the checkpoint's `cutoffCreatedAt`. Stamp a deterministic ISO
  // string per id so tests can assert checkpoint args.
  return {
    id,
    role,
    content: `${role}-${id}`,
    timestamp: `2026-05-22T10:${id.toString().padStart(2, "0")}:00.000Z`,
  };
}

describe("rewindSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getActiveRunBySession.mockResolvedValue(null);
    mocks.getLiveMessages.mockResolvedValue([]);
    mocks.archiveSuffix.mockResolvedValue({ archivedCount: 0, remainingCount: 0 });
    mocks.cancelForSession.mockResolvedValue(0);
    mocks.stopActiveMissionForEdit.mockResolvedValue({ stopped: true, rejectedApprovals: 0 });
    mocks.rejectPendingApprovalsForSession.mockResolvedValue(0);
    // Puzzle 04: createCheckpoint returns a stable id used by the
    // stamped archive write + the count-update step.
    mocks.createCheckpoint.mockResolvedValue({
      id: "chk-1",
      sessionId: "session-1",
      missionRunId: null,
      cutoffMessageId: 0,
      cutoffCreatedAt: "2026-05-22T10:00:00.000Z",
      archivedCount: 0,
      createdBy: "user",
      reason: null,
      createdAt: "2026-05-22T10:00:00.000Z",
      restoredAt: null,
      restoreIdempotencyKey: null,
    });
    mocks.setCheckpointArchivedCount.mockResolvedValue(undefined);
  });

  it("blocks while a mission run is running", async () => {
    mocks.getActiveRunBySession.mockResolvedValue({ id: "run-1", status: "running" });

    await expect(rewindSession("session-1", 1)).rejects.toThrow(/Cannot rewind/);

    expect(mocks.stopActiveMissionForEdit).not.toHaveBeenCalled();
    expect(mocks.archiveSuffix).not.toHaveBeenCalled();
  });

  it("stops paused runs, drains approvals and cancels wakes before archiving", async () => {
    mocks.getActiveRunBySession.mockResolvedValue({ id: "run-1", status: "paused_error" });
    mocks.stopActiveMissionForEdit.mockResolvedValue({ stopped: true, rejectedApprovals: 2 });
    mocks.rejectPendingApprovalsForSession.mockResolvedValue(1);
    mocks.cancelForSession.mockResolvedValue(3);
    mocks.getLiveMessages.mockResolvedValue([
      msg(10, "user"),
      msg(11, "assistant"),
      msg(12, "user"),
      msg(13, "tool"),
    ]);
    mocks.archiveSuffix.mockResolvedValue({ archivedCount: 2, remainingCount: 2 });

    mocks.archiveSuffix.mockResolvedValue({ archivedCount: 2, remainingCount: 2 });
    mocks.createCheckpoint.mockResolvedValue({
      id: "chk-paused-run",
      sessionId: "session-1",
      missionRunId: "run-1",
      cutoffMessageId: 12,
      cutoffCreatedAt: "2026-05-22T10:12:00.000Z",
      archivedCount: 0,
      createdBy: "user",
      reason: "rewind 1 turn",
      createdAt: "2026-05-22T10:00:00.000Z",
      restoredAt: null,
      restoreIdempotencyKey: null,
    });
    const result = await rewindSession("session-1", 1);

    expect(result).toEqual({
      archivedMessages: 2,
      rejectedApprovals: 3,
      cancelledWakes: 3,
      cutoffMessageId: 12,
      checkpointId: "chk-paused-run",
      missionRunImpact: "stopped",
      noop: false,
    });
    expect(mocks.stopActiveMissionForEdit).toHaveBeenCalledWith("session-1");
    // Puzzle 04: archiveSuffix now takes (sessionId, cutoffId,
    // rewindCheckpointId, txClient). The stopped run id is propagated
    // to the checkpoint for audit/debug.
    expect(mocks.archiveSuffix).toHaveBeenCalledWith(
      "session-1",
      12,
      "chk-paused-run",
      expect.anything(),
    );
    expect(mocks.createCheckpoint).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        sessionId: "session-1",
        missionRunId: "run-1",
        cutoffMessageId: 12,
        cutoffCreatedAt: "2026-05-22T10:12:00.000Z",
        archivedCount: 0,
        createdBy: "user",
        reason: "rewind 1 turn",
      }),
    );
    expect(mocks.setCheckpointArchivedCount).toHaveBeenCalledWith(
      expect.anything(),
      "chk-paused-run",
      2,
    );
    expect(mocks.rejectPendingApprovalsForSession).toHaveBeenCalledBefore(
      mocks.cancelForSession as never,
    );
    expect(mocks.cancelForSession).toHaveBeenCalledBefore(mocks.archiveSuffix as never);
    // Inside the tx: checkpoint INSERT must run BEFORE the archive
    // INSERT (FK target row needs to exist). archive then count
    // update.
    expect(mocks.createCheckpoint).toHaveBeenCalledBefore(mocks.archiveSuffix as never);
    expect(mocks.archiveSuffix).toHaveBeenCalledBefore(
      mocks.setCheckpointArchivedCount as never,
    );
  });

  it("chooses the Nth-most-recent user message as the cutoff", async () => {
    mocks.getLiveMessages.mockResolvedValue([
      msg(1, "system"),
      msg(2, "user"),
      msg(3, "assistant"),
      msg(4, "tool"),
      msg(5, "user"),
      msg(6, "assistant"),
      msg(7, "user"),
    ]);

    await rewindSession("session-1", 2);

    expect(mocks.archiveSuffix).toHaveBeenCalledWith(
      "session-1",
      5,
      "chk-1",
      expect.anything(),
    );
  });

  it("returns noop when the session has no user messages", async () => {
    mocks.getLiveMessages.mockResolvedValue([msg(1, "system"), msg(2, "assistant")]);

    const result = await rewindSession("session-1", 1);

    expect(result.noop).toBe(true);
    expect(result.archivedMessages).toBe(0);
    expect(mocks.archiveSuffix).not.toHaveBeenCalled();
  });
});
