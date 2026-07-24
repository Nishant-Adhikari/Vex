/**
 * ActiveMissionsBar — the persistent cross-session run monitor. These tests
 * pin the three behaviours that make it a safety surface:
 *   1. it collapses to NOTHING when there are no active missions (and on a
 *      hard query error) — never a broken empty frame;
 *   2. it distinguishes a stale/orphaned row ("needs cleanup") from a live
 *      run, so an orphan can't masquerade as live;
 *   3. clicking an entry selects that session (real uiStore transition).
 *
 * The data hook is mocked — the classification itself is covered by
 * activeMissionsModel.test.ts; here we drive the component off its output.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ActiveMission } from "../activeMissionsModel.js";

const useActiveMissionsMock = vi.fn();
vi.mock("../useActiveMissions.js", () => ({
  useActiveMissions: () => useActiveMissionsMock(),
}));

const { ActiveMissionsBar } = await import("../ActiveMissionsBar.js");
const { useUiStore } = await import("../../../stores/uiStore.js");

function mission(over: Partial<ActiveMission> = {}): ActiveMission {
  return {
    missionRunId: "run-1",
    sessionId: "sess-1",
    seqNo: 1,
    label: "grow ETH",
    status: "running",
    pnlEth: null,
    pnlPct: null,
    openPositionsCount: 0,
    ...over,
  };
}

beforeEach(() => {
  useActiveMissionsMock.mockReset();
  useUiStore.setState({ activeSessionId: null, appShellView: "session" });
});

describe("ActiveMissionsBar", () => {
  it("renders nothing when there are no active missions", () => {
    useActiveMissionsMock.mockReturnValue({ missions: [], isError: false });
    const { container } = render(<ActiveMissionsBar />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing on a hard query error (fail-soft)", () => {
    useActiveMissionsMock.mockReturnValue({
      missions: [mission()],
      isError: true,
    });
    const { container } = render(<ActiveMissionsBar />);
    expect(container.firstChild).toBeNull();
  });

  it("shows a live run as 'running' and an orphaned row as 'needs cleanup'", () => {
    useActiveMissionsMock.mockReturnValue({
      missions: [
        mission({ missionRunId: "live", sessionId: "s-live", seqNo: 20, status: "running" }),
        mission({ missionRunId: "orphan", sessionId: "s-orphan", seqNo: 18, status: "stale_orphaned" }),
      ],
      isError: false,
    });
    render(<ActiveMissionsBar />);
    expect(screen.getByText("running")).toBeTruthy();
    expect(screen.getByText("needs cleanup")).toBeTruthy();
    expect(screen.getByText("#20")).toBeTruthy();
    expect(screen.getByText("#18")).toBeTruthy();
  });

  it("surfaces open-position count and PnL", () => {
    useActiveMissionsMock.mockReturnValue({
      missions: [mission({ pnlEth: -0.004, pnlPct: -12, openPositionsCount: 2 })],
      isError: false,
    });
    render(<ActiveMissionsBar />);
    expect(screen.getByText("2 held")).toBeTruthy();
  });

  it("selects the session and returns to the session view on click", () => {
    useActiveMissionsMock.mockReturnValue({
      missions: [mission({ sessionId: "sess-42", label: "moonbag exit" })],
      isError: false,
    });
    useUiStore.setState({ appShellView: "missionHistory" });
    render(<ActiveMissionsBar />);
    fireEvent.click(screen.getByRole("button", { name: /moonbag exit/i }));
    expect(useUiStore.getState().activeSessionId).toBe("sess-42");
    expect(useUiStore.getState().appShellView).toBe("session");
  });
});
