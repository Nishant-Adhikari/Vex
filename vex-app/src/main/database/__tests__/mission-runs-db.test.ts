/**
 * mission-runs-db tests — empty + active row mapping + defensive status.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type QueryFn = (
  text: string,
  params?: readonly unknown[],
) => Promise<{ rows: ReadonlyArray<Record<string, unknown>> }>;

const mocks = vi.hoisted(() => ({
  query: vi.fn() as QueryFn,
  connect: vi.fn(),
  end: vi.fn(),
  buildPoolConfig: vi.fn(),
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("pg", () => {
  function MockClient() {
    return {
      connect: mocks.connect,
      end: mocks.end,
      query: mocks.query,
    };
  }
  return { Client: MockClient };
});

vi.mock("../db-config.js", () => ({
  buildPoolConfig: mocks.buildPoolConfig,
}));

vi.mock("../../logger/index.js", () => ({ log: mocks.log }));

const { getActiveRunForSession, getLatestRunForSession } = await import(
  "../mission-runs-db.js"
);

const SESSION = "00000000-0000-4000-8000-00000000eeee";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.buildPoolConfig.mockResolvedValue({
    host: "127.0.0.1",
    port: 5777,
    database: "vex",
    user: "vex",
    password: "secret",
  });
  mocks.connect.mockResolvedValue(undefined);
  mocks.end.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("mission-runs-db mapper", () => {
  it("returns inactive shape when session has no active/paused mission run", async () => {
    // Puzzle 03 — getActiveRunForSession does TWO queries when no row
    // matches: (1) joined active-run lookup returns empty, (2) fallback
    // query pulls session-only lease + pending control kind.
    mocks.query.mockResolvedValueOnce({ rows: [] });
    mocks.query.mockResolvedValueOnce({
      rows: [{
        lease_active: false,
        lease_expires_at: null,
        pending_control_kind: null,
      }],
    });
    const result = await getActiveRunForSession(SESSION);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toEqual({
      sessionId: SESSION,
      hasActiveRun: false,
      missionRunId: null,
      status: null,
      stopReason: null,
      lastCheckpointAt: null,
      startedAt: null,
      // Run-scoped observability facts are all null with no active run.
      deadlineAt: null,
      durationMinutes: null,
      tokenBudget: null,
      runTokensUsed: null,
      runCostUsd: null,
      iterationCount: null,
      leaseActive: false,
      leaseExpiresAt: null,
      pendingControlKind: null,
    });
  });

  it("maps an active mission run row with lease and pending-control fields", async () => {
    mocks.query.mockResolvedValueOnce({
      rows: [
        {
          id: "run-1",
          session_id: SESSION,
          status: "running",
          started_at: "2026-05-21T09:00:00.000Z",
          last_checkpoint_at: "2026-05-21T10:00:00.000Z",
          stop_reason: null,
          iteration_count: "12",
          lease_active: true,
          lease_expires_at: new Date("2026-05-21T10:05:00.000Z"),
          pending_control_kind: null,
        },
      ],
    });
    const result = await getActiveRunForSession(SESSION);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.hasActiveRun).toBe(true);
    expect(result.data.missionRunId).toBe("run-1");
    expect(result.data.status).toBe("running");
    expect(result.data.iterationCount).toBe(12);
    expect(result.data.leaseActive).toBe(true);
    expect(result.data.leaseExpiresAt).toBe("2026-05-21T10:05:00.000Z");
    expect(result.data.pendingControlKind).toBeNull();
  });

  it("accepts paused_user as a valid active status", async () => {
    mocks.query.mockResolvedValueOnce({
      rows: [
        {
          id: "run-2",
          session_id: SESSION,
          status: "paused_user",
          started_at: "2026-05-21T09:00:00.000Z",
          last_checkpoint_at: null,
          stop_reason: "user_paused",
          iteration_count: 0,
          lease_active: false,
          lease_expires_at: null,
          pending_control_kind: null,
        },
      ],
    });
    const result = await getActiveRunForSession(SESSION);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.status).toBe("paused_user");
    expect(result.data.hasActiveRun).toBe(true);
    expect(result.data.missionRunId).toBe("run-2");
    expect(result.data.stopReason).toBe("user_paused");
  });

  it("derives deadline/duration/budget from the frozen snapshot and sums run-scoped usage", async () => {
    // `vi.mocked` re-types the hoisted `QueryFn`-cast mock so the vitest Mock
    // API is visible (same pattern the getLatestRunForSession suite uses).
    const q = vi.mocked(mocks.query);
    const started = "2026-05-21T09:00:00.000Z";
    // Active run row carrying a frozen 30-minute contract snapshot.
    q.mockResolvedValueOnce({
      rows: [
        {
          id: "run-9",
          session_id: SESSION,
          status: "running",
          started_at: started,
          last_checkpoint_at: null,
          stop_reason: null,
          iteration_count: 3,
          contract_snapshot_json: {
            frozenMission: { draft: { durationMinutes: 30 } },
          },
          lease_active: true,
          lease_expires_at: null,
          pending_control_kind: null,
        },
      ],
    });
    // The run-scoped usage sum (SUM(total_tokens), SUM(cost) since started_at).
    q.mockResolvedValueOnce({
      rows: [{ tokens: "100000", cost: "0.5" }],
    });

    const result = await getActiveRunForSession(SESSION);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Duration is the frozen 30 minutes; deadline = started_at + 30 min.
    expect(result.data.durationMinutes).toBe(30);
    expect(result.data.deadlineAt).toBe("2026-05-21T09:30:00.000Z");
    // Budget is the enforced denominator (durationMinutes × per-minute burn) —
    // a positive integer derived from the SAME frozen duration.
    expect(result.data.tokenBudget).not.toBeNull();
    expect(result.data.tokenBudget).toBeGreaterThan(0);
    // Run-scoped usage flows through from the since-query.
    expect(result.data.runTokensUsed).toBe(100000);
    expect(result.data.runCostUsd).toBe(0.5);

    // The usage sum is BOUNDED to the run's started_at (so a prior run's rows
    // in the same session are excluded) — the run-scoping mechanism.
    const usageCall = q.mock.calls[1];
    expect(String(usageCall?.[0])).toMatch(/created_at >= \$2/);
    expect(usageCall?.[1]).toEqual([SESSION, started]);
  });

  it("fails soft to null run-usage (keeps deadline/budget) when the usage sum errors", async () => {
    const q = vi.mocked(mocks.query);
    q.mockResolvedValueOnce({
      rows: [
        {
          id: "run-10",
          session_id: SESSION,
          status: "running",
          started_at: "2026-05-21T09:00:00.000Z",
          last_checkpoint_at: null,
          stop_reason: null,
          iteration_count: 0,
          contract_snapshot_json: null,
          lease_active: true,
          lease_expires_at: null,
          pending_control_kind: null,
        },
      ],
    });
    q.mockRejectedValueOnce(new Error("usage read boom"));

    const result = await getActiveRunForSession(SESSION);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // A failed usage read never blocks the DTO — tokens/cost degrade to null…
    expect(result.data.runTokensUsed).toBeNull();
    expect(result.data.runCostUsd).toBeNull();
    // …while the deadline + duration (env/default-fallback when the snapshot
    // has no duration) still resolve, never blocking the DTO.
    expect(result.data.durationMinutes).not.toBeNull();
    expect(result.data.durationMinutes).toBeGreaterThan(0);
    expect(result.data.deadlineAt).not.toBeNull();
    expect(result.data.hasActiveRun).toBe(true);
  });

  it("dbUnavailable maps to internal.unexpected with domain=runtime", async () => {
    mocks.buildPoolConfig.mockReset();
    mocks.buildPoolConfig.mockResolvedValueOnce(null);
    const result = await getActiveRunForSession(SESSION);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("internal.unexpected");
    expect(result.error.domain).toBe("runtime");
  });
});

describe("getLatestRunForSession — lease-active mapping (WP-C)", () => {
  // `vi.mocked` re-types the hoisted `QueryFn`-cast mock so the vitest Mock
  // API (`mockResolvedValueOnce`) is visible without re-triggering the
  // file's pre-existing `QueryFn`-cast type-baseline pattern.
  const q = vi.mocked(mocks.query);

  it("returns null when the session never had a run", async () => {
    q.mockResolvedValueOnce({ rows: [] });
    const result = await getLatestRunForSession(SESSION);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toBeNull();
  });

  it("maps lease_active=true through for a running row with a live lease", async () => {
    q.mockResolvedValueOnce({
      rows: [{ id: "run-1", status: "running", lease_active: true }],
    });
    const result = await getLatestRunForSession(SESSION);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toEqual({
      missionRunId: "run-1",
      status: "running",
      leaseActive: true,
    });
  });

  it("maps a NULL lease join (no runner_leases row) to leaseActive=false", async () => {
    q.mockResolvedValueOnce({
      rows: [{ id: "run-1", status: "running", lease_active: null }],
    });
    const result = await getLatestRunForSession(SESSION);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data?.leaseActive).toBe(false);
  });

  it("rejects an unrecognized status defensively", async () => {
    q.mockResolvedValueOnce({
      rows: [{ id: "run-1", status: "not_a_real_status", lease_active: false }],
    });
    const result = await getLatestRunForSession(SESSION);
    expect(result.ok).toBe(false);
  });
});
