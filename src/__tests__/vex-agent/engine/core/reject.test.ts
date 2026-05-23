/**
 * `rejectApproval` back-compat wrapper — focuses on the wrapper semantics
 * over the new puzzle-5 phase-3 `prepareReject` + `runResumeAfterDecision`
 * pair. Detailed coverage of the decision tx, tool-result content, and
 * lease+flip lives in `approval-runtime.test.ts`.
 *
 * Pinned behavior:
 *   - rejected outcome + continuation         → awaits runResumeAfterDecision,
 *                                               returns ApprovalItem-shaped
 *                                               record (legacy contract)
 *   - rejected outcome + no continuation      → no resume, still returns item
 *   - cached_rejected                         → returns item without resume
 *   - already_approved                        → returns null (CAS-miss
 *                                               semantics, legacy contract)
 *   - reason option forwarded to prepareReject
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrepareReject = vi.fn();
const mockRunResumeAfterDecision = vi.fn();

vi.mock("@vex-agent/engine/core/approval-runtime.js", () => ({
  prepareReject: (...a: unknown[]) => mockPrepareReject(...a),
  runResumeAfterDecision: (...a: unknown[]) =>
    mockRunResumeAfterDecision(...a),
}));

vi.mock("@utils/logger.js", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const { rejectApproval } = await import(
  "../../../../vex-agent/engine/core/reject.js"
);

const STUB_CONTINUATION = {
  missionRunId: "run-1",
  sessionId: "session-1",
  ownerId: "reject-test",
  leaseHandle: { lease: {}, ownerId: "reject-test", release: vi.fn() },
} as never;

beforeEach(() => {
  vi.clearAllMocks();
  mockRunResumeAfterDecision.mockResolvedValue({
    text: "Resumed",
    toolCallsMade: 0,
    pendingApprovals: [],
    stopReason: null,
    missionStatus: "running",
  });
});

describe("rejectApproval back-compat wrapper", () => {
  it("rejected + continuation → awaits resume and returns rejected ApprovalItem", async () => {
    mockPrepareReject.mockResolvedValueOnce({
      kind: "rejected",
      approvalId: "a-1",
      resolvedAt: "2026-05-23T20:00:00.000Z",
      sessionId: "session-1",
      missionRunId: "run-1",
      reason: "No reason provided",
      continuation: STUB_CONTINUATION,
    });

    const result = await rejectApproval("a-1");

    expect(mockRunResumeAfterDecision).toHaveBeenCalledWith(STUB_CONTINUATION);
    expect(result).not.toBeNull();
    expect(result?.status).toBe("rejected");
    expect(result?.id).toBe("a-1");
    expect(result?.sessionId).toBe("session-1");
  });

  it("rejected + no missionRun → no resume, returns ApprovalItem", async () => {
    mockPrepareReject.mockResolvedValueOnce({
      kind: "rejected",
      approvalId: "a-2",
      resolvedAt: "2026-05-23T20:01:00.000Z",
      sessionId: "session-1",
      missionRunId: null,
      reason: "Custom reason",
      continuation: null,
    });

    const result = await rejectApproval("a-2", { reason: "Custom reason" });

    expect(mockRunResumeAfterDecision).not.toHaveBeenCalled();
    expect(result?.status).toBe("rejected");
    expect(result?.reasoning).toBe("Custom reason");
  });

  it("cached_rejected → returns rejected item without invoking resume", async () => {
    mockPrepareReject.mockResolvedValueOnce({
      kind: "cached_rejected",
      approvalId: "a-3",
      resolvedAt: "2026-05-23T20:02:00.000Z",
      decision: "rejected",
      reason: "Earlier user reject",
      missionRunId: "run-1",
    });

    const result = await rejectApproval("a-3");

    expect(mockRunResumeAfterDecision).not.toHaveBeenCalled();
    expect(result?.status).toBe("rejected");
    expect(result?.reasoning).toBe("Earlier user reject");
  });

  it("already_approved → returns null (CAS-miss semantics)", async () => {
    mockPrepareReject.mockResolvedValueOnce({
      kind: "already_approved",
      approvalId: "a-4",
      resolvedAt: "2026-05-23T20:03:00.000Z",
      missionRunId: "run-1",
    });

    const result = await rejectApproval("a-4");

    expect(result).toBeNull();
    expect(mockRunResumeAfterDecision).not.toHaveBeenCalled();
  });

  it("forwards reason option to prepareReject", async () => {
    mockPrepareReject.mockResolvedValueOnce({
      kind: "rejected",
      approvalId: "a-5",
      resolvedAt: "2026-05-23T20:04:00.000Z",
      sessionId: "session-1",
      missionRunId: null,
      reason: "Operator override",
      continuation: null,
    });

    await rejectApproval("a-5", { reason: "Operator override" });

    expect(mockPrepareReject).toHaveBeenCalledWith("a-5", "Operator override");
  });

  it("collapses cached_rejected decision='rejected_stop' to status='rejected'", async () => {
    mockPrepareReject.mockResolvedValueOnce({
      kind: "cached_rejected",
      approvalId: "a-6",
      resolvedAt: "2026-05-23T20:05:00.000Z",
      decision: "rejected_stop",
      reason: "Earlier reject-and-stop",
      missionRunId: "run-1",
    });

    const result = await rejectApproval("a-6");

    // Legacy ApprovalItem only knows 'rejected' / 'approved' / 'pending' —
    // wrapper collapses 'rejected_stop' onto 'rejected' for back-compat.
    expect(result?.status).toBe("rejected");
  });
});
