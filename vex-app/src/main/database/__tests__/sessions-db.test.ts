/**
 * Direct branching tests for `softDeleteSessionWithClient` — the outcome
 * classification is the riskiest part of the soft-delete contract and
 * lives entirely inside main, so it gets a focused unit test that does
 * not require a live Postgres.
 *
 * The helper accepts a `pg.Client`; the tests pass a fake whose `.query`
 * returns pre-scripted results in call order. The atomic UPDATE always
 * runs first; subsequent queries (existence check, deleted_at probe,
 * mission_run probe, approval_queue probe) run only when the UPDATE
 * returned 0 rows.
 */

import { describe, expect, it, vi } from "vitest";
import type { Client } from "pg";

vi.mock("../../logger/index.js", () => ({
  log: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    verbose: vi.fn(),
    silly: vi.fn(),
  },
}));

vi.mock("../db-config.js", () => ({
  buildPoolConfig: async () => null,
}));

const TEST_ID = "00000000-0000-4000-8000-000000000001";

interface ScriptedQueryResult {
  readonly rows: ReadonlyArray<Record<string, unknown>>;
  readonly rowCount: number;
}

function scriptedClient(results: ReadonlyArray<ScriptedQueryResult>): {
  client: Client;
  queryMock: ReturnType<typeof vi.fn>;
} {
  let call = 0;
  const queryMock = vi.fn(async () => {
    const r = results[call++];
    if (r === undefined) {
      throw new Error(`unexpected query call ${call}`);
    }
    return r;
  });
  const client = { query: queryMock } as unknown as Client;
  return { client, queryMock };
}

describe("softDeleteSessionWithClient outcome branching", () => {
  it("returns 'removed' when the atomic UPDATE affects a row", async () => {
    const mod = await import("../sessions-db.js");
    const { client } = scriptedClient([
      { rows: [{ id: TEST_ID }], rowCount: 1 },
    ]);
    const result = await mod.softDeleteSessionWithClient(client, TEST_ID);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.outcome).toBe("removed");
  });

  it("returns 'not_found' when the existence probe returns no row", async () => {
    const mod = await import("../sessions-db.js");
    const { client } = scriptedClient([
      { rows: [], rowCount: 0 }, // atomic UPDATE: 0 rows
      { rows: [], rowCount: 0 }, // SELECT deleted_at: missing
    ]);
    const result = await mod.softDeleteSessionWithClient(client, TEST_ID);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.outcome).toBe("not_found");
  });

  it("returns 'already_removed' when deleted_at is already set", async () => {
    const mod = await import("../sessions-db.js");
    const { client } = scriptedClient([
      { rows: [], rowCount: 0 },
      { rows: [{ deleted_at: new Date() }], rowCount: 1 },
    ]);
    const result = await mod.softDeleteSessionWithClient(client, TEST_ID);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.outcome).toBe("already_removed");
  });

  it("returns 'blocked_active_mission' when an active mission_run exists", async () => {
    const mod = await import("../sessions-db.js");
    const { client } = scriptedClient([
      { rows: [], rowCount: 0 },
      { rows: [{ deleted_at: null }], rowCount: 1 },
      { rows: [{ "?column?": 1 }], rowCount: 1 }, // mission_run probe hit
    ]);
    const result = await mod.softDeleteSessionWithClient(client, TEST_ID);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.outcome).toBe("blocked_active_mission");
  });

  it("returns 'blocked_pending_approval' when approval_queue has a pending row", async () => {
    const mod = await import("../sessions-db.js");
    const { client } = scriptedClient([
      { rows: [], rowCount: 0 },
      { rows: [{ deleted_at: null }], rowCount: 1 },
      { rows: [], rowCount: 0 }, // no active mission
      { rows: [{ "?column?": 1 }], rowCount: 1 }, // pending approval hit
    ]);
    const result = await mod.softDeleteSessionWithClient(client, TEST_ID);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.outcome).toBe("blocked_pending_approval");
  });

  it("returns 'state_changed' when classification finds no blockers (race-loser tail)", async () => {
    const mod = await import("../sessions-db.js");
    const { client } = scriptedClient([
      { rows: [], rowCount: 0 },
      { rows: [{ deleted_at: null }], rowCount: 1 },
      { rows: [], rowCount: 0 },
      { rows: [], rowCount: 0 }, // no pending approval — race-loser
    ]);
    const result = await mod.softDeleteSessionWithClient(client, TEST_ID);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.outcome).toBe("state_changed");
  });

  it("first SQL is the atomic guarded UPDATE with both NOT EXISTS clauses + RETURNING", async () => {
    const mod = await import("../sessions-db.js");
    const { client, queryMock } = scriptedClient([
      { rows: [{ id: TEST_ID }], rowCount: 1 },
    ]);
    await mod.softDeleteSessionWithClient(client, TEST_ID);
    const firstCall = queryMock.mock.calls[0];
    expect(firstCall).toBeDefined();
    const sql = firstCall![0] as string;
    expect(sql).toMatch(/^\s*UPDATE sessions/);
    expect(sql).toMatch(/SET\s+deleted_at\s*=\s*NOW\(\)/);
    expect(sql).toMatch(/AND\s+NOT\s+EXISTS\s*\(\s*SELECT 1 FROM mission_runs/);
    expect(sql).toMatch(/AND\s+NOT\s+EXISTS\s*\(\s*SELECT 1 FROM approval_queue/);
    expect(sql).toMatch(/RETURNING id/);
  });
});

describe("setSessionPinnedWithClient — soft-delete invariant", () => {
  it("returns ok(null) when the row is soft-deleted (UPDATE 0 rows)", async () => {
    const mod = await import("../sessions-db.js");
    // Soft-deleted rows fail the `AND deleted_at IS NULL` filter, so the
    // UPDATE affects 0 rows. The helper must return ok(null) instead of
    // happily echoing a stale `SessionListItem` back into the cache.
    const { client } = scriptedClient([{ rows: [], rowCount: 0 }]);
    const result = await mod.setSessionPinnedWithClient(client, TEST_ID, true);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toBeNull();
  });

  it("WHERE clause filters deleted_at IS NULL (regression guard)", async () => {
    const mod = await import("../sessions-db.js");
    const { client, queryMock } = scriptedClient([{ rows: [], rowCount: 0 }]);
    await mod.setSessionPinnedWithClient(client, TEST_ID, true);
    const sql = queryMock.mock.calls[0]![0] as string;
    expect(sql).toMatch(/UPDATE sessions/);
    expect(sql).toMatch(/AND\s+deleted_at\s+IS\s+NULL/);
  });

  it("returns a live SessionListItem with missionStatus for an active mission row", async () => {
    const mod = await import("../sessions-db.js");
    const { client } = scriptedClient([
      {
        rows: [
          {
            id: TEST_ID,
            mode: "mission",
            permission: "restricted",
            initial_goal: "Live mission",
            started_at: new Date(),
            ended_at: null,
            title: "Pinned mission",
            pinned_at: new Date(),
          },
        ],
        rowCount: 1,
      },
      { rows: [{ status: "running" }], rowCount: 1 }, // loadMissionStatus
    ]);
    const result = await mod.setSessionPinnedWithClient(client, TEST_ID, true);
    expect(result.ok).toBe(true);
    if (result.ok && result.data !== null) {
      expect(result.data.mode).toBe("mission");
      expect(result.data.missionStatus).toBe("running");
      expect(result.data.pinnedAt).not.toBeNull();
    }
  });
});
