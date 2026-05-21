import { describe, expect, it } from "vitest";
import { createBugReportRateLimiter } from "../bug-report-rate-limiter.js";

const SESSION = "session-x";

describe("bug-report rate limiter", () => {
  it("admits up to maxPerWindow per key, then drops", () => {
    let t = 0;
    const limiter = createBugReportRateLimiter({
      windowMs: 60_000,
      maxPerWindow: 3,
      lruCap: 1024,
      now: () => t,
    });
    const key = {
      category: "mission_paused_error",
      correlationId: "corr-1",
      sessionId: SESSION,
      toolName: null,
      protocolNamespace: null,
      redactedTitle: "mission failed",
    };
    expect(limiter.tryAdmit(key)).toBe(true);
    expect(limiter.tryAdmit(key)).toBe(true);
    expect(limiter.tryAdmit(key)).toBe(true);
    expect(limiter.tryAdmit(key)).toBe(false);
    expect(limiter.droppedCount()).toBe(1);
  });

  it("re-admits after the sliding window slides past the oldest timestamp", () => {
    let t = 0;
    const limiter = createBugReportRateLimiter({
      windowMs: 1_000,
      maxPerWindow: 2,
      now: () => t,
    });
    const key = {
      category: "wake_resume_failure",
      correlationId: null,
      sessionId: SESSION,
      toolName: null,
      protocolNamespace: null,
      redactedTitle: "wake failed",
    };

    expect(limiter.tryAdmit(key)).toBe(true); // t=0
    t = 500;
    expect(limiter.tryAdmit(key)).toBe(true); // t=500
    expect(limiter.tryAdmit(key)).toBe(false); // capacity hit

    t = 1_100; // first timestamp (0) is now outside the 1_000ms window
    expect(limiter.tryAdmit(key)).toBe(true);
  });

  it("treats different correlation IDs as distinct keys", () => {
    const limiter = createBugReportRateLimiter({ windowMs: 60_000, maxPerWindow: 1 });
    const base = {
      category: "compact_unable_at_critical",
      sessionId: SESSION,
      toolName: null,
      protocolNamespace: null,
      redactedTitle: "x",
    };
    expect(limiter.tryAdmit({ ...base, correlationId: "a" })).toBe(true);
    expect(limiter.tryAdmit({ ...base, correlationId: "b" })).toBe(true);
    expect(limiter.tryAdmit({ ...base, correlationId: "a" })).toBe(false);
  });

  it("LRU evicts the oldest key when the cap is exceeded", () => {
    const limiter = createBugReportRateLimiter({
      windowMs: 60_000,
      maxPerWindow: 1,
      lruCap: 2,
    });
    const make = (correlationId: string) => ({
      category: "wake_resume_failure",
      correlationId,
      sessionId: SESSION,
      toolName: null,
      protocolNamespace: null,
      redactedTitle: "x",
    });
    limiter.tryAdmit(make("a")); // size 1
    limiter.tryAdmit(make("b")); // size 2
    limiter.tryAdmit(make("c")); // size 2 after eviction (a dropped)
    expect(limiter.size()).toBe(2);
    // `a` was evicted, so its quota resets.
    expect(limiter.tryAdmit(make("a"))).toBe(true);
  });

  it("reset() empties the bucket and counters", () => {
    const limiter = createBugReportRateLimiter({ windowMs: 60_000, maxPerWindow: 1 });
    limiter.tryAdmit({
      category: "x",
      correlationId: null,
      sessionId: SESSION,
      toolName: null,
      protocolNamespace: null,
      redactedTitle: "t",
    });
    limiter.tryAdmit({
      category: "x",
      correlationId: null,
      sessionId: SESSION,
      toolName: null,
      protocolNamespace: null,
      redactedTitle: "t",
    });
    expect(limiter.droppedCount()).toBe(1);
    limiter.reset();
    expect(limiter.size()).toBe(0);
    expect(limiter.droppedCount()).toBe(0);
  });
});
