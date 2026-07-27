/**
 * SESSION block — pins the compact, deduped layout it took on when it folded
 * into MISSION CONTROL:
 *   - a TWO-COLUMN grid (not a stack of full-width rows),
 *   - it keeps the session-level facts (MODE, ACCESS, ENDED, MISSION PNL),
 *   - it does NOT repeat what the MissionControlHeader already owns: STATUS
 *     and the run's START / elapsed timers.
 *
 * The api hooks are mocked — this suite owns the block's display shape, not the
 * query wiring.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const mockUseSession = vi.hoisted(() => vi.fn());
const mockUseMissionResult = vi.hoisted(() => vi.fn());

vi.mock("@hugeicons/react", () => ({ HugeiconsIcon: () => null }));
vi.mock("../../../lib/api/sessions.js", () => ({ useSession: mockUseSession }));
vi.mock("../../../lib/api/mission.js", () => ({
  useMissionSessionResult: mockUseMissionResult,
}));

const { SessionBlock } = await import("../book/SessionBlock.js");
const { useUiStore } = await import("../../../stores/uiStore.js");

const SESSION = "00000000-0000-4000-8000-00000000abcd";

function mockSession(mode: "mission" | "agent", permission: "full" | "restricted"): void {
  mockUseSession.mockReturnValue({
    isLoading: false,
    data: {
      ok: true,
      data: {
        id: SESSION,
        mode,
        permission,
        title: "PONS Scalper",
        initialGoal: null,
        startedAt: "2026-07-12T10:00:00.000Z",
        endedAt: null,
        missionStatus: "running",
        pinnedAt: null,
      },
    },
  });
}

function mockResult(
  result: {
    startedAt: string;
    endedAt: string | null;
    pnlEth: number | null;
    pnlPct: number | null;
    ethPriceUsdEnd: number | null;
  } | null,
): void {
  mockUseMissionResult.mockReturnValue({
    data: { ok: true, data: result },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  useUiStore.setState({ bookSectionCollapsed: {} });
});

describe("SessionBlock compact layout", () => {
  it("lays out its cells in a two-column grid", () => {
    mockSession("mission", "full");
    mockResult({
      startedAt: "2026-07-12T10:00:00.000Z",
      endedAt: "2026-07-12T11:00:00.000Z",
      pnlEth: 0.01,
      pnlPct: 4.2,
      ethPriceUsdEnd: 3000,
    });
    const { container } = render(
      <SessionBlock sessionId={SESSION} collapsible sectionId="session" />,
    );
    expect(container.querySelector(".grid-cols-2")).not.toBeNull();
  });

  it("keeps session-level facts: Mode, Access, Ended, Mission PnL", () => {
    mockSession("mission", "restricted");
    mockResult({
      startedAt: "2026-07-12T10:00:00.000Z",
      endedAt: "2026-07-12T11:00:00.000Z",
      pnlEth: 0.01,
      pnlPct: 4.2,
      ethPriceUsdEnd: 3000,
    });
    render(<SessionBlock sessionId={SESSION} collapsible sectionId="session" />);
    expect(screen.getByText("Mode")).not.toBeNull();
    expect(screen.getByText("Access")).not.toBeNull();
    expect(screen.getByText("Ended")).not.toBeNull();
    expect(screen.getByText("Mission PnL")).not.toBeNull();
  });

  it("does NOT duplicate the header's Status or run START/MISSION timers", () => {
    mockSession("mission", "full");
    mockResult({
      startedAt: "2026-07-12T10:00:00.000Z",
      endedAt: "2026-07-12T11:00:00.000Z",
      pnlEth: 0.01,
      pnlPct: 4.2,
      ethPriceUsdEnd: 3000,
    });
    render(<SessionBlock sessionId={SESSION} collapsible sectionId="session" />);
    expect(screen.queryByText("Status")).toBeNull();
    expect(screen.queryByText("Started")).toBeNull();
    expect(screen.queryByText("Mission start")).toBeNull();
    expect(screen.queryByText("Mission end")).toBeNull();
  });

  it("omits the Ended cell while a run is still live (no end time)", () => {
    mockSession("mission", "full");
    mockResult({
      startedAt: "2026-07-12T10:00:00.000Z",
      endedAt: null,
      pnlEth: null,
      pnlPct: null,
      ethPriceUsdEnd: null,
    });
    render(<SessionBlock sessionId={SESSION} collapsible sectionId="session" />);
    expect(screen.queryByText("Ended")).toBeNull();
  });
});
