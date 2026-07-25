/**
 * Overnight self-heal — claimRunForSelfHeal atomic safety re-check. The consumed
 * wake can't be cancelled, so this claim is the authority: every predicate is
 * re-verified under the row lock before flipping to running. DB client/repos are
 * mocked; the policy + deadline math run for real.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const queryOneWith = vi.fn();
const executeWith = vi.fn().mockResolvedValue(1);
const acquireLease = vi.fn();
// Run-scoped spend for the cost-cap recovery bound; defaults to $0 (well under
// the $1 fail-soft cap) so the cost gate is transparent for the other cases.
const getSessionTotalCost = vi.fn().mockResolvedValue(0);

vi.mock("@vex-agent/db/client.js", () => ({
  withTransaction: async <T>(cb: (client: unknown) => Promise<T>): Promise<T> => cb({}),
  queryOneWith: (...a: unknown[]) => queryOneWith(...a),
  executeWith: (...a: unknown[]) => executeWith(...a),
}));
vi.mock("@vex-agent/db/repos/runner-leases.js", () => ({
  acquireLease: (...a: unknown[]) => acquireLease(...a),
}));
vi.mock("@vex-agent/db/repos/usage.js", () => ({
  getSessionTotalCost: (...a: unknown[]) => getSessionTotalCost(...a),
}));

const { claimRunForSelfHeal } = await import(
  "@vex-agent/engine/runtime/lease-and-status/claim-self-heal.js"
);

const NOW = Date.parse("2026-07-25T02:00:00.000Z");
const IN_DEADLINE_START = "2026-07-25T01:50:00.000Z"; // 10m ago, 60m box
const PAST_DEADLINE_START = "2026-07-25T00:00:00.000Z"; // 2h ago, 60m box
const SNAP = { frozenMission: { constraintsJson: { durationMinutes: 60 } } };
const LEASE = { sessionId: "s1", ownerId: "self-heal-w1", expiresAt: new Date(NOW + 60_000) };

function runRow(over: Record<string, unknown> = {}) {
  return {
    status: "paused_error",
    session_id: "s1",
    stop_reason: "provider_error",
    stop_evidence_json: { classified: "transient" },
    error_retry_count: 2,
    auto_retry_unsafe: false,
    contract_snapshot_json: SNAP,
    started_at: IN_DEADLINE_START,
    permission: "full",
    ...over,
  };
}

const INPUT = {
  sessionId: "s1",
  missionRunId: "run-1",
  expectedAttempt: 2,
  ownerId: "self-heal-w1",
  processKind: "electron_main" as const,
  ttlMs: 300_000,
  nowMs: NOW,
};

afterEach(() => {
  queryOneWith.mockReset();
  executeWith.mockClear();
  acquireLease.mockReset();
  getSessionTotalCost.mockReset();
  getSessionTotalCost.mockResolvedValue(0);
  delete process.env.AGENT_SELF_HEAL_ENABLED;
  delete process.env.AGENT_MISSION_COST_CAP_USD;
});

describe("claimRunForSelfHeal — happy path", () => {
  it("flips paused_error → running + acquires the lease when every predicate holds", async () => {
    queryOneWith
      .mockResolvedValueOnce(runRow()) // run row
      .mockResolvedValueOnce(null); // no existing lease
    acquireLease.mockResolvedValue(LEASE);

    const out = await claimRunForSelfHeal(INPUT);
    expect(out.outcome).toBe("claimed");
    expect(executeWith).toHaveBeenCalledTimes(1); // the running flip
    expect(acquireLease).toHaveBeenCalledTimes(1);
  });
});

describe("claimRunForSelfHeal — fail-closed gates", () => {
  it("kill switch disabled → ineligible (no tx opened)", async () => {
    process.env.AGENT_SELF_HEAL_ENABLED = "false";
    const out = await claimRunForSelfHeal(INPUT);
    expect(out).toEqual({ outcome: "ineligible", reason: "disabled" });
    expect(queryOneWith).not.toHaveBeenCalled();
  });

  const cases: Array<[string, Record<string, unknown>, string]> = [
    ["run_missing", { __null: true }, "run_missing"],
    ["session_mismatch", { session_id: "other" }, "session_mismatch"],
    ["status_changed", { status: "running" }, "status_changed"],
    ["unsafe (irreversible in flight)", { auto_retry_unsafe: true }, "unsafe"],
    ["stop_reason not provider_error", { stop_reason: "user_stop" }, "stop_reason"],
    ["not_transient", { stop_evidence_json: { classified: "permanent" } }, "not_transient"],
    ["attempt_mismatch (epoch)", { error_retry_count: 5 }, "attempt_mismatch"],
    ["not_full", { permission: "restricted" }, "not_full"],
    ["past_deadline", { started_at: PAST_DEADLINE_START }, "past_deadline"],
  ];

  for (const [name, over, reason] of cases) {
    it(`${name} → ineligible:${reason}, no flip`, async () => {
      if ((over as { __null?: boolean }).__null) {
        queryOneWith.mockResolvedValueOnce(null);
      } else {
        queryOneWith.mockResolvedValueOnce(runRow(over));
      }
      const out = await claimRunForSelfHeal(INPUT);
      expect(out).toEqual({ outcome: "ineligible", reason });
      expect(executeWith).not.toHaveBeenCalled();
      expect(acquireLease).not.toHaveBeenCalled();
    });
  }

  // RECONCILIATION A — the self-heal ladder ceases at the COST cap, not just the
  // deadline. An in-DEADLINE run whose run-scoped spend is at/over its dollar cap
  // is refused exactly as a past-deadline run is: no flip, distinct telemetry.
  it("at/over the cost cap (within deadline) → ineligible:past_cost_cap, no flip", async () => {
    process.env.AGENT_MISSION_COST_CAP_USD = "1"; // $1 cap
    getSessionTotalCost.mockResolvedValue(1.25); // run already spent $1.25 ≥ cap
    queryOneWith.mockResolvedValueOnce(runRow()); // in-deadline paused_error run
    const out = await claimRunForSelfHeal(INPUT);
    expect(out).toEqual({ outcome: "ineligible", reason: "past_cost_cap" });
    expect(getSessionTotalCost).toHaveBeenCalledWith("s1", { since: IN_DEADLINE_START });
    expect(executeWith).not.toHaveBeenCalled();
    expect(acquireLease).not.toHaveBeenCalled();
  });

  it("just UNDER the cost cap (within deadline) → still claimable", async () => {
    process.env.AGENT_MISSION_COST_CAP_USD = "1";
    getSessionTotalCost.mockResolvedValue(0.99); // under cap
    queryOneWith
      .mockResolvedValueOnce(runRow())
      .mockResolvedValueOnce(null); // no existing lease
    acquireLease.mockResolvedValue(LEASE);
    const out = await claimRunForSelfHeal(INPUT);
    expect(out.outcome).toBe("claimed");
  });

  it("lease held by another live owner → lease_busy, no flip", async () => {
    queryOneWith
      .mockResolvedValueOnce(runRow())
      .mockResolvedValueOnce({
        session_id: "s1",
        mission_run_id: "run-1",
        owner_id: "someone-else",
        process_kind: "electron_main",
        acquired_at: new Date(NOW),
        heartbeat_at: new Date(NOW),
        // Live vs the WALL clock (the claim checks lease expiry against
        // `new Date()`, not the injected mission clock).
        expires_at: new Date(Date.now() + 5 * 60_000),
      });
    const out = await claimRunForSelfHeal(INPUT);
    expect(out.outcome).toBe("lease_busy");
    expect(executeWith).not.toHaveBeenCalled();
  });
});
