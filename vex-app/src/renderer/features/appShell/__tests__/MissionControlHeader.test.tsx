/**
 * MISSION CONTROL header — the BOOK panel's run-status block. Pins:
 *   - agent sessions render nothing (mission-only instrument),
 *   - a running mission shows its #seq + name, a RUNNING pill with a live
 *     pulse, and the RUNNING TIME / TIME LEFT timers (deadline from runtime),
 *   - a paused_error run shows the error-toned pill and no pulse,
 *   - a mission with no active run shows the idle pill and no timer.
 *
 * The api hooks are mocked (no IPC); the timer + pill math are unit-tested
 * elsewhere (missionRunTiming / missionControlModel).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Result } from "@shared/ipc/result.js";

const mockUseSession = vi.fn();
const mockUseMissionSessionResult = vi.fn();
const mockUseRuntimeState = vi.fn();

vi.mock("../../../lib/api/sessions.js", () => ({
  useSession: (...a: unknown[]) => mockUseSession(...a),
}));
vi.mock("../../../lib/api/mission.js", () => ({
  useMissionSessionResult: (...a: unknown[]) => mockUseMissionSessionResult(...a),
}));
vi.mock("../../../lib/api/runtime.js", () => ({
  useRuntimeState: (...a: unknown[]) => mockUseRuntimeState(...a),
}));

const { MissionControlHeader } = await import("../book/MissionControlHeader.js");

const SESSION = "00000000-0000-4000-8000-00000000abcd";
const START = "2026-07-24T00:00:00.000Z";

function ok<T>(data: T): Result<T> {
  return { ok: true, data };
}

function session(mode: "agent" | "mission", title: string | null) {
  return ok({
    id: SESSION,
    mode,
    permission: "full",
    title,
    initialGoal: null,
    startedAt: START,
    endedAt: null,
    missionStatus: null,
    pinnedAt: null,
  });
}

function runtime(over: Record<string, unknown> = {}) {
  return ok({
    sessionId: SESSION,
    hasActiveRun: false,
    missionRunId: null,
    status: null,
    stopReason: null,
    lastCheckpointAt: null,
    startedAt: null,
    deadlineAt: null,
    durationMinutes: null,
    tokenBudget: null,
    runTokensUsed: null,
    runCostUsd: null,
    iterationCount: null,
    leaseActive: false,
    leaseExpiresAt: null,
    pendingControlKind: null,
    ...over,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUseSession.mockReturnValue({ data: session("mission", "PONS Scalper") });
  mockUseMissionSessionResult.mockReturnValue({
    data: ok({ seqNo: 25, goalSnippet: "scalp PONS", startedAt: START }),
  });
  mockUseRuntimeState.mockReturnValue({ data: runtime() });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("MissionControlHeader", () => {
  it("renders nothing for an agent session", () => {
    mockUseSession.mockReturnValue({ data: session("agent", "Chat") });
    const { container } = render(<MissionControlHeader sessionId={SESSION} />);
    expect(container.firstChild).toBeNull();
  });

  it("shows #seq + name, a RUNNING pill (pulse), and the run timers", () => {
    // Pin the clock to the run start so the fixed deadline reads as future
    // (TIME LEFT), not "Deadline passed" against the real wall clock.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(START));
    mockUseRuntimeState.mockReturnValue({
      data: runtime({
        hasActiveRun: true,
        status: "running",
        startedAt: START,
        // now-fixed deadline 60 min out; the timer computes TIME LEFT from it.
        deadlineAt: "2026-07-24T01:00:00.000Z",
        durationMinutes: 60,
      }),
    });
    render(<MissionControlHeader sessionId={SESSION} />);
    expect(screen.getByText("#25")).toBeTruthy();
    expect(screen.getByText("PONS Scalper")).toBeTruthy();
    // Status pill + its live-pulse counterpart on the timer.
    const pill = screen.getByText("Running");
    expect(pill.closest("[data-vex-area='run-status-pill']")).toBeTruthy();
    expect(screen.getByText(/Running time/i)).toBeTruthy();
    expect(screen.getByText(/Time left/i)).toBeTruthy();
  });

  it("tones a paused_error run as an error pill", () => {
    mockUseRuntimeState.mockReturnValue({
      data: runtime({
        hasActiveRun: true,
        status: "paused_error",
        startedAt: START,
      }),
    });
    render(<MissionControlHeader sessionId={SESSION} />);
    const pill = screen
      .getByText(/Paused — error/i)
      .closest("[data-vex-area='run-status-pill']") as HTMLElement | null;
    expect(pill?.getAttribute("data-tone")).toBe("error");
  });

  it("shows the idle pill and no timer when there is no active run", () => {
    render(<MissionControlHeader sessionId={SESSION} />);
    expect(screen.getByText("No active run")).toBeTruthy();
    expect(screen.queryByText(/Running time/i)).toBeNull();
  });
});
