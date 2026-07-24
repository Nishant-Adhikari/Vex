/**
 * Pure mission-run timing math — elapsed/remaining derivation + the clock
 * formatter. Node env (no DOM): the whole point of extracting the math.
 */

import { describe, expect, it } from "vitest";
import {
  computeMissionRunTiming,
  formatDurationClock,
  toEpochMs,
} from "../missionRunTiming.js";

const START = Date.parse("2026-07-24T00:00:00.000Z");

describe("computeMissionRunTiming", () => {
  it("computes elapsed since start (clamped at 0)", () => {
    const t = computeMissionRunTiming(START, null, START + 90_000);
    expect(t.elapsedMs).toBe(90_000);
    expect(t.remainingMs).toBeNull();
    expect(t.overdue).toBe(false);
    expect(t.fractionElapsed).toBeNull();
  });

  it("never returns a negative elapsed under clock skew (now < start)", () => {
    const t = computeMissionRunTiming(START, null, START - 5_000);
    expect(t.elapsedMs).toBe(0);
  });

  it("computes remaining + fraction for a known 60-min deadline", () => {
    const deadline = START + 60 * 60_000;
    // 15 minutes in.
    const t = computeMissionRunTiming(START, deadline, START + 15 * 60_000);
    expect(t.elapsedMs).toBe(15 * 60_000);
    expect(t.remainingMs).toBe(45 * 60_000);
    expect(t.overdue).toBe(false);
    expect(t.fractionElapsed).toBeCloseTo(0.25, 5);
  });

  it("clamps remaining at 0 and flags overdue once the deadline passes", () => {
    const deadline = START + 60 * 60_000;
    const t = computeMissionRunTiming(START, deadline, deadline + 30_000);
    expect(t.remainingMs).toBe(0);
    expect(t.overdue).toBe(true);
    expect(t.fractionElapsed).toBe(1);
  });

  it("treats a non-finite / degenerate deadline as unknown", () => {
    const t = computeMissionRunTiming(START, Number.NaN, START + 1_000);
    expect(t.remainingMs).toBeNull();
    expect(t.fractionElapsed).toBeNull();
  });

  it("guards a zero-width window (deadline == start) without dividing by zero", () => {
    const t = computeMissionRunTiming(START, START, START);
    expect(t.remainingMs).toBe(0);
    expect(t.fractionElapsed).toBe(1);
    expect(t.overdue).toBe(true);
  });
});

describe("formatDurationClock", () => {
  it("formats sub-hour durations as M:SS", () => {
    expect(formatDurationClock(0)).toBe("0:00");
    expect(formatDurationClock(9_000)).toBe("0:09");
    expect(formatDurationClock(65_000)).toBe("1:05");
    expect(formatDurationClock(59 * 60_000 + 59_000)).toBe("59:59");
  });

  it("formats hour+ durations as H:MM:SS", () => {
    expect(formatDurationClock(60 * 60_000)).toBe("1:00:00");
    expect(formatDurationClock(2 * 3_600_000 + 3 * 60_000 + 4_000)).toBe("2:03:04");
  });

  it("clamps negatives to 0:00", () => {
    expect(formatDurationClock(-5_000)).toBe("0:00");
  });
});

describe("toEpochMs", () => {
  it("parses an ISO timestamp", () => {
    expect(toEpochMs("2026-07-24T00:00:00.000Z")).toBe(START);
  });
  it("returns null for null/undefined/garbage", () => {
    expect(toEpochMs(null)).toBeNull();
    expect(toEpochMs(undefined)).toBeNull();
    expect(toEpochMs("not-a-date")).toBeNull();
  });
});
