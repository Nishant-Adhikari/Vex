/**
 * Unit tests for the orphaned-run reconciler repo primitives. Pool is mocked;
 * no DB. Scripted-client pattern matches `runtime-control-requests.test.ts`:
 * assert the SQL sent to the mocked pool + the params it carries.
 *
 * Covers:
 *   - `findOrphanedRunningRuns` — selects ONLY `status='running'` runs whose
 *     lease is missing/expired (LEFT JOIN on a LIVE lease + IS NULL), never a
 *     run with a still-valid lease, a paused_* run, or a terminal run.
 *   - `markStoppedIfRunning` — the guarded (`WHERE ... status='running'`)
 *     idempotent terminal flip: true when it flipped a row, false otherwise.
 */

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

let mockQuery: Mock<(sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>>;
let mockExecute: Mock<(sql: string, params?: unknown[]) => Promise<number>>;

vi.mock("@vex-agent/db/client.js", () => ({
  getPool: () => ({}),
  query: (sql: string, params?: unknown[]) => mockQuery(sql, params),
  execute: (sql: string, params?: unknown[]) => mockExecute(sql, params),
  queryOne: vi.fn().mockResolvedValue(null),
  queryOneWith: vi.fn().mockResolvedValue(null),
  executeWith: vi.fn(),
}));

vi.mock("@utils/logger.js", () => ({
  default: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const repo = await import("@vex-agent/db/repos/mission-runs.js");

function runRow(over: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: "run-1",
    mission_id: "mission-1",
    session_id: "sess-1",
    status: "running",
    started_at: new Date("2026-07-01T00:00:00.000Z"),
    ended_at: null,
    last_checkpoint_at: null,
    stop_reason: null,
    stop_summary: null,
    stop_evidence_json: null,
    iteration_count: 3,
    contract_snapshot_json: null,
    recovered_from_run_id: null,
    error_retry_count: 0,
    auto_retry_unsafe: false,
    ...over,
  };
}

describe("findOrphanedRunningRuns", () => {
  beforeEach(() => {
    mockQuery = vi.fn().mockResolvedValue([]);
    mockExecute = vi.fn().mockResolvedValue(0);
  });

  it("selects only running runs with a missing/expired lease", async () => {
    mockQuery.mockResolvedValue([runRow(), runRow({ id: "run-2", session_id: "sess-2" })]);

    const orphans = await repo.findOrphanedRunningRuns();

    expect(orphans).toHaveLength(2);
    expect(orphans[0]!.id).toBe("run-1");
    expect(orphans[0]!.status).toBe("running");

    const sql = mockQuery.mock.calls[0]![0] as string;
    // running only, not ended, and joined only to a LIVE lease then require it
    // to be absent — so a valid lease excludes the run.
    expect(sql).toMatch(/status\s*=\s*'running'/);
    expect(sql).toMatch(/ended_at\s+IS\s+NULL/i);
    expect(sql).toMatch(/expires_at\s*>\s*NOW\(\)/i);
    expect(sql).toMatch(/l\.session_id\s+IS\s+NULL/i);
  });

  it("returns [] when no orphans exist", async () => {
    mockQuery.mockResolvedValue([]);
    expect(await repo.findOrphanedRunningRuns()).toEqual([]);
  });
});

// RECONCILIATION B — the paused_error reaper (#70) and the OV2 self-heal
// recoverer (#73) must form a LADDER, never a race. #73 schedules its retry as a
// row in the SAME `loop_wake_requests` table (`status='pending'`, `mission_run_id`
// set, the `self_heal_retry` marker living inside the payload). The reaper's
// "no pending wake" exclusion is TRIGGER-AGNOSTIC — it defers on ANY pending wake
// for the run — so it already covers self_heal_retry wakes without a code change:
// while OV2 owns a run (a retry wake is pending) the run is NOT a reap candidate;
// once OV2 gives up (past deadline/cost or max attempts → it stops arming wakes)
// no pending wake remains and the run becomes reap-eligible. These tests pin that
// exclusion so a future narrowing of the join can't silently re-open the race.
describe("findAbandonedPausedErrorRuns — reaper↔self-heal ladder", () => {
  beforeEach(() => {
    mockQuery = vi.fn().mockResolvedValue([]);
    mockExecute = vi.fn().mockResolvedValue(0);
  });

  it("excludes any run with a PENDING wake (covers #73's self_heal_retry wake)", async () => {
    await repo.findAbandonedPausedErrorRuns(30);
    const sql = mockQuery.mock.calls[0]![0] as string;

    // Only abandoned paused_error runs, past the grace window, with no live lease.
    expect(sql).toMatch(/status\s*=\s*'paused_error'/i);
    expect(sql).toMatch(/ended_at\s+IS\s+NULL/i);
    expect(sql).toMatch(/l\.session_id\s+IS\s+NULL/i);
    // The pending-wake exclusion: LEFT JOIN loop_wake_requests on the RUN id +
    // status='pending', then require it ABSENT. A pending self_heal_retry wake
    // (mission_run_id set, status='pending') therefore makes the run a non-candidate.
    expect(sql).toMatch(/loop_wake_requests/i);
    expect(sql).toMatch(/w\.mission_run_id\s*=\s*m\.id/i);
    expect(sql).toMatch(/w\.status\s*=\s*'pending'/i);
    expect(sql).toMatch(/w\.id\s+IS\s+NULL/i);
    // TRIGGER-AGNOSTIC: the wake join must NOT be narrowed to a specific
    // trigger/reason, or a self_heal_retry wake would slip past the exclusion and
    // the reaper could reap a run OV2 still owns (the race this ladder forbids).
    expect(sql).not.toMatch(/self_heal/i);
    expect(sql).not.toMatch(/trigger/i);
  });

  it("returns the run only when the query yields it (no pending wake, past grace)", async () => {
    // The DB applies the exclusion; the repo faithfully surfaces whatever the
    // ladder-aware query returns. A run OV2 has given up on (no pending wake) is
    // the one the query yields → the reaper finalizes it.
    mockQuery.mockResolvedValue([
      runRow({ id: "reap-me", status: "paused_error", session_id: "sess-9" }),
    ]);
    const abandoned = await repo.findAbandonedPausedErrorRuns(30);
    expect(abandoned).toHaveLength(1);
    expect(abandoned[0]!.id).toBe("reap-me");
    // Grace window carried as the sole positional param.
    expect(mockQuery.mock.calls[0]![1]).toEqual([30]);
  });
});

describe("markStoppedIfRunning", () => {
  beforeEach(() => {
    mockQuery = vi.fn().mockResolvedValue([]);
    mockExecute = vi.fn().mockResolvedValue(0);
  });

  it("returns true and stamps stopped + stop_reason + ended_at when a row flips", async () => {
    mockExecute.mockResolvedValue(1);

    const claimed = await repo.markStoppedIfRunning("run-1", "runner_lost", {
      summary: "interrupted",
    });

    expect(claimed).toBe(true);
    const [sql, params] = mockExecute.mock.calls[0]!;
    expect(sql).toMatch(/status\s*=\s*'stopped'/);
    expect(sql).toMatch(/stop_reason\s*=\s*\$2/);
    expect(sql).toMatch(/ended_at\s*=\s*NOW\(\)/i);
    // Guard 1: only flips a still-running row.
    expect(sql).toMatch(/m\.status\s*=\s*'running'/i);
    // Guard 2 (race-safe): refuses to flip when a LIVE lease exists — closes the
    // resume race (an operator Resume acquires a fresh lease + keeps running).
    expect(sql).toMatch(/NOT\s+EXISTS/i);
    expect(sql).toMatch(/runner_leases/i);
    expect(sql).toMatch(/expires_at\s*>\s*NOW\(\)/i);
    expect(params).toEqual(["run-1", "runner_lost", "interrupted", null]);
  });

  it("returns false when no eligible row matched (terminal or live-leased)", async () => {
    mockExecute.mockResolvedValue(0);
    expect(await repo.markStoppedIfRunning("run-1", "runner_lost")).toBe(false);
  });
});
