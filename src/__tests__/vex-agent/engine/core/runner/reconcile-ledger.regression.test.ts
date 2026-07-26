/**
 * Regression tests — reconciler ledger-write resilience and LEDGER-01 SQL guard.
 *
 * RECONCILE-001: After `claim()` wins and the run is terminal (`stopped`),
 * `closeLedger()` failures must NOT cause `reconcileOne` to return "failed".
 * The orphan run is already claimed; returning "failed" would mis-count the
 * reconcile and mask the true state. The fix retries once and falls through to
 * "reconciled" even when both attempts throw, so the stranded ledger row (still
 * `outcome='running'`) can be repaired manually while `mission_runs` stays in
 * its correct terminal state.
 *
 * LEDGER-01: `closeMissionResult` SQL has `AND outcome = 'running'` in its WHERE
 * clause so a double-close silently matches 0 rows instead of overwriting
 * `ended_at`, `pnl_eth`, and `duration_s` with stale values. The function also
 * returns a boolean: true when a row was actually closed, false on double-close
 * (detected via rowCount=0).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Logger mock (reconcileOrphanedRuns calls logger.info/error/warn) ──────

vi.mock("@utils/logger.js", () => ({
  default: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// ── DB client mock (closeMissionResult uses execute from @vex-agent/db/client.js) ─

const mockExecute = vi.fn().mockResolvedValue(1);

vi.mock("@vex-agent/db/client.js", () => ({
  execute: (...a: unknown[]) => mockExecute(...a),
  query: vi.fn().mockResolvedValue([]),
  queryOne: vi.fn().mockResolvedValue(null),
  queryOneWith: vi.fn().mockResolvedValue(null),
  queryWith: vi.fn().mockResolvedValue([]),
  executeWith: vi.fn().mockResolvedValue(1),
  getPool: vi.fn().mockReturnValue({
    connect: vi.fn().mockResolvedValue({
      query: vi.fn().mockResolvedValue({ rows: [] }),
      release: vi.fn(),
    }),
  }),
  withTransaction: vi.fn().mockImplementation(
    async (fn: (client: unknown) => Promise<unknown>) => {
      const stubClient = {
        query: vi.fn().mockResolvedValue({ rows: [] }),
        release: vi.fn(),
      };
      return fn(stubClient);
    },
  ),
}));

import {
  reconcileOrphanedRuns,
  type ReconcileDeps,
} from "@vex-agent/engine/core/runner/mission-reconcile.js";
import type { MissionRun } from "@vex-agent/db/repos/mission-runs.js";
import { closeMissionResult } from "@vex-agent/db/repos/mission-results.js";

// ── Test helpers ───────────────────────────────────────────────────────────

function orphan(over: Partial<MissionRun> = {}): MissionRun {
  return {
    id: "run-1",
    missionId: "mission-1",
    sessionId: "sess-1",
    status: "running",
    startedAt: "2026-07-01T00:00:00.000Z",
    endedAt: null,
    lastCheckpointAt: null,
    stopReason: null,
    stopSummary: null,
    stopEvidenceJson: null,
    iterationCount: 3,
    contractSnapshotJson: null,
    recoveredFromRunId: null,
    errorRetryCount: 0,
    autoRetryUnsafe: false,
    ...over,
  };
}

function deps(over: Partial<ReconcileDeps> = {}): ReconcileDeps {
  return {
    findOrphans: vi.fn(async () => [] as MissionRun[]),
    claim: vi.fn(async () => true),
    flatten: vi.fn(async () => {}),
    closeLedger: vi.fn(async () => {}),
    dropStaleLease: vi.fn(async () => 1),
    sweepExpiredLeases: vi.fn(async () => 0),
    findAbandonedPausedErrors: vi.fn(async () => [] as MissionRun[]),
    countRunOpenPositions: vi.fn(async () => 0),
    reapStaleError: vi.fn(async () => true),
    closeReapedLedger: vi.fn(async () => {}),
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockExecute.mockResolvedValue(1);
});

// ══════════════════════════════════════════════════════════════════════════
// RECONCILE-001 — closeLedger failure after a won claim must not surface as "failed"
// ══════════════════════════════════════════════════════════════════════════

describe("RECONCILE-001: closeLedger retry — claimed run returns 'reconciled' even on ledger error", () => {
  it("RECONCILE-001: closeLedger throws once then resolves → reconciled, called twice", async () => {
    const closeLedger = vi
      .fn()
      .mockRejectedValueOnce(new Error("ledger transient DB error"))
      .mockResolvedValueOnce(undefined);

    const d = deps({
      findOrphans: vi.fn(async () => [orphan()]),
      claim: vi.fn(async () => true),
      closeLedger,
    });

    const summary = await reconcileOrphanedRuns(d);

    // The claim succeeded → outcome must be "reconciled", never "failed"
    expect(summary.reconciled).toBe(1);
    expect(summary.failed).toBe(0);
    // The first attempt failed; the retry call made closeLedger total = 2
    expect(closeLedger).toHaveBeenCalledTimes(2);
  });

  it("RECONCILE-001: closeLedger throws BOTH times → still reconciled, never failed", async () => {
    const closeLedger = vi
      .fn()
      .mockRejectedValue(new Error("ledger persistent DB error"));

    const d = deps({
      findOrphans: vi.fn(async () => [orphan()]),
      claim: vi.fn(async () => true),
      closeLedger,
    });

    const summary = await reconcileOrphanedRuns(d);

    // Claim is already committed (mission_runs is stopped). Stranded ledger is
    // recoverable manually; returning "failed" would be the wrong signal.
    expect(summary.reconciled).toBe(1);
    expect(summary.failed).toBe(0);
    // Both the initial attempt and the retry were called
    expect(closeLedger).toHaveBeenCalledTimes(2);
  });

  it("RECONCILE-001: claim lost (returns false) → skipped, closeLedger never called", async () => {
    const closeLedger = vi.fn();
    const d = deps({
      findOrphans: vi.fn(async () => [orphan()]),
      claim: vi.fn(async () => false),
      closeLedger,
    });

    const summary = await reconcileOrphanedRuns(d);

    expect(summary.skipped).toBe(1);
    expect(summary.reconciled).toBe(0);
    expect(closeLedger).not.toHaveBeenCalled();
  });

  it("RECONCILE-001: a genuine outer error (e.g. claim throws) → failed, not reconciled", async () => {
    const d = deps({
      findOrphans: vi.fn(async () => [orphan()]),
      claim: vi.fn(async () => {
        throw new Error("claim network error");
      }),
    });

    const summary = await reconcileOrphanedRuns(d);

    // A failure BEFORE the claim commits is correctly counted as "failed"
    expect(summary.failed).toBe(1);
    expect(summary.reconciled).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// LEDGER-01 — SQL guard AND boolean return value
// ══════════════════════════════════════════════════════════════════════════

describe("LEDGER-01: closeMissionResult SQL guard and boolean return", () => {
  it("LEDGER-01: closeMissionResult SQL has AND outcome = 'running' guard (source check)", () => {
    const src = readFileSync(
      path.resolve(
        __dirname,
        "../../../../../vex-agent/db/repos/mission-results.ts",
      ),
      "utf-8",
    );
    // Must include the idempotency guard so a double-close matches 0 rows
    expect(src).toMatch(/AND\s+outcome\s*=\s*['"]running['"]/);
  });

  it("LEDGER-01: returns true when execute reports a row was updated (rowCount=1)", async () => {
    mockExecute.mockResolvedValueOnce(1);

    const result = await closeMissionResult({
      missionRunId: "run-abc",
      outcome: "completed",
      stopReason: "goal_reached",
      bankrollEndEth: 1.5,
      ethPriceUsdEnd: 3000,
      pnlEth: 0.1,
      pnlPct: 7.2,
      trades: 5,
      wins: 3,
      losses: 2,
      rotations: 0,
      vetoes: 0,
      openPositions: null,
    });

    expect(result).toBe(true);
  });

  it("LEDGER-01: returns false on double-close (rowCount=0 — already terminal outcome)", async () => {
    mockExecute.mockResolvedValueOnce(0);

    const result = await closeMissionResult({
      missionRunId: "run-abc",
      outcome: "completed",
      stopReason: "goal_reached",
      bankrollEndEth: 1.5,
      ethPriceUsdEnd: 3000,
      pnlEth: 0.1,
      pnlPct: 7.2,
      trades: 5,
      wins: 3,
      losses: 2,
      rotations: 0,
      vetoes: 0,
      openPositions: null,
    });

    expect(result).toBe(false);
  });
});
