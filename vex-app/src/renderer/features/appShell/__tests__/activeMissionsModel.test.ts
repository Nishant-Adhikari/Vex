/**
 * Active-missions classification — pure model. The load-bearing invariant:
 * a ledger row stuck at `outcome='running'` is only ever shown as LIVE when
 * runtime confirms an active run for its session; runtime confirming NO active
 * run flips it to `stale_orphaned` ("needs cleanup"), and an UNRESOLVED runtime
 * read never flashes orphaned (it stays running/unverified).
 */

import { describe, it, expect } from "vitest";
import type { MissionResultDto } from "@shared/schemas/mission.js";
import type { MissionRunStatus } from "@shared/schemas/sessions.js";
import {
  classifyActiveMissions,
  type ActiveMissionRuntime,
} from "../activeMissionsModel.js";

function row(over: Partial<MissionResultDto> = {}): MissionResultDto {
  return {
    missionRunId: "run-1",
    sessionId: "sess-1",
    seqNo: 1,
    goalSnippet: "grow ETH",
    startedAt: "2026-07-20T18:00:00.000Z",
    endedAt: null,
    durationS: null,
    bankrollStartEth: 0.01,
    bankrollEndEth: null,
    pnlEth: null,
    pnlPct: null,
    ethPriceUsdEnd: null,
    trades: 0,
    outcome: "running",
    stopReason: null,
    summary: null,
    openPositionsCount: 0,
    ...over,
  };
}

function runtime(
  hasActiveRun: boolean,
  status: MissionRunStatus | null = hasActiveRun ? "running" : null,
  // A live run defaults to a live lease; paused runs release the lease.
  leaseActive: boolean = hasActiveRun && status === "running",
): ActiveMissionRuntime {
  return { hasActiveRun, status, leaseActive };
}

describe("classifyActiveMissions", () => {
  it("keeps only rows whose outcome is 'running'", () => {
    const ledger = [
      row({ missionRunId: "a", sessionId: "s-a", outcome: "running" }),
      row({ missionRunId: "b", sessionId: "s-b", outcome: "completed" }),
      row({ missionRunId: "c", sessionId: "s-c", outcome: "failed" }),
    ];
    const rt = new Map([["s-a", runtime(true)]]);
    const out = classifyActiveMissions(ledger, rt);
    expect(out.map((m) => m.missionRunId)).toEqual(["a"]);
  });

  it("marks a live run (runtime hasActiveRun) as running", () => {
    const out = classifyActiveMissions(
      [row({ sessionId: "s-a" })],
      new Map([["s-a", runtime(true, "running")]]),
    );
    expect(out[0]?.status).toBe("running");
  });

  it("marks an orphaned ledger row (runtime resolved, no active run) as stale_orphaned", () => {
    const out = classifyActiveMissions(
      [row({ sessionId: "s-a" })],
      new Map([["s-a", runtime(false)]]),
    );
    expect(out[0]?.status).toBe("stale_orphaned");
  });

  it("flags a running row with a DEAD lease (crashed runner) as stale_orphaned", () => {
    // hasActiveRun stays true because mission_runs.status is still 'running',
    // but the runner lease expired — the killed-run orphan case.
    const out = classifyActiveMissions(
      [row({ sessionId: "s-a" })],
      new Map([["s-a", runtime(true, "running", /* leaseActive */ false)]]),
    );
    expect(out[0]?.status).toBe("stale_orphaned");
  });

  it("keeps a running row with a LIVE lease as running", () => {
    const out = classifyActiveMissions(
      [row({ sessionId: "s-a" })],
      new Map([["s-a", runtime(true, "running", /* leaseActive */ true)]]),
    );
    expect(out[0]?.status).toBe("running");
  });

  it("classifies a paused run as paused even though it holds no lease", () => {
    const out = classifyActiveMissions(
      [row({ sessionId: "s-a" })],
      new Map([["s-a", runtime(true, "paused_wake", /* leaseActive */ false)]]),
    );
    expect(out[0]?.status).toBe("paused");
  });

  it("never flashes orphaned before runtime resolves — an absent runtime stays running", () => {
    // s-a has no entry in the runtime map (still loading / transport error).
    const out = classifyActiveMissions([row({ sessionId: "s-a" })], new Map());
    expect(out[0]?.status).toBe("running");
  });

  it("maps every paused_* live status to 'paused'", () => {
    const paused: MissionRunStatus[] = [
      "paused_approval",
      "paused_wake",
      "paused_error",
      "paused_user",
      "paused_plan_acceptance",
    ];
    for (const status of paused) {
      const out = classifyActiveMissions(
        [row({ sessionId: "s-a" })],
        new Map([["s-a", runtime(true, status)]]),
      );
      expect(out[0]?.status).toBe("paused");
    }
  });

  it("orders stale-orphaned first, then paused, then running; newest seqNo within a band", () => {
    const ledger = [
      row({ missionRunId: "run-live", sessionId: "s-live", seqNo: 10 }),
      row({ missionRunId: "run-orphan", sessionId: "s-orphan", seqNo: 18 }),
      row({ missionRunId: "run-paused", sessionId: "s-paused", seqNo: 12 }),
      row({ missionRunId: "run-live2", sessionId: "s-live2", seqNo: 20 }),
    ];
    const rt = new Map<string, ActiveMissionRuntime>([
      ["s-live", runtime(true, "running")],
      ["s-orphan", runtime(false)],
      ["s-paused", runtime(true, "paused_wake")],
      ["s-live2", runtime(true, "running")],
    ]);
    const out = classifyActiveMissions(ledger, rt);
    expect(out.map((m) => m.status)).toEqual([
      "stale_orphaned",
      "paused",
      "running",
      "running",
    ]);
    // Within the running band, seq 20 precedes seq 10 (newest first).
    expect(out.map((m) => m.seqNo)).toEqual([18, 12, 20, 10]);
  });

  it("labels by session title, falling back to goal snippet, then '#seq'", () => {
    const ledger = [
      row({ missionRunId: "a", sessionId: "s-a", seqNo: 1, goalSnippet: "goal A" }),
      row({ missionRunId: "b", sessionId: "s-b", seqNo: 2, goalSnippet: "goal B" }),
      row({ missionRunId: "c", sessionId: "s-c", seqNo: 3, goalSnippet: null }),
    ];
    const rt = new Map<string, ActiveMissionRuntime>([
      ["s-a", runtime(true)],
      ["s-b", runtime(true)],
      ["s-c", runtime(true)],
    ]);
    const labels = new Map<string, string | null>([
      ["s-a", "My Titled Session"],
      ["s-b", null], // no title → falls back to goal snippet
      // s-c absent AND null goal → falls back to "#3"
    ]);
    const out = classifyActiveMissions(ledger, rt, labels);
    const byId = Object.fromEntries(out.map((m) => [m.missionRunId, m.label]));
    expect(byId.a).toBe("My Titled Session");
    expect(byId.b).toBe("goal B");
    expect(byId.c).toBe("Mission #3");
  });

  it("passes PnL + open-position count straight through", () => {
    const out = classifyActiveMissions(
      [row({ sessionId: "s-a", pnlEth: -0.004, pnlPct: -12, openPositionsCount: 2 })],
      new Map([["s-a", runtime(true)]]),
    );
    expect(out[0]).toMatchObject({ pnlEth: -0.004, pnlPct: -12, openPositionsCount: 2 });
  });
});
