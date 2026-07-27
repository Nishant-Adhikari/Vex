import { describe, expect, it } from "vitest";
import { classifyRunLeaseState } from "../lease-state.js";

describe("classifyRunLeaseState", () => {
  it("returns 'live' for running + an active lease", () => {
    expect(classifyRunLeaseState("running", true)).toBe("live");
  });

  it("returns 'dead' for running + no active lease", () => {
    expect(classifyRunLeaseState("running", false)).toBe("dead");
  });

  it("returns 'not_running' for any non-running status regardless of lease state", () => {
    expect(classifyRunLeaseState("paused_user", true)).toBe("not_running");
    expect(classifyRunLeaseState("paused_error", false)).toBe("not_running");
    expect(classifyRunLeaseState("completed", true)).toBe("not_running");
    expect(classifyRunLeaseState(null, true)).toBe("not_running");
  });
});
