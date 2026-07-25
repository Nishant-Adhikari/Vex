/**
 * SessionsList — pins the sidebar composition changes from the panel-cleanup
 * pass:
 *   - the LEFT rail now renders the full POSITION card (moved off the right
 *     MISSION CONTROL panel), scoped to the active session, and only while the
 *     rail is expanded,
 *   - the default list HIDES ended mission-kind runs (the user reads history in
 *     the Missions view), while keeping chat/agent, live missions, and pinned.
 *
 * Leaf children (footer registry, session rows, dialogs) are stubbed — this
 * suite owns the sidebar's own composition + filtering, not their internals.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { SessionListItem } from "@shared/schemas/sessions.js";

const mockUseSessionsList = vi.hoisted(() => vi.fn());

vi.mock("@hugeicons/react", () => ({ HugeiconsIcon: () => null }));
vi.mock("../../../lib/api/sessions.js", () => ({
  useSessionsList: mockUseSessionsList,
  useSetSessionPinned: () => ({ mutate: vi.fn(), isPending: false, variables: null }),
  useDeleteSession: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

// The POSITION card — stubbed to a probe that echoes the scope it was handed.
vi.mock("../book/PositionBlock.js", () => ({
  PositionBlock: ({ activeSessionId }: { activeSessionId: string | null }) => (
    <div data-testid="left-position" data-scope={activeSessionId ?? "global"} />
  ),
}));

// Session rows — stub that renders each visible row's title so the filter is
// observable without the real row chrome.
vi.mock("../SessionRows.js", () => ({
  SessionGroups: ({ groups }: { groups: ReadonlyArray<{ rows: readonly SessionListItem[] }> }) => (
    <div data-testid="rows">
      {groups.flatMap((g) => g.rows).map((r) => (
        <span key={r.id}>{r.title}</span>
      ))}
    </div>
  ),
  SessionsLoadingPlaceholder: () => null,
  SessionsErrorPlaceholder: () => null,
  SessionsEmptyPlaceholder: () => <div data-testid="empty" />,
  SidebarIconButton: ({ children }: { children: React.ReactNode }) => (
    <button type="button">{children}</button>
  ),
}));

vi.mock("../SessionDeleteDialog.js", () => ({ SessionDeleteDialog: () => null }));
vi.mock("../SessionPresets.js", () => ({ SessionPresets: () => null }));
vi.mock("../MemoryButton.js", () => ({ MemoryButton: () => null }));
vi.mock("../MissionsButton.js", () => ({ MissionsButton: () => null }));
vi.mock("../SignalsButton.js", () => ({ SignalsButton: () => null }));
vi.mock("../RuntimeLedger.js", () => ({ RuntimeLedger: () => null }));
vi.mock("../SettingsButton.js", () => ({ SettingsButton: () => null }));
vi.mock("../SidebarHomeSigil.js", () => ({ SidebarHomeSigil: () => null }));

const { SessionsList } = await import("../SessionsList.js");
const { useUiStore } = await import("../../../stores/uiStore.js");

function row(overrides: Partial<SessionListItem>): SessionListItem {
  return {
    id: crypto.randomUUID(),
    mode: "agent",
    permission: "restricted",
    title: "Session",
    initialGoal: null,
    startedAt: "2026-07-12T10:00:00.000Z",
    endedAt: null,
    missionStatus: null,
    pinnedAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useUiStore.setState({
    sidebarOpen: true,
    activeSessionId: null,
    sessionModeFilter: "all",
  });
});

describe("SessionsList — left POSITION card", () => {
  it("renders the full POSITION card on the left rail when expanded", () => {
    mockUseSessionsList.mockReturnValue({ isLoading: false, data: { ok: true, data: [] } });
    render(<SessionsList onCreate={() => {}} />);
    expect(screen.getByTestId("left-position")).not.toBeNull();
  });

  it("scopes the POSITION card to the active session", () => {
    const active = "00000000-0000-4000-8000-00000000feed";
    useUiStore.setState({ activeSessionId: active });
    mockUseSessionsList.mockReturnValue({ isLoading: false, data: { ok: true, data: [] } });
    render(<SessionsList onCreate={() => {}} />);
    expect(screen.getByTestId("left-position").getAttribute("data-scope")).toBe(active);
  });

  it("hides the POSITION card when the rail is collapsed", () => {
    useUiStore.setState({ sidebarOpen: false });
    mockUseSessionsList.mockReturnValue({ isLoading: false, data: { ok: true, data: [] } });
    render(<SessionsList onCreate={() => {}} />);
    expect(screen.queryByTestId("left-position")).toBeNull();
  });
});

describe("SessionsList — default list hides ended missions", () => {
  const rows: readonly SessionListItem[] = [
    row({ title: "Chat with agent", mode: "agent" }),
    row({ title: "Live PONS", mode: "mission", missionStatus: "running" }),
    row({ title: "Ended PONS", mode: "mission", missionStatus: "completed" }),
  ];

  it("shows chat + live mission, drops the ended mission on the All tab", () => {
    mockUseSessionsList.mockReturnValue({ isLoading: false, data: { ok: true, data: rows } });
    render(<SessionsList onCreate={() => {}} />);
    expect(screen.getByText("Chat with agent")).not.toBeNull();
    expect(screen.getByText("Live PONS")).not.toBeNull();
    expect(screen.queryByText("Ended PONS")).toBeNull();
  });

  it("keeps the full mission history (incl. ended) on the Mission tab", () => {
    useUiStore.setState({ sessionModeFilter: "mission" });
    mockUseSessionsList.mockReturnValue({ isLoading: false, data: { ok: true, data: rows } });
    render(<SessionsList onCreate={() => {}} />);
    expect(screen.getByText("Live PONS")).not.toBeNull();
    expect(screen.getByText("Ended PONS")).not.toBeNull();
    // Agent row is filtered out by the mode filter, not by the ended-mission rule.
    expect(screen.queryByText("Chat with agent")).toBeNull();
  });
});
