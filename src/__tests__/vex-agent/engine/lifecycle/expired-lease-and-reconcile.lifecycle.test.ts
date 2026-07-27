/**
 * LIFECYCLE GUARD — Expired runner-lease reclamation (CONFIRMED PROD BUG).
 *
 * Production incident: a `runner_leases` row with `expires_at` ~10 days in the
 * past (owner `agent-turn-…`, BLANK `mission_run_id`) was never reclaimed and
 * blocked ALL new mission starts. Two facts this suite pins:
 *
 *   A. THE CONTRACT THAT MUST HOLD — `claimSessionLease` reclaims an EXPIRED
 *      lease (even a foreign owner / blank mission_run_id) instead of returning
 *      `lease_busy`. Only a lease that is BOTH still-live AND foreign-owned is
 *      `lease_busy`. Regressing the `expires_at >= now` tolerance would re-open
 *      the incident, so we guard it.
 *
 *   B. THE FIX (BUG B) — the boot reconciler (`reconcileOrphanedRuns`) now runs
 *      a GLOBAL expired-lease sweep (`runnerLeasesRepo.releaseAllExpiredLeases`,
 *      `WHERE expires_at < NOW()`) UNCONDITIONALLY, independent of any orphaned
 *      RUNNING run. Previously it only dropped leases attached to an orphaned
 *      running run (`dropStaleLease` once per `findOrphanedRunningRuns()` result),
 *      so a STANDALONE expired lease with NO running run (a dead `agent-turn-…`
 *      chat lease, or a `paused_error` session) survived every restart and wedged
 *      all new starts with `lease_busy`. Block B guards that the global sweep now
 *      fires on every pass and reclaims the standalone dead lease.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Block A: claimSessionLease reclaim contract ──
const queryOneWith = vi.fn();
const acquireLease = vi.fn();

vi.mock("@vex-agent/db/client.js", () => ({
  withTransaction: async <T>(cb: (client: unknown) => Promise<T>): Promise<T> =>
    cb({}),
  queryOneWith: (...a: unknown[]) => queryOneWith(...a),
  executeWith: vi.fn(),
}));
vi.mock("@vex-agent/db/repos/runner-leases.js", () => ({
  acquireLease: (...a: unknown[]) => acquireLease(...a),
  releaseExpiredLease: vi.fn(),
}));
vi.mock("@utils/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { claimSessionLease } = await import(
  "@vex-agent/engine/runtime/lease-and-status/claim-session-lease.js"
);

const CLAIMED_LEASE = {
  sessionId: "sess-1",
  missionRunId: null,
  ownerId: "start-mission-abc",
  processKind: "electron_main" as const,
  acquiredAt: new Date(),
  heartbeatAt: new Date(),
  expiresAt: new Date(Date.now() + 60_000),
};

/** A raw runner_leases row (snake_case, as the SELECT returns it). */
function leaseRow(over: Record<string, unknown> = {}) {
  return {
    session_id: "sess-1",
    mission_run_id: null, // the blank mission_run_id from the incident
    owner_id: "agent-turn-deadbeef",
    process_kind: "electron_main",
    acquired_at: new Date(Date.now() - 11 * 864e5),
    heartbeat_at: new Date(Date.now() - 11 * 864e5),
    expires_at: new Date(Date.now() - 10 * 864e5), // 10 days STALE
    ...over,
  };
}

function claim(ownerId = "start-mission-abc") {
  return claimSessionLease({
    sessionId: "sess-1",
    ownerId,
    processKind: "electron_main",
    ttlMs: 60_000,
  });
}

