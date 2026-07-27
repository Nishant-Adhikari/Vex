/**
 * Express-lane predicate tests — the returning-user "loading → unlock" fast
 * path. Pure logic, no render. Guards two invariants:
 *   1. a returning user with a healthy machine auto-advances every setup step,
 *   2. a first-run user (or any unhealthy state) is NEVER auto-advanced.
 */

import { describe, expect, it } from "vitest";
import {
  resolveStartupRoute,
  shouldExpressAdvanceCompose,
  shouldExpressAdvanceDocker,
  shouldExpressAdvanceSystemCheck,
} from "../express-lane.js";

describe("resolveStartupRoute", () => {
  it("routes a returning (onboarded) user straight to the setup chain, skipping splash", () => {
    expect(resolveStartupRoute(true)).toEqual({
      returningUser: true,
      view: "systemCheck",
    });
  });

  it("leaves a first-run user on the splash (view null = keep default)", () => {
    expect(resolveStartupRoute(false)).toEqual({
      returningUser: false,
      view: null,
    });
  });
});

describe("shouldExpressAdvanceSystemCheck", () => {
  const healthy = {
    returningUser: true,
    anyLoading: false,
    osStatus: "ok",
    dockerStatus: "ok",
    envStatus: "ok",
  } as const;

  it("advances a returning user when os, docker and env are all ok", () => {
    expect(shouldExpressAdvanceSystemCheck(healthy)).toBe(true);
  });

  it("advances even when only the network is warning (offline is allowed)", () => {
    // network status is not a gating input — the predicate never sees it.
    expect(shouldExpressAdvanceSystemCheck({ ...healthy })).toBe(true);
  });

  it("never advances a first-run user, even when healthy", () => {
    expect(
      shouldExpressAdvanceSystemCheck({ ...healthy, returningUser: false }),
    ).toBe(false);
  });

  it("waits while any probe is still loading", () => {
    expect(
      shouldExpressAdvanceSystemCheck({ ...healthy, anyLoading: true }),
    ).toBe(false);
  });

  it("stays on the screen when Docker is not ok (down after reboot)", () => {
    expect(
      shouldExpressAdvanceSystemCheck({ ...healthy, dockerStatus: "fail" }),
    ).toBe(false);
    expect(
      shouldExpressAdvanceSystemCheck({ ...healthy, dockerStatus: "warn" }),
    ).toBe(false);
  });

  it("stays on the screen when the OS or env probe is unhealthy", () => {
    expect(
      shouldExpressAdvanceSystemCheck({ ...healthy, osStatus: "fail" }),
    ).toBe(false);
    expect(
      shouldExpressAdvanceSystemCheck({ ...healthy, envStatus: "warn" }),
    ).toBe(false);
  });
});

describe("shouldExpressAdvanceDocker", () => {
  it("advances a returning user from the ready branch (A)", () => {
    expect(shouldExpressAdvanceDocker(true, "A")).toBe(true);
  });

  it("does not advance from any non-ready branch", () => {
    for (const branch of ["loading", "B", "C-desktop", "C-linux", "D"] as const) {
      expect(shouldExpressAdvanceDocker(true, branch)).toBe(false);
    }
  });

  it("never advances a first-run user, even on the ready branch", () => {
    expect(shouldExpressAdvanceDocker(false, "A")).toBe(false);
  });
});

describe("shouldExpressAdvanceCompose", () => {
  it("advances a returning user once the stack is ready", () => {
    expect(shouldExpressAdvanceCompose(true, "ready")).toBe(true);
  });

  it("does not advance while running, cancelling, idle or errored", () => {
    for (const kind of [
      "idle",
      "running",
      "cancelling",
      "error.port_collision",
      "error.unhealthy",
      "error.failed",
      "error.cancelled",
    ] as const) {
      expect(shouldExpressAdvanceCompose(true, kind)).toBe(false);
    }
  });

  it("never advances a first-run user, even when ready", () => {
    expect(shouldExpressAdvanceCompose(false, "ready")).toBe(false);
  });
});
