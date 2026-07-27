import { describe, expect, it } from "vitest";
import {
  runWithMissionMode,
  getActiveMissionMode,
  isSimulatedBroadcastContext,
  assertBroadcastAllowed,
  resolveActiveMissionMode,
} from "../../lib/mission-mode.js";

describe("resolveActiveMissionMode (frozen per run)", () => {
  it("the active run's mode always wins over the session intent", () => {
    // A live session that somehow spawned a simulator run stays simulator.
    expect(resolveActiveMissionMode("simulator", "live")).toBe("simulator");
    // A simulator session whose run froze live stays live.
    expect(resolveActiveMissionMode("live", "simulator")).toBe("live");
  });

  it("falls back to the session intent only before a run exists", () => {
    expect(resolveActiveMissionMode(undefined, "simulator")).toBe("simulator");
    expect(resolveActiveMissionMode(null, "live")).toBe("live");
  });

  it("defaults to live when nothing is known", () => {
    expect(resolveActiveMissionMode(undefined, undefined)).toBe("live");
  });
});

describe("mission-mode broadcast guard (layer B)", () => {
  it("no active store → NOT simulated (a plain agent/manual swap is live)", () => {
    expect(getActiveMissionMode()).toBeUndefined();
    expect(isSimulatedBroadcastContext()).toBe(false);
    expect(() => assertBroadcastAllowed("x")).not.toThrow();
  });

  it("live run → allowed", () => {
    runWithMissionMode("live", () => {
      expect(getActiveMissionMode()).toBe("live");
      expect(isSimulatedBroadcastContext()).toBe(false);
      expect(() => assertBroadcastAllowed("x")).not.toThrow();
    });
  });

  it("simulator run → simulated, assert THROWS (no broadcast)", () => {
    runWithMissionMode("simulator", () => {
      expect(isSimulatedBroadcastContext()).toBe(true);
      expect(() => assertBroadcastAllowed("Uniswap swap broadcast")).toThrow(/SIMULATOR/);
    });
  });

  it("fail-closed: any non-'live' value in an active store is treated as simulated", () => {
    // Force a malformed mode through the typed boundary.
    runWithMissionMode("weird" as unknown as "live", () => {
      expect(isSimulatedBroadcastContext()).toBe(true);
      expect(() => assertBroadcastAllowed("x")).toThrow();
    });
  });

  it("the mode is frozen for the whole async subtree (immutable per run)", async () => {
    await runWithMissionMode("simulator", async () => {
      await Promise.resolve();
      await new Promise((r) => setTimeout(r, 1));
      // Still simulator after awaits — the run's mode cannot drift mid-run.
      expect(getActiveMissionMode()).toBe("simulator");
      expect(isSimulatedBroadcastContext()).toBe(true);
    });
    // And it does not leak outside the subtree.
    expect(getActiveMissionMode()).toBeUndefined();
  });

  it("nested contexts do not corrupt the outer mode", () => {
    runWithMissionMode("live", () => {
      runWithMissionMode("simulator", () => {
        expect(getActiveMissionMode()).toBe("simulator");
      });
      expect(getActiveMissionMode()).toBe("live");
    });
  });
});
