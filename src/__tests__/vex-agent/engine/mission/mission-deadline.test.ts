/**
 * Hard mission deadline — computed from the run's immutable started_at + a
 * configurable duration (default 60 min). The free-text contract `deadline` is
 * intentionally NOT used (it proved unreliable — set-but-ignored, or prose).
 */

import { describe, it, expect } from "vitest";
import {
  hardDeadlineMinutes,
  computeHardDeadlineMs,
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
