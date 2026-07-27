import { describe, expect, it } from "vitest";
import type { SessionListItem } from "@shared/schemas/sessions.js";
import {
  filterSessionsByMode,
  filterSessionsByTitle,
  formatSessionTime,
  hideEndedMissions,
  isLiveMission,
  SESSION_MODE_FILTERS,
} from "../sessionListModel.js";

describe("formatSessionTime", () => {
  it("formats older dates with an English (en-US) month, not the OS locale", () => {
    // Mid-month + midday UTC: the local date stays within June across every
    // timezone (UTC-12..UTC+14), so the English month abbreviation is
    // deterministic. A non-English OS locale (e.g. Polish "cze") would fail
    // this assertion, which is exactly the regression we guard against.
    const result = formatSessionTime("2020-06-15T12:00:00Z");
    expect(result).toMatch(/^Jun \d{1,2}$/);
  });

  it("returns an empty string for an invalid date", () => {
    expect(formatSessionTime("not-a-date")).toBe("");
  });
});

describe("filterSessionsByTitle", () => {
  const rows: readonly SessionListItem[] = [
    makeRow({ title: "Arbitrum LP Rebalance" }),
    makeRow({ title: "Daily gas report", mode: "mission" }),
    makeRow({ title: null, initialGoal: "Watch ETH funding rates" }),
  ];

  it("matches rendered titles case-insensitively and trims the query", () => {
    expect(filterSessionsByTitle(rows, "  GAS ")).toEqual([rows[1]]);
  });

  it("keeps legacy sessions searchable through their rendered goal fallback", () => {
    expect(filterSessionsByTitle(rows, "funding")).toEqual([rows[2]]);
  });

  it("searches the complete title rather than only its truncated display label", () => {
    const longTitle = makeRow({
      title: `${"A".repeat(60)} hidden-keyword`,
    });
    expect(filterSessionsByTitle([longTitle], "hidden-keyword")).toEqual([
      longTitle,
    ]);
  });

  it("returns the original rows for an empty query", () => {
    expect(filterSessionsByTitle(rows, "   ")).toBe(rows);
  });
});

describe("SESSION_MODE_FILTERS / filterSessionsByMode", () => {
  it("exposes the Presets tab alongside the session-mode filters", () => {
    const values = SESSION_MODE_FILTERS.map((f) => f.value);
    expect(values).toEqual(["all", "agent", "mission", "presets"]);
  });

  it("yields no session rows for the presets tab (it is not a session mode)", () => {
    const rows: readonly SessionListItem[] = [
      makeRow({ mode: "agent" }),
      makeRow({ mode: "mission" }),
    ];
    expect(filterSessionsByMode(rows, "presets")).toEqual([]);
  });
});

describe("isLiveMission", () => {
  it("is true for a running mission and any paused_* status", () => {
    expect(isLiveMission(makeRow({ mode: "mission", missionStatus: "running" }))).toBe(true);
    expect(
      isLiveMission(makeRow({ mode: "mission", missionStatus: "paused_approval" })),
    ).toBe(true);
    expect(
      isLiveMission(makeRow({ mode: "mission", missionStatus: "paused_user" })),
    ).toBe(true);
  });

  it("is false for a terminal run, a no-run mission, and any agent session", () => {
    for (const status of ["completed", "failed", "stopped", "cancelled"] as const) {
      expect(isLiveMission(makeRow({ mode: "mission", missionStatus: status }))).toBe(false);
    }
    expect(isLiveMission(makeRow({ mode: "mission", missionStatus: null }))).toBe(false);
    expect(isLiveMission(makeRow({ mode: "agent", missionStatus: "running" }))).toBe(false);
  });
});

describe("hideEndedMissions", () => {
  const agent = makeRow({ id: "a", mode: "agent" });
  const live = makeRow({ id: "l", mode: "mission", missionStatus: "running" });
  const paused = makeRow({ id: "p", mode: "mission", missionStatus: "paused_error" });
  const ended = makeRow({ id: "e", mode: "mission", missionStatus: "completed" });
  const endedNull = makeRow({ id: "n", mode: "mission", missionStatus: null });
  const pinnedEnded = makeRow({
    id: "pe",
    mode: "mission",
    missionStatus: "stopped",
    pinnedAt: "2026-07-12T10:00:00.000Z",
  });
  const rows = [agent, live, paused, ended, endedNull, pinnedEnded];

  it("keeps chat, live/paused missions, and pinned rows; drops ended missions", () => {
    const kept = hideEndedMissions(rows).map((r) => r.id);
    expect(kept).toEqual(["a", "l", "p", "pe"]);
  });

  it("never yanks the currently-open session, even an ended mission", () => {
    const kept = hideEndedMissions(rows, "e").map((r) => r.id);
    expect(kept).toContain("e");
  });

  it("is a no-op for a list with no ended missions", () => {
    const clean = [agent, live, paused];
    expect(hideEndedMissions(clean).map((r) => r.id)).toEqual(["a", "l", "p"]);
  });
});

function makeRow(
  overrides: Partial<SessionListItem>,
): SessionListItem {
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
