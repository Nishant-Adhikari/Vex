/**
 * Overnight self-heal — deadline bound (the hard stop on recovery).
 */
import { describe, it, expect } from "vitest";
import {
  withinDeadline,
  withinCostCap,
  withinRecoveryBounds,
  runDeadlineMs,
} from "@vex-agent/engine/self-heal/bounds.js";

const START = "2026-07-25T00:00:00.000Z";
const startMs = Date.parse(START);

const snap = (durationMinutes: number) => ({
  frozenMission: { constraintsJson: { durationMinutes } },
});

// Contract snapshot carrying BOTH the box duration and a frozen per-mission
// dollar cost cap (the cap lives on `frozenMission.draft.costCapUsd`, the same
// place the turn-loop enforcer reads via `frozenCostCapUsd`).
const snapWithCap = (durationMinutes: number, costCapUsd: number) => ({
  frozenMission: { constraintsJson: { durationMinutes }, draft: { costCapUsd } },
});

// A cost cap set via env is what fails-soft to $1 when unset; pin it explicitly
// so these tests don't depend on the ambient default.
const ENV_CAP = (usd: string) => ({ AGENT_MISSION_COST_CAP_USD: usd });

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
  // Zero-spend reader → the cost gate is transparent, so withinRecoveryBounds
  // reduces to the deadline for these deadline-focused cases.
  const zeroCost = async () => 0;
  const bounds = (nowMs: number) =>
    withinRecoveryBounds(run, nowMs, "s1", { costReader: zeroCost, env: {} });

  it("true before the deadline", async () => {
    expect(withinDeadline(run, startMs + 59 * 60_000, {})).toBe(true);
    expect(await bounds(startMs + 59 * 60_000)).toBe(true);
  });
  it("false at/after the deadline (recovery ceases)", async () => {
    expect(withinDeadline(run, startMs + 60 * 60_000, {})).toBe(false);
    expect(withinDeadline(run, startMs + 120 * 60_000, {})).toBe(false);
    expect(await bounds(startMs + 120 * 60_000)).toBe(false);
  });
  it("fail-open on an unparseable start", () => {
    expect(
      withinDeadline({ startedAt: "nope", contractSnapshotJson: null }, Date.now(), {}),
    ).toBe(true);
  });
});

// RECONCILIATION A — the cost cap is now a live recovery bound, wired to the
// SAME machinery the turn-loop enforces (`resolveMissionCostCap` over the frozen
// `costCapUsd`, `getSessionTotalCost` since `started_at`, `spent >= cap` stops).
describe("withinCostCap / withinRecoveryBounds — cost bound", () => {
  const run = { startedAt: START, contractSnapshotJson: snapWithCap(60, 1) }; // $1 cap
  const inDeadline = startMs + 10 * 60_000;

  it("true while run-scoped spend is UNDER the cap", async () => {
    expect(await withinCostCap(run, "s1", { costReader: async () => 0.5, env: {} })).toBe(true);
  });
  it("false the instant spend is AT/OVER the cap (recovery ceases)", async () => {
    expect(await withinCostCap(run, "s1", { costReader: async () => 1, env: {} })).toBe(false);
    expect(await withinCostCap(run, "s1", { costReader: async () => 1.5, env: {} })).toBe(false);
  });
  it("scopes the read to the run's started_at (missionTokenSince parity)", async () => {
    let seen: { since?: string | null } | undefined;
    await withinCostCap(run, "s1", {
      costReader: async (_s, opts) => {
        seen = opts;
        return 0;
      },
      env: {},
    });
    expect(seen).toEqual({ since: START });
  });
  it("no cap (global disable sentinel) → unbounded, reader never consulted", async () => {
    let called = false;
    const r = await withinCostCap(run, "s1", {
      costReader: async () => {
        called = true;
        return 999;
      },
      env: { AGENT_MISSION_COST_CAP_USD: "off" },
    });
    expect(r).toBe(true);
    expect(called).toBe(false);
  });
  it("fail-OPEN on a cost-read error (the live enforcer re-checks next turn)", async () => {
    expect(
      await withinCostCap(run, "s1", {
        costReader: async () => {
          throw new Error("accumulator read failed");
        },
        env: {},
      }),
    ).toBe(true);
  });
  it("withinRecoveryBounds is false when over the cap even INSIDE the deadline", async () => {
    expect(
      await withinRecoveryBounds(run, inDeadline, "s1", {
        costReader: async () => 2,
        env: ENV_CAP("1"),
      }),
    ).toBe(false);
  });
  it("withinRecoveryBounds skips the cost read once PAST the deadline (deadline first)", async () => {
    let called = false;
    const r = await withinRecoveryBounds(run, startMs + 120 * 60_000, "s1", {
      costReader: async () => {
        called = true;
        return 0;
      },
      env: ENV_CAP("1"),
    });
    expect(r).toBe(false);
    expect(called).toBe(false);
  });
});
