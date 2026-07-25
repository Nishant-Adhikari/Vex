/**
 * LIFECYCLE GUARD — STOP always works (#60).
 *
 * Guards the control-bus `stop_terminal` transition (`observeAndApplyControl`),
 * the path a UI STOP takes at a turn-loop checkpoint. Three properties that
 * make STOP effective even when the session is wedged:
 *
 *   1. It locks the next pending request with `FOR UPDATE SKIP LOCKED`, so a
 *      DIFFERENT stuck-pending control row held by another worker can't block a
 *      fresh STOP.
 *   2. It flips the active run to `stopped` / `user_stopped` and cancels pending
 *      wakes (`consumed_by_stop`) so nothing re-animates the run.
 *   3. It UNCONDITIONALLY `DELETE`s the session's runner lease — the lease is
 *      never read for freshness, so a STALE lease can't keep STOP from clearing
 *      the session for a future fresh run.
 *   4. With NO active run it is still a clean `stop_applied` no-op (idempotent).
 *
 * The operator-abort STOP path (`abortMissionRun`, the leaseless/wedged-run
 * flatten-then-cancel case) is covered by `abort-mission-run.test.ts`; this
 * guard closes the previously-untested control-bus branch (all prior callers
 * mocked `observeAndApplyControl`). DB client is mocked (no real Postgres);
 * assertions match the emitted SQL.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const queryOneWith = vi.fn();
const executeWith = vi.fn();

vi.mock("@vex-agent/db/client.js", () => ({
  withTransaction: async <T>(cb: (client: unknown) => Promise<T>): Promise<T> =>
    cb({}),
  queryOneWith: (...a: unknown[]) => queryOneWith(...a),
  executeWith: (...a: unknown[]) => executeWith(...a),
}));

const { observeAndApplyControl } = await import(
  "@vex-agent/engine/runtime/lease-and-status/observe-and-apply.js"
);

function controlRow(over: Record<string, unknown> = {}) {
  return {
    id: "req-1",
    session_id: "sess-1",
    mission_run_id: "run-1",
    kind: "stop_terminal",
    status: "observed",
    requested_by: "user",
    reason: null,
    correlation_id: "corr-1",
    created_at: new Date(),
    observed_at: new Date(),
    cleared_at: null,
    expires_at: null,
    ...over,
  };
}

function sqlOf(call: unknown[]): string {
  return String(call[1]);
}

beforeEach(() => {
  queryOneWith.mockReset();
  executeWith.mockReset();
  executeWith.mockResolvedValue(2); // wake-cancel count read from one of these
});

describe("observeAndApplyControl — stop_terminal forces through", () => {
  it("stops the run, cancels wakes, and TEARS DOWN the lease even if stale", async () => {
    queryOneWith
      .mockResolvedValueOnce({ id: "req-1" }) // 1. claim pending (SKIP LOCKED)
      .mockResolvedValueOnce(controlRow()) // 2. observe -> row
      .mockResolvedValueOnce({ id: "run-1", status: "running", session_id: "sess-1" }); // 3. active run

    const outcome = await observeAndApplyControl({
      sessionId: "sess-1",
      kinds: ["stop_terminal"],
    });

    expect(outcome.outcome).toBe("stop_applied");
    if (outcome.outcome === "stop_applied") {
      expect(outcome.terminalStatus).toBe("stopped");
      expect(outcome.previousStatus).toBe("running");
      expect(outcome.wakeCancelledCount).toBe(2);
    }

    // 1. The claim uses FOR UPDATE SKIP LOCKED so a stuck-pending row can't block.
    expect(sqlOf(queryOneWith.mock.calls[0])).toMatch(/FOR UPDATE SKIP LOCKED/);

    const sqls = executeWith.mock.calls.map(sqlOf);
    // 2. Run flipped to stopped / user_stopped.
    expect(sqls.some((s) => /UPDATE mission_runs[\s\S]*status\s*=\s*'stopped'/.test(s) && /user_stopped/.test(s))).toBe(true);
    // Wakes cancelled with consumed_by_stop.
    expect(sqls.some((s) => /loop_wake_requests[\s\S]*consumed_by_stop/.test(s))).toBe(true);
    // 3. Lease unconditionally deleted (stale-lease override) — no freshness read.
    expect(sqls.some((s) => /DELETE FROM runner_leases WHERE session_id/.test(s))).toBe(true);
  });

  it("is a clean stop_applied no-op when there is NO active run (idempotent)", async () => {
    queryOneWith
      .mockResolvedValueOnce({ id: "req-1" })
      .mockResolvedValueOnce(controlRow())
      .mockResolvedValueOnce(null); // no active run

    const outcome = await observeAndApplyControl({
      sessionId: "sess-1",
      kinds: ["stop_terminal"],
    });

    expect(outcome.outcome).toBe("stop_applied");
    if (outcome.outcome === "stop_applied") {
      expect(outcome.terminalStatus).toBe("stopped");
      expect(outcome.wakeCancelledCount).toBe(0);
    }
    // Only the request is cleared; no run update / lease delete on the empty path.
    const sqls = executeWith.mock.calls.map(sqlOf);
    expect(sqls.some((s) => /DELETE FROM runner_leases/.test(s))).toBe(false);
  });

  it("returns no_request when no pending stop exists", async () => {
    queryOneWith.mockResolvedValueOnce(null);
    const outcome = await observeAndApplyControl({
      sessionId: "sess-1",
      kinds: ["stop_terminal"],
    });
    expect(outcome.outcome).toBe("no_request");
    expect(executeWith).not.toHaveBeenCalled();
  });
});
