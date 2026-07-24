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
