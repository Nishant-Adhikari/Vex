/**
 * Overnight self-heal — deadline bound (the hard stop on recovery).
 */
import { describe, it, expect } from "vitest";
import {
  withinDeadline,
  withinRecoveryBounds,
  runDeadlineMs,
} from "@vex-agent/engine/self-heal/bounds.js";

const START = "2026-07-25T00:00:00.000Z";
const startMs = Date.parse(START);

const snap = (durationMinutes: number) => ({
  frozenMission: { constraintsJson: { durationMinutes } },
});

describe("runDeadlineMs", () => {
  it("started_at + structured box duration", () => {
    expect(runDeadlineMs({ startedAt: START, contractSnapshotJson: snap(30) }, {})).toBe(
      startMs + 30 * 60_000,
    );
  });
  it("falls back to the 60-min default when no duration", () => {
    expect(runDeadlineMs({ startedAt: START, contractSnapshotJson: null }, {})).toBe(
      startMs + 60 * 60_000,
    );
  });
  it("null on an unparseable start (fail-open)", () => {
    expect(runDeadlineMs({ startedAt: "not-a-date", contractSnapshotJson: null }, {})).toBeNull();
  });
});

describe("withinDeadline / withinRecoveryBounds", () => {
  const run = { startedAt: START, contractSnapshotJson: snap(60) };
  it("true before the deadline", () => {
    expect(withinDeadline(run, startMs + 59 * 60_000, {})).toBe(true);
    expect(withinRecoveryBounds(run, startMs + 59 * 60_000, {})).toBe(true);
  });
  it("false at/after the deadline (recovery ceases)", () => {
    expect(withinDeadline(run, startMs + 60 * 60_000, {})).toBe(false);
    expect(withinDeadline(run, startMs + 120 * 60_000, {})).toBe(false);
    expect(withinRecoveryBounds(run, startMs + 120 * 60_000, {})).toBe(false);
  });
  it("fail-open on an unparseable start", () => {
    expect(
      withinDeadline({ startedAt: "nope", contractSnapshotJson: null }, Date.now(), {}),
    ).toBe(true);
  });
});
