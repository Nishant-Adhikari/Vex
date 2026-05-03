import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getActiveRunBySession: vi.fn(),
  getLiveMessages: vi.fn(),
  archiveSuffix: vi.fn(),
  cancelForSession: vi.fn(),
  stopActiveMissionForEdit: vi.fn(),
  rejectPendingApprovalsForSession: vi.fn(),
}));

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
  return { id, role, content: `${role}-${id}` };
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

    const result = await rewindSession("session-1", 1);

    expect(result).toEqual({
      archivedMessages: 2,
      rejectedApprovals: 3,
      cancelledWakes: 3,
      cutoffMessageId: 12,
      missionRunImpact: "stopped",
      noop: false,
    });
    expect(mocks.stopActiveMissionForEdit).toHaveBeenCalledWith("session-1");
    expect(mocks.archiveSuffix).toHaveBeenCalledWith("session-1", 12);
    expect(mocks.rejectPendingApprovalsForSession).toHaveBeenCalledBefore(
      mocks.cancelForSession as never,
    );
    expect(mocks.cancelForSession).toHaveBeenCalledBefore(mocks.archiveSuffix as never);
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

    expect(mocks.archiveSuffix).toHaveBeenCalledWith("session-1", 5);
  });

  it("returns noop when the session has no user messages", async () => {
    mocks.getLiveMessages.mockResolvedValue([msg(1, "system"), msg(2, "assistant")]);

    const result = await rewindSession("session-1", 1);

    expect(result.noop).toBe(true);
    expect(result.archivedMessages).toBe(0);
    expect(mocks.archiveSuffix).not.toHaveBeenCalled();
  });
});
