/**
 * Backoff gate tests for the in-process unlock throttle.
 *
 * Uses vi.useFakeTimers() to control Date.now() — the module reads time via
 * the global Date, so faked timers + setSystemTime are sufficient.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkUnlockAllowed,
  recordUnlockFailure,
  recordUnlockSuccess,
  resetUnlockThrottle,
} from "../unlock-throttle.js";

const T0 = new Date("2026-01-01T00:00:00.000Z");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  resetUnlockThrottle();
});

afterEach(() => {
  resetUnlockThrottle();
  vi.useRealTimers();
});

describe("checkUnlockAllowed", () => {
  it("returns allowed=true at rest", () => {
    expect(checkUnlockAllowed()).toEqual({ allowed: true });
  });

  it("returns allowed=false with retryAfterMs immediately after a failure", () => {
    recordUnlockFailure();
    const gate = checkUnlockAllowed();
    expect(gate.allowed).toBe(false);
    if (!gate.allowed) {
      // First failure arms a 1s window — retryAfterMs should equal the
      // remaining 1000ms (we have not advanced time yet).
      expect(gate.retryAfterMs).toBe(1_000);
    }
  });
});

describe("backoff schedule", () => {
  const expectBackoff = (afterCalls: number, expectedMs: number): void => {
    resetUnlockThrottle();
    vi.setSystemTime(T0);
    for (let i = 0; i < afterCalls; i += 1) {
      // Re-arm at T0 each iteration so the final retryAfterMs is unambiguous.
      vi.setSystemTime(T0);
      recordUnlockFailure();
    }
    const gate = checkUnlockAllowed();
    expect(gate.allowed).toBe(false);
    if (!gate.allowed) {
      expect(gate.retryAfterMs).toBe(expectedMs);
    }
  };

  it("1st failure → 1s", () => {
    expectBackoff(1, 1_000);
  });

  it("2nd failure → 2s", () => {
    expectBackoff(2, 2_000);
  });

  it("3rd failure → 4s", () => {
    expectBackoff(3, 4_000);
  });

  it("4th failure → 8s", () => {
    expectBackoff(4, 8_000);
  });

  it("5th failure → 30s (mid-plateau)", () => {
    expectBackoff(5, 30_000);
  });

  it("9th failure → 30s (top of 5..9 plateau)", () => {
    expectBackoff(9, 30_000);
  });

  it("10th failure → 5min (300s lockout)", () => {
    expectBackoff(10, 300_000);
  });

  it("15th failure → 5min (lockout plateau holds)", () => {
    expectBackoff(15, 300_000);
  });
});

describe("recordUnlockSuccess resets the counter", () => {
  it("clears the gate even after multiple failures", () => {
    recordUnlockFailure();
    recordUnlockFailure();
    recordUnlockFailure();
    recordUnlockSuccess();
    expect(checkUnlockAllowed()).toEqual({ allowed: true });
  });

  it("restarts backoff from 1s on the next failure", () => {
    recordUnlockFailure();
    recordUnlockFailure();
    recordUnlockFailure();
    recordUnlockSuccess();

    // Fresh failure should re-arm at 1s, not 4s.
    vi.setSystemTime(T0);
    recordUnlockFailure();
    const gate = checkUnlockAllowed();
    expect(gate.allowed).toBe(false);
    if (!gate.allowed) {
      expect(gate.retryAfterMs).toBe(1_000);
    }
  });
});

describe("time advancement", () => {
  it("returns allowed=true after retryAfterMs elapses", () => {
    recordUnlockFailure();
    // Advance just past 1s window.
    vi.setSystemTime(T0.getTime() + 1_001);
    expect(checkUnlockAllowed()).toEqual({ allowed: true });
  });

  it("still blocks while inside the window", () => {
    recordUnlockFailure();
    vi.setSystemTime(T0.getTime() + 500);
    const gate = checkUnlockAllowed();
    expect(gate.allowed).toBe(false);
    if (!gate.allowed) {
      expect(gate.retryAfterMs).toBe(500);
    }
  });

  it("after the 5min lockout elapses, fresh check is allowed", () => {
    for (let i = 0; i < 10; i += 1) recordUnlockFailure();
    // Advance past the 5-minute lockout (300s + 1ms).
    vi.setSystemTime(T0.getTime() + 300_001);
    expect(checkUnlockAllowed()).toEqual({ allowed: true });
  });
});

describe("resetUnlockThrottle (test helper)", () => {
  it("clears all state", () => {
    for (let i = 0; i < 4; i += 1) recordUnlockFailure();
    resetUnlockThrottle();
    expect(checkUnlockAllowed()).toEqual({ allowed: true });
  });
});
