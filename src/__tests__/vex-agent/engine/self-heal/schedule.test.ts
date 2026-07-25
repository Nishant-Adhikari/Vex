/**
 * Overnight self-heal — ATOMIC OV2 schedule (insert-first, increment-if-won).
 * DB client is mocked; we assert the ordering guarantees that close the race
 * with the fast Phase-4d scheduler's commit→enqueue gap.
 */
import { afterEach, describe, it, expect, vi } from "vitest";

const queryOneWith = vi.fn();
const clientQuery = vi.fn().mockResolvedValue({ rows: [], rowCount: 1 });

vi.mock("@vex-agent/db/client.js", () => ({
  withTransaction: async <T>(cb: (client: unknown) => Promise<T>): Promise<T> =>
    cb({ query: (...a: unknown[]) => clientQuery(...a) }),
  queryOneWith: (...a: unknown[]) => queryOneWith(...a),
}));

const { scheduleSelfHealRetry } = await import(
  "@vex-agent/engine/self-heal/schedule.js"
);

const INPUT = {
  runId: "run-1",
  sessionId: "s-1",
  dueAt: new Date("2026-07-25T02:05:00.000Z"),
  reason: "self_heal retry",
  failover: true,
};

afterEach(() => {
  queryOneWith.mockReset();
  clientQuery.mockClear();
});

describe("scheduleSelfHealRetry", () => {
  it("locks the run, inserts the wake, THEN increments the epoch — attempt = count+1", async () => {
    queryOneWith
      .mockResolvedValueOnce({ status: "paused_error", error_retry_count: 4 }) // locked run
      .mockResolvedValueOnce({ id: "wake-9" }); // insert won the pending slot

    const out = await scheduleSelfHealRetry(INPUT);
    expect(out).toEqual({ attempt: 5 });

    // insert (queryOneWith #2) carried the post-increment attempt + failover.
    // Args: (client, sql, params); params[4] is the jsonb payload string.
    const insertArgs = queryOneWith.mock.calls[1];
    const payload = JSON.parse((insertArgs[2] as unknown[])[4] as string);
    expect(payload).toEqual({ trigger: "self_heal_retry", attempt: 5, failover: true });
    // the epoch UPDATE ran (client.query) exactly once, AFTER the insert.
    expect(clientQuery).toHaveBeenCalledTimes(1);
  });

  it("does NOT increment the epoch when a wake is already pending (insert conflict)", async () => {
    queryOneWith
      .mockResolvedValueOnce({ status: "paused_error", error_retry_count: 4 })
      .mockResolvedValueOnce(null); // ON CONFLICT DO NOTHING → no row

    const out = await scheduleSelfHealRetry(INPUT);
    expect(out).toBeNull();
    expect(clientQuery).not.toHaveBeenCalled(); // epoch never bumped
  });

  it("returns null without inserting when the run left paused_error", async () => {
    queryOneWith.mockResolvedValueOnce({ status: "running", error_retry_count: 4 });
    const out = await scheduleSelfHealRetry(INPUT);
    expect(out).toBeNull();
    expect(queryOneWith).toHaveBeenCalledTimes(1); // no insert attempted
    expect(clientQuery).not.toHaveBeenCalled();
  });

  it("returns null when the run is missing", async () => {
    queryOneWith.mockResolvedValueOnce(null);
    const out = await scheduleSelfHealRetry(INPUT);
    expect(out).toBeNull();
  });
});
