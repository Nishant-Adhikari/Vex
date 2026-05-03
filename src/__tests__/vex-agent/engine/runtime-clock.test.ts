import { describe, expect, it } from "vitest";

import {
  buildRuntimeClockPrompt,
  buildRuntimeClockSnapshot,
  formatDuration,
} from "../../../vex-agent/engine/runtime-clock.js";

describe("runtime-clock", () => {
  it("formats compact durations for prompt display", () => {
    expect(formatDuration(0)).toBe("0s");
    expect(formatDuration(12_345)).toBe("12s");
    expect(formatDuration(3 * 60_000 + 4_000)).toBe("3m 04s");
    expect(formatDuration(5 * 3_600_000 + 6 * 60_000)).toBe("5h 06m");
    expect(formatDuration(2 * 86_400_000 + 3 * 3_600_000)).toBe("2d 03h");
  });

  it("builds elapsed and remaining clock state from a single now", () => {
    const snapshot = buildRuntimeClockSnapshot({
      now: new Date("2026-05-03T08:39:18.126Z"),
      timezone: "UTC",
      sessionStartedAt: "2026-05-03T08:01:02.000Z",
      missionRunStartedAt: "2026-05-03T08:10:00.000Z",
      missionDeadline: "2026-05-03T14:10:00.000Z",
      pendingWake: {
        dueAt: "2026-05-03T08:49:18.126Z",
        reason: "recheck market",
      },
    });

    expect(snapshot.currentTimeUtc).toBe("2026-05-03T08:39:18.126Z");
    expect(snapshot.sessionElapsed).toBe("38m 16s");
    expect(snapshot.missionRunElapsed).toBe("29m 18s");
    expect(snapshot.missionDeadlineState).toBe("in 5h 30m");
    expect(snapshot.pendingWakeState).toBe("in 10m 00s");
    expect(snapshot.pendingWakeReason).toBe("recheck market");
  });

  it("renders overdue deadlines explicitly", () => {
    const snapshot = buildRuntimeClockSnapshot({
      now: new Date("2026-05-03T08:39:18.126Z"),
      timezone: "UTC",
      missionDeadline: "2026-05-03T08:20:00.000Z",
    });

    expect(snapshot.missionDeadlineState).toBe("overdue by 19m 18s");
    expect(buildRuntimeClockPrompt(snapshot)).toContain("overdue by 19m 18s");
  });
});
