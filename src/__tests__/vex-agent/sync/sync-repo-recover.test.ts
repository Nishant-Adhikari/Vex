/**
 * Sync repo — recoverStaleRuns (B-005).
 *
 * Pins the SQL contract for stale `running` recovery:
 * - filters on `started_at` age (the claim/lease timestamp),
 * - marks rows `failed` (NOT requeued to `pending`),
 * - returns the recovered count,
 * - guards against invalid timeouts (no DB call).
 *
 * The DB client is mocked so this stays a fast unit test on the query shape.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockQuery = vi.fn();

vi.mock("../../../vex-agent/db/client.js", () => ({
  query: (...args: unknown[]) => mockQuery(...args),
  queryOne: vi.fn().mockResolvedValue(null),
  execute: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../vex-agent/db/params.js", () => ({
  jsonb: (v: unknown) => v,
}));

const { recoverStaleRuns } = await import("../../../vex-agent/db/repos/sync.js");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("recoverStaleRuns — B-005", () => {
  it("flips stale running rows to failed (not pending) filtered by started_at age", async () => {
    mockQuery.mockResolvedValueOnce([{ id: 7 }, { id: 9 }]);

    const recovered = await recoverStaleRuns(600);

    expect(recovered).toBe(2);
    expect(mockQuery).toHaveBeenCalledTimes(1);

    const [sql, params] = mockQuery.mock.calls[0];
    // Marks failed, never requeues to pending.
    expect(sql).toMatch(/SET status = 'failed'/);
    expect(sql).not.toMatch(/SET status = 'pending'/);
    // Only touches currently-running rows...
    expect(sql).toMatch(/WHERE status = 'running'/);
    // ...older than the lease, measured from started_at (the claim timestamp).
    expect(sql).toMatch(/started_at < NOW\(\) - make_interval/);
    // Records the recovery reason for audit.
    expect(sql).toMatch(/ended_at = NOW\(\)/);
    expect(sql).toMatch(/error =/);
    // Timeout is floored and passed as a bound param, not interpolated.
    expect(params).toEqual([600]);
  });

  it("floors a fractional timeout before binding", async () => {
    mockQuery.mockResolvedValueOnce([]);
    await recoverStaleRuns(600.9);
    expect(mockQuery.mock.calls[0][1]).toEqual([600]);
  });

  it("returns 0 and does not touch the DB for non-positive timeout", async () => {
    expect(await recoverStaleRuns(0)).toBe(0);
    expect(await recoverStaleRuns(-5)).toBe(0);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("returns 0 and does not touch the DB for non-finite timeout", async () => {
    expect(await recoverStaleRuns(Number.NaN)).toBe(0);
    expect(await recoverStaleRuns(Number.POSITIVE_INFINITY)).toBe(0);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("returns 0 when no rows are stale", async () => {
    mockQuery.mockResolvedValueOnce([]);
    expect(await recoverStaleRuns(600)).toBe(0);
  });
});
