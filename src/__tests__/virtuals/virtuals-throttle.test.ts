import { describe, expect, it, vi } from "vitest";
import { VirtualsThrottle, parseRetryAfterMs } from "@tools/virtuals/throttle.js";

/** Deterministic clock: `now` is manual; `sleep` advances it (no real timers). */
function makeClock(start = 0) {
  let t = start;
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += Math.max(0, ms);
    },
    advance: (ms: number) => {
      t += ms;
    },
  };
}

describe("VirtualsThrottle", () => {
  it("serves a fresh cache hit without calling the fetcher again", async () => {
    const clock = makeClock();
    const throttle = new VirtualsThrottle({ ttlMs: 1000, deps: clock });
    const fetcher = vi.fn().mockResolvedValue("v1");

    expect(await throttle.run("k", 1000, fetcher)).toBe("v1");
    clock.advance(500); // still fresh
    expect(await throttle.run("k", 1000, fetcher)).toBe("v1");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("re-fetches after the TTL expires", async () => {
    const clock = makeClock();
    const throttle = new VirtualsThrottle({ ttlMs: 1000, deps: clock });
    const fetcher = vi.fn().mockResolvedValueOnce("v1").mockResolvedValueOnce("v2");

    expect(await throttle.run("k", 1000, fetcher)).toBe("v1");
    clock.advance(1001);
    expect(await throttle.run("k", 1000, fetcher)).toBe("v2");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("dedupes concurrent identical requests into one fetch", async () => {
    const clock = makeClock();
    const throttle = new VirtualsThrottle({ ttlMs: 1000, deps: clock });
    let resolveFetch!: (v: string) => void;
    const fetcher = vi.fn().mockReturnValue(new Promise<string>((r) => (resolveFetch = r)));

    const p1 = throttle.run("k", 1000, fetcher);
    const p2 = throttle.run("k", 1000, fetcher);
    resolveFetch("shared");
    expect(await p1).toBe("shared");
    expect(await p2).toBe("shared");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("does not cache a rejected fetch", async () => {
    const clock = makeClock();
    const throttle = new VirtualsThrottle({ ttlMs: 1000, deps: clock });
    const fetcher = vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce("ok");

    await expect(throttle.run("k", 1000, fetcher)).rejects.toThrow("boom");
    expect(await throttle.run("k", 1000, fetcher)).toBe("ok");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("penalize parks the bucket so the next acquire waits", async () => {
    const clock = makeClock();
    const sleepSpy = vi.spyOn(clock, "sleep");
    const throttle = new VirtualsThrottle({ ttlMs: 1000, deps: clock });
    throttle.penalize(5000);
    await throttle.run("k", 1000, vi.fn().mockResolvedValue("v"));
    // The penalty forced at least one sleep before the fetch could fire.
    expect(sleepSpy).toHaveBeenCalled();
  });
});

describe("parseRetryAfterMs", () => {
  it("parses delta-seconds", () => {
    expect(parseRetryAfterMs("3")).toBe(3000);
  });
  it("caps at 60s", () => {
    expect(parseRetryAfterMs("120")).toBe(60000);
  });
  it("falls back when absent", () => {
    expect(parseRetryAfterMs(null)).toBe(5000);
    expect(parseRetryAfterMs(undefined)).toBe(5000);
  });
});
