/**
 * Hard mission deadline — computed from the run's immutable started_at + a
 * configurable duration (default 60 min). The free-text contract `deadline` is
 * intentionally NOT used (it proved unreliable — set-but-ignored, or prose).
 */

import { describe, it, expect } from "vitest";
import {
  hardDeadlineMinutes,
  resolveDurationMinutes,
  computeHardDeadlineMs,
  resolveRunHardDeadlineMs,
} from "@vex-agent/engine/mission/mission-deadline.js";

describe("hardDeadlineMinutes", () => {
  it("defaults to 60 minutes with no override", () => {
    expect(hardDeadlineMinutes({})).toBe(60);
  });
  it("honors a valid VEX_MISSION_HARD_DEADLINE_MIN override (e.g. a 2-min test box)", () => {
    expect(hardDeadlineMinutes({ VEX_MISSION_HARD_DEADLINE_MIN: "2" })).toBe(2);
  });
  it("falls back to 60 on a non-numeric or non-positive override", () => {
    expect(hardDeadlineMinutes({ VEX_MISSION_HARD_DEADLINE_MIN: "abc" })).toBe(60);
    expect(hardDeadlineMinutes({ VEX_MISSION_HARD_DEADLINE_MIN: "0" })).toBe(60);
    expect(hardDeadlineMinutes({ VEX_MISSION_HARD_DEADLINE_MIN: "-5" })).toBe(60);
  });
  it("clamps absurdly large values to a 24h ceiling", () => {
    expect(hardDeadlineMinutes({ VEX_MISSION_HARD_DEADLINE_MIN: "99999" })).toBe(1440);
  });
});

describe("resolveDurationMinutes (per-mission > env > default)", () => {
  it("uses the mission's own durationMinutes when set and valid", () => {
    expect(resolveDurationMinutes(5, {})).toBe(5);
    expect(resolveDurationMinutes(10, { VEX_MISSION_HARD_DEADLINE_MIN: "60" })).toBe(10);
  });
  it("clamps an absurd per-mission value to the 24h ceiling", () => {
    expect(resolveDurationMinutes(99999, {})).toBe(1440);
  });
  it("falls back to the env override when the mission has no duration", () => {
    expect(resolveDurationMinutes(null, { VEX_MISSION_HARD_DEADLINE_MIN: "2" })).toBe(2);
    expect(resolveDurationMinutes(undefined, { VEX_MISSION_HARD_DEADLINE_MIN: "2" })).toBe(2);
  });
  it("falls back to 60 when neither mission nor env specifies one", () => {
    expect(resolveDurationMinutes(null, {})).toBe(60);
    expect(resolveDurationMinutes(0, {})).toBe(60);
    expect(resolveDurationMinutes(-5, {})).toBe(60);
  });
});

describe("computeHardDeadlineMs", () => {
  it("is started_at + duration in epoch ms", () => {
    const start = "2026-07-12T19:00:00.000Z";
    const startMs = Date.parse(start);
    expect(computeHardDeadlineMs(start, 2)).toBe(startMs + 2 * 60_000);
    expect(computeHardDeadlineMs(start, 60)).toBe(startMs + 60 * 60_000);
  });
  it("returns null for an unparseable start (fail-open: no false deadline)", () => {
    expect(computeHardDeadlineMs("not-a-date", 60)).toBeNull();
  });
});

describe("resolveRunHardDeadlineMs (run-row → deadline, agent-independent)", () => {
  const start = "2026-07-12T19:00:00.000Z";
  const startMs = Date.parse(start);

  function runWith(
    frozenDuration: number | null,
    draftDuration: number | null = null,
  ) {
    return {
      startedAt: start,
      contractSnapshotJson: {
        version: 1,
        frozenMission: {
          constraintsJson:
            frozenDuration == null ? {} : { durationMinutes: frozenDuration },
          draft: draftDuration == null ? {} : { durationMinutes: draftDuration },
        },
      } as Record<string, unknown>,
    };
  }

  it("reads the FROZEN durationMinutes from the run's contract snapshot", () => {
    expect(resolveRunHardDeadlineMs(runWith(5), {})).toBe(startMs + 5 * 60_000);
  });

  it("falls back to the frozen draft.durationMinutes when constraints omit it", () => {
    expect(resolveRunHardDeadlineMs(runWith(null, 12), {})).toBe(
      startMs + 12 * 60_000,
    );
  });

  it("falls back to the env override, then 60, when the snapshot has no duration", () => {
    expect(
      resolveRunHardDeadlineMs(runWith(null), {
        VEX_MISSION_HARD_DEADLINE_MIN: "2",
      }),
    ).toBe(startMs + 2 * 60_000);
    expect(resolveRunHardDeadlineMs(runWith(null), {})).toBe(startMs + 60 * 60_000);
  });

  it("defaults to a 60-min box when there is no snapshot at all", () => {
    expect(
      resolveRunHardDeadlineMs(
        { startedAt: start, contractSnapshotJson: null },
        {},
      ),
    ).toBe(startMs + 60 * 60_000);
  });

  it("fail-open: returns null on an unparseable started_at (never a false deadline)", () => {
    expect(
      resolveRunHardDeadlineMs(
        { startedAt: "not-a-date", contractSnapshotJson: null },
        {},
      ),
    ).toBeNull();
  });
});
