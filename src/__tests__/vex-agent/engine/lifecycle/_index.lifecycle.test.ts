/**
 * ============================================================================
 * MISSION-LIFECYCLE REGRESSION SUITE — INDEX
 * ============================================================================
 *
 * A cohesive safety net for the robustness fixes shipped this cycle. Each
 * critical mission-lifecycle failure mode has a NAMED regression guard below.
 * "NEW" guards live in this `lifecycle/` folder; "EXISTING" guards already lived
 * elsewhere and are LISTED here (not duplicated) so the whole net is discoverable
 * from one place. The meta-test at the bottom fails if any guard file is deleted
 * or renamed, so the index can never silently rot.
 *
 * ─ GUARD MAP ────────────────────────────────────────────────────────────────
 *
 *  #  Failure mode (fix / PR)                     Guard file(s)
 * ── ─────────────────────────────────────────── ─────────────────────────────
 *  1  Orphaned/wedged run reconciliation (#56):    EXISTING core/runner/mission-reconcile.test.ts
 *     a running run with an expired lease is        (sweep: claim→flatten→close→drop, no-op-safe);
 *     reconciled to stopped on boot; STOP is a      NEW finalize-integrity.lifecycle.ts
 *     no-op-safe finalize; mission_results          (runner_lost → cancelled + ledger outcome 'stopped',
 *     marked stopped/cancelled.                     LOST claim = no double close).
 *
 *  2  Deadline enforcement (forceLiquidate):        NEW deadline-enforcement.lifecycle.ts
 *     a run reaching its deadline force-            (start AND resume paths → liquidate + finalize
 *     liquidates open positions and stops with      deadline_reached); EXISTING mission-token-budget.test.ts
 *     stop_reason=deadline_reached.                 (hook predicate: deadline_reached & token_budget fire).
 *
 *  3  Token budget, run-scoped (fix B):             EXISTING mission-run-token-budget.test.ts
 *     usage accrues only from the run's start       (missionTokenSince=started_at wiring + integrated
 *     (missionTokenSince); at budget the run        force-liquidation), mission-token-budget.test.ts
 *     force-flattens + stops; a NEW run in the      (env parse, finalize map);
 *     same session starts at ~0. Banner tiers.      banner: NEW budget-banner.lifecycle.ts (0.7/0.85/0.95
 *                                                   boundary inclusivity) + EXISTING budget-pressure.test.ts.
 *
 *  4  Inference error classification (#52):         NEW error-path.lifecycle.ts
 *     a transient transport error retries; a        (classify→persist: socket/ECONNRESET → auto-retry;
 *     hard-excluded cause (TLS / ENOTFOUND / DNS)   ENOTFOUND + 5 TLS cert codes → paused_error, no wake);
 *     does NOT retry-loop → paused_error.           EXISTING mission-error-classifier.test.ts, mission-auto-retry.test.ts.
 *
 *  5  Prequote / liquidity-impact veto (#54):       NEW prequote-veto.lifecycle.ts
 *     a buy into a thin pool / failing              (thin-pool & ≥15% impact → fail verdict, no false veto);
 *     SafetyVerdict is VETOED and never             EXISTING swap-prequote/price-impact-guard.test.ts, gate.test.ts,
 *     broadcast.                                    runtime-prequote-gate.test.ts (fail → handler NEVER runs).
 *
 *  6  STOP always works (#60):                      NEW stop-safety.lifecycle.ts
 *     STOP is effective even with a stuck-pending   (control-bus stop_terminal: SKIP LOCKED past stuck
 *     control or a stale lease.                     pending, run→stopped, wakes cancelled, lease torn down
 *                                                   unconditionally, no-active-run no-op);
 *                                                   EXISTING abort-mission-run.test.ts (operator leaseless STOP).
 *
 *  7  Simulator no-broadcast:                       EXISTING sim/uniswap-simulator-paperfill.test.ts
 *     a sim-mode swap paper-fills and never         (handler: no signer/build/broadcast, records sim fill),
 *     reaches sendTransaction.                      sim/broadcast-primitive-guard.test.ts (primitive throws
 *                                                   before sendTransaction under sim). Folded in, not duplicated.
 *
 *  8  Finalize integrity:                           NEW finalize-integrity.lifecycle.ts
 *     a completed run writes mission_results with   (goal_reached → completed + coherent
 *     coherent outcome/stop_reason/pnl/trades.      outcome/stop_reason/pnl/trades ledger row);
 *                                                   EXISTING mission-finalize-timed-out.test.ts.
 *
 * ─ CONFIRMED PROD BUGS (guards added; fixes tracked separately) ──────────────
 *
 *  B1 Standalone expired lease never reclaimed:     NEW expired-lease-and-reconcile.lifecycle.ts
 *     an expired runner_leases row (blank           (claimSessionLease RECLAIMS an expired/foreign/blank
 *     mission_run_id) blocked ALL new mission        lease, not lease_busy; the boot reconciler only sweeps
 *     starts; the boot reconciler only sweeps        leases tied to an orphaned RUNNING run — a standalone
 *     leases tied to orphaned RUNNING runs.          expired lease is NEVER swept → FINDING).
 *
 *  B2 Lingering paused_error run wedges starts:     NEW paused-error-blocks-start.lifecycle.ts
 *     a paused_error run (ended_at=NULL) is still   (prepareMissionStart → session_has_active_run refuses
 *     "active" → every new start is refused.         new starts while it lingers → FINDING).
 *
 * See the PR body for full repros of the two pre-existing engine bugs surfaced:
 *   (a) mission-finalize.ts deadline ledger outcome mislabel (dead `outcome` var);
 *   (b) B1/B2 above.
 * ============================================================================
 */

