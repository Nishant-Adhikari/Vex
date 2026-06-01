/**
 * setMissionAutoRetry (phase 4d-5) — the host-only auto-retry opt-in.
 *
 * Authority is server-side: identity → authorization → state, decided
 * inside one row-locked transaction. These tests pin the four outcomes
 * and prove the write (mergeConstraintAutoRetry) only runs on the happy
 * path.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetMissionForUpdate = vi.fn();
const mockMergeConstraintAutoRetry = vi.fn();
const mockGetSession = vi.fn();

vi.mock("@vex-agent/db/client.js", () => ({
  // Run the callback with a throwaway client; the repo fns are mocked.
  withTransaction: vi.fn(async (fn: (client: unknown) => unknown) => fn({})),
}));

vi.mock("@vex-agent/db/repos/missions.js", () => ({
  getMissionForUpdate: (...a: unknown[]) => mockGetMissionForUpdate(...a),
  mergeConstraintAutoRetry: (...a: unknown[]) =>
    mockMergeConstraintAutoRetry(...a),
}));

vi.mock("@vex-agent/db/repos/sessions.js", () => ({
  getSession: (...a: unknown[]) => mockGetSession(...a),
}));

const { setMissionAutoRetry } = await import(
  "../../../../vex-agent/engine/mission/set-auto-retry.js"
);

const SESSION = "session-1";
const MISSION = "mission-1";

function mission(overrides: Record<string, unknown> = {}) {
  return {
    id: MISSION,
    rootSessionId: SESSION,
    status: "draft",
    constraintsJson: {},
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockMergeConstraintAutoRetry.mockResolvedValue(undefined);
});

describe("setMissionAutoRetry", () => {
  it("returns not_found when the mission row is missing", async () => {
    mockGetMissionForUpdate.mockResolvedValue(null);
    mockGetSession.mockResolvedValue({ id: SESSION, permission: "full" });

    const r = await setMissionAutoRetry({
      sessionId: SESSION,
      missionId: MISSION,
      enabled: true,
    });

    expect(r).toEqual({ outcome: "not_found" });
    expect(mockMergeConstraintAutoRetry).not.toHaveBeenCalled();
  });

  it("returns not_found when the mission belongs to another session (no existence leak)", async () => {
    mockGetMissionForUpdate.mockResolvedValue(
      mission({ rootSessionId: "other-session" }),
    );
    mockGetSession.mockResolvedValue({ id: SESSION, permission: "full" });

    const r = await setMissionAutoRetry({
      sessionId: SESSION,
      missionId: MISSION,
      enabled: true,
    });

    expect(r).toEqual({ outcome: "not_found" });
    // Identity is checked before authorization — session is never read.
    expect(mockGetSession).not.toHaveBeenCalled();
    expect(mockMergeConstraintAutoRetry).not.toHaveBeenCalled();
  });

  it("returns blocked_permission for a restricted session", async () => {
    mockGetMissionForUpdate.mockResolvedValue(mission());
    mockGetSession.mockResolvedValue({ id: SESSION, permission: "restricted" });

    const r = await setMissionAutoRetry({
      sessionId: SESSION,
      missionId: MISSION,
      enabled: true,
    });

    expect(r).toEqual({ outcome: "blocked_permission" });
    expect(mockMergeConstraintAutoRetry).not.toHaveBeenCalled();
  });

  it("returns blocked_permission when the session row is gone", async () => {
    mockGetMissionForUpdate.mockResolvedValue(mission());
    mockGetSession.mockResolvedValue(null);

    const r = await setMissionAutoRetry({
      sessionId: SESSION,
      missionId: MISSION,
      enabled: true,
    });

    expect(r).toEqual({ outcome: "blocked_permission" });
    expect(mockMergeConstraintAutoRetry).not.toHaveBeenCalled();
  });

  it("returns blocked_status once the mission left the editable window", async () => {
    mockGetMissionForUpdate.mockResolvedValue(mission({ status: "running" }));
    mockGetSession.mockResolvedValue({ id: SESSION, permission: "full" });

    const r = await setMissionAutoRetry({
      sessionId: SESSION,
      missionId: MISSION,
      enabled: true,
    });

    expect(r).toEqual({ outcome: "blocked_status", status: "running" });
    expect(mockMergeConstraintAutoRetry).not.toHaveBeenCalled();
  });

  it("updates a full-mode draft and merges the flag under the lock", async () => {
    mockGetMissionForUpdate.mockResolvedValue(mission({ status: "draft" }));
    mockGetSession.mockResolvedValue({ id: SESSION, permission: "full" });

    const r = await setMissionAutoRetry({
      sessionId: SESSION,
      missionId: MISSION,
      enabled: true,
    });

    expect(r).toEqual({ outcome: "updated", enabled: true });
    expect(mockMergeConstraintAutoRetry).toHaveBeenCalledWith(
      expect.anything(),
      MISSION,
      true,
    );
  });

  it("updates a ready draft with enabled=false", async () => {
    mockGetMissionForUpdate.mockResolvedValue(mission({ status: "ready" }));
    mockGetSession.mockResolvedValue({ id: SESSION, permission: "full" });

    const r = await setMissionAutoRetry({
      sessionId: SESSION,
      missionId: MISSION,
      enabled: false,
    });

    expect(r).toEqual({ outcome: "updated", enabled: false });
    expect(mockMergeConstraintAutoRetry).toHaveBeenCalledWith(
      expect.anything(),
      MISSION,
      false,
    );
  });
});