describe("claimSessionLease — an expired lease is reclaimable, not lease_busy", () => {
  beforeEach(() => {
    queryOneWith.mockReset();
    acquireLease.mockReset();
    acquireLease.mockResolvedValue(CLAIMED_LEASE);
  });

  it("reclaims a 10-day-stale foreign lease with a BLANK mission_run_id (the incident shape)", async () => {
    queryOneWith.mockResolvedValueOnce(leaseRow());
    const result = await claim();
    expect(result.outcome).toBe("claimed");
    expect(acquireLease).toHaveBeenCalledOnce();
  });

  it("returns lease_busy ONLY when the existing lease is still-live AND foreign-owned", async () => {
    queryOneWith.mockResolvedValueOnce(
      leaseRow({ owner_id: "someone-else", expires_at: new Date(Date.now() + 60_000) }),
    );
    const result = await claim();
    expect(result.outcome).toBe("lease_busy");
    expect(acquireLease).not.toHaveBeenCalled();
  });

  it("reclaims an expired lease even when this owner already held it", async () => {
    queryOneWith.mockResolvedValueOnce(leaseRow({ owner_id: "start-mission-abc" }));
    const result = await claim("start-mission-abc");
    expect(result.outcome).toBe("claimed");
  });
});

// ── Block B: the reconcile gap (documented current behavior) ──
const { reconcileOrphanedRuns } = await import(
  "@vex-agent/engine/core/runner/mission-reconcile.js"
);

function reconcileDeps(over: Record<string, unknown> = {}) {
  return {
    findOrphans: vi.fn(async () => []),
    claim: vi.fn(async () => true),
    flatten: vi.fn(async () => {}),
    closeLedger: vi.fn(async () => {}),
    dropStaleLease: vi.fn(async () => 1),
    // The BOOT-TIME global expired-lease sweep (BUG B fix). Returns the number
    // of dead `runner_leases` rows reclaimed across ALL sessions.
    sweepExpiredLeases: vi.fn(async () => 1),
    // Paused_error reaper seams (BUG C) — inert here (this block guards the
    // lease sweep; the reaper has its own guard in paused-error-blocks-start).
    findAbandonedPausedErrors: vi.fn(async () => []),
    countRunOpenPositions: vi.fn(async () => 0),
    reapStaleError: vi.fn(async () => true),
    closeReapedLedger: vi.fn(async () => {}),
    ...over,
  };
}

describe("reconcileOrphanedRuns — standalone expired-lease sweep (BUG B fixed)", () => {
  it("reclaims a standalone expired lease (no orphaned RUNNING run) via the global boot sweep", async () => {
    // No orphaned running run -> the per-orphan drop never fires, but the NEW
    // global sweep runs UNCONDITIONALLY and reclaims the dead standalone lease.
    // This is the fix for the confirmed `lease_busy` wedge.
    const deps = reconcileDeps({ findOrphans: vi.fn(async () => []) });
    const summary = await reconcileOrphanedRuns(deps);
    expect(deps.sweepExpiredLeases).toHaveBeenCalledOnce();
    expect(summary.leasesSwept).toBe(1);
    expect(summary).toMatchObject({ scanned: 0, reconciled: 0, skipped: 0, failed: 0 });
    // The per-orphan drop still does NOT fire (there is no orphaned running run);
    // the standalone lease is cleared by the global sweep, not the per-orphan one.
    expect(deps.dropStaleLease).not.toHaveBeenCalled();
  });

  it("sweeps expired leases AND drops the stale lease for a session that HAS an orphaned running run", async () => {
    const orphan = {
      id: "run-9", missionId: "m-9", sessionId: "sess-9", status: "running",
      startedAt: "2026-07-01T00:00:00.000Z", endedAt: null, lastCheckpointAt: null,
      stopReason: null, stopSummary: null, stopEvidenceJson: null, iterationCount: 1,
      contractSnapshotJson: null, recoveredFromRunId: null, errorRetryCount: 0,
      autoRetryUnsafe: false,
    };
    const deps = reconcileDeps({ findOrphans: vi.fn(async () => [orphan]) });
    await reconcileOrphanedRuns(deps as never);
    expect(deps.sweepExpiredLeases).toHaveBeenCalledOnce();
    expect(deps.dropStaleLease).toHaveBeenCalledWith("sess-9");
  });
});