import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

// Guards making up the mission-lifecycle net — NEW files in this folder plus the
// EXISTING files they lean on. Paths are relative to the repo root (vitest cwd).
const NEW_GUARDS = [
  "src/__tests__/vex-agent/engine/lifecycle/deadline-enforcement.lifecycle.test.ts",
  "src/__tests__/vex-agent/engine/lifecycle/error-path.lifecycle.test.ts",
  "src/__tests__/vex-agent/engine/lifecycle/finalize-integrity.lifecycle.test.ts",
  "src/__tests__/vex-agent/engine/lifecycle/expired-lease-and-reconcile.lifecycle.test.ts",
  "src/__tests__/vex-agent/engine/lifecycle/paused-error-blocks-start.lifecycle.test.ts",
  "src/__tests__/vex-agent/engine/lifecycle/stop-safety.lifecycle.test.ts",
  "src/__tests__/vex-agent/engine/lifecycle/budget-banner.lifecycle.test.ts",
  "src/__tests__/vex-agent/engine/lifecycle/prequote-veto.lifecycle.test.ts",
];

const REFERENCED_EXISTING_GUARDS = [
  "src/__tests__/vex-agent/engine/core/runner/mission-reconcile.test.ts",
  "src/__tests__/vex-agent/engine/core/runner/mission-run-token-budget.test.ts",
  "src/__tests__/vex-agent/engine/core/runner/mission-token-budget.test.ts",
  "src/__tests__/vex-agent/engine/core/runner/mission-finalize-timed-out.test.ts",
  "src/__tests__/vex-agent/engine/core/mission-error-classifier.test.ts",
  "src/__tests__/vex-agent/engine/core/mission-auto-retry.test.ts",
  "src/__tests__/vex-agent/engine/prompts/budget-pressure.test.ts",
  "src/__tests__/vex-agent/engine/abort-mission-run.test.ts",
  "src/__tests__/vex-agent/tools/protocols/runtime-prequote-gate.test.ts",
  "src/__tests__/sim/uniswap-simulator-paperfill.test.ts",
  "src/__tests__/sim/broadcast-primitive-guard.test.ts",
];

describe("mission-lifecycle regression suite — index integrity", () => {
  it.each(NEW_GUARDS)("NEW lifecycle guard exists: %s", (rel) => {
    expect(existsSync(resolve(process.cwd(), rel))).toBe(true);
  });

  it.each(REFERENCED_EXISTING_GUARDS)("referenced existing guard exists: %s", (rel) => {
    expect(existsSync(resolve(process.cwd(), rel))).toBe(true);
  });
});
