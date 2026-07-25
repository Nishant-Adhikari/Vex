/**
 * LIFECYCLE GUARD — a lingering `paused_error` run blocks new mission starts
 * (CONFIRMED PROD BUG, documented not fixed).
 *
 * Production incident (companion to the expired-lease bug): a `paused_error`
 * run (provider_error) lingered with `ended_at=NULL` and 0 open positions. Such
 * a run is still "active" to `getActiveRunBySession` — by design, so `/retry`
 * can find it — which means `prepareMissionStart` returns `session_has_active_run`
 * and REFUSES every new mission start on that session until the run is manually
 * cleared.
 *
 * This guard PINS that current behavior (so the block is visible and any future
 * fix must consciously update it) and documents the FINDING: a `paused_error`
 * run with `ended_at=NULL` permanently wedges new starts — there is no reaper
 * that auto-resolves a stuck paused_error run. See the suite index / PR body.
 *
 * The gate we exercise is step 2 of `prepareMissionStart` (before the provider
 * and lease-claim steps), so only the mission + active-run reads are stubbed.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const getMission = vi.fn();
const getActiveRunBySession = vi.fn();

vi.mock("@vex-agent/db/repos/missions.js", () => ({
  getMission: (...a: unknown[]) => getMission(...a),
}));
vi.mock("@vex-agent/db/repos/mission-runs.js", () => ({
  getActiveRunBySession: (...a: unknown[]) => getActiveRunBySession(...a),
}));
vi.mock("@utils/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { prepareMissionStart } = await import(
  "@vex-agent/engine/core/runner/mission-prepare.js"
);

beforeEach(() => {
  vi.clearAllMocks();
  getMission.mockResolvedValue({ id: "mission-1", rootSessionId: "sess-1" });
});

describe("prepareMissionStart — a lingering paused_error run wedges new starts", () => {
  it("FINDING: refuses a new start with session_has_active_run when a paused_error run lingers", async () => {
    // The wedging row: paused_error, ended_at NULL, no open positions.
    getActiveRunBySession.mockResolvedValue({
      id: "run-stuck",
      status: "paused_error",
      endedAt: null,
    });

    const outcome = await prepareMissionStart({ missionId: "mission-1" });

    expect(outcome.outcome).toBe("session_has_active_run");
    if (outcome.outcome === "session_has_active_run") {
      expect(outcome.missionRunId).toBe("run-stuck");
      expect(outcome.runStatus).toBe("paused_error");
    }
  });

  it("does NOT wedge when there is no active run (control: a clean session proceeds past the gate)", async () => {
    getActiveRunBySession.mockResolvedValue(null);
    const outcome = await prepareMissionStart({ missionId: "mission-1" });
    // Past the active-run gate — it moves on to the provider step (unmocked
    // here), so the ONE thing we assert is that it did NOT short-circuit at the
    // active-run gate.
    expect(outcome.outcome).not.toBe("session_has_active_run");
  });
});
