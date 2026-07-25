/**
 * Overnight self-heal — mission bound checks (deadline + cost/budget hook).
 *
 * The self-heal watchdog is DEADLINE-BOUNDED: it recovers a transient failure
 * only while the mission is still within its hard time-box, and stops re-arming
 * the instant the box is spent (the abandoned-run reaper / a human then owns the
 * terminal run). The deadline is derived purely from the IMMUTABLE `started_at`
 * + the mission's box duration — the same agent-independent boundary the
 * turn-loop enforces (`mission-deadline.ts`) — so a wake/resume can never talk
 * itself past it.
 *
 * COST CAP: the sibling `feat/mission-cost-cap` PR is now MERGED, so this seam
 * is WIRED to the real cost machinery. `withinCostCap` resolves the SAME
 * effective per-mission cap the turn-loop enforcer uses (`resolveMissionCostCap`
 * over the frozen `costCapUsd` on the run contract) and compares it against the
 * run-scoped spend (`getSessionTotalCost` since the run's immutable `started_at`
 * — the identical `missionTokenSince` boundary the enforcer scopes to). A
 * self-heal re-arm is therefore refused the instant a run is at/over its dollar
 * cap, exactly as it is refused past its deadline. Single seam: the watchdog
 * (OV2) and the atomic resume claim both call `withinRecoveryBounds`, so both
 * respect the cost cap automatically.
 */

import {
  computeHardDeadlineMs,
  resolveDurationMinutes,
  frozenCostCapUsd,
} from "../mission/mission-deadline.js";
import { resolveMissionCostCap } from "../../../lib/agent-config.js";
import { getSessionTotalCost } from "../../db/repos/usage.js";
import { snapshotDurationMinutes } from "./policy.js";

export interface RunBoundInput {
  readonly startedAt: string;
  readonly contractSnapshotJson: Record<string, unknown> | null;
}

/**
 * Run-scoped cost reader — the SAME `getSessionTotalCost(sessionId, { since })`
 * the turn-loop enforcer uses. Injectable so the watchdog's decision matrix
 * stays unit-testable with no DB. `since` is the run's immutable `started_at`,
 * so a run counts only its OWN spend (setup/recovery tokens excluded) — the
 * identical boundary the enforcer's `missionTokenSince` applies.
 */
export type RunCostReader = (
  sessionId: string,
  opts: { since?: string | null },
) => Promise<number>;

export interface RecoveryBoundDeps {
  /** Cost accessor; defaults to the real run-scoped `getSessionTotalCost`. */
  readonly costReader?: RunCostReader;
  /** Env for cap resolution + deadline duration; defaults to `process.env`. */
  readonly env?: Record<string, string | undefined>;
}

/**
 * The absolute hard-deadline epoch (ms) for a run, from its immutable
 * `started_at` + the mission's structured box duration (falling back to the env
 * / 60-min default). `null` when `started_at` is unparseable — treated as
 * fail-open by callers (a bad timestamp must not manufacture a spurious
 * deadline that blocks recovery).
 */
export function runDeadlineMs(
  run: RunBoundInput,
  env: Record<string, string | undefined> = process.env,
): number | null {
  const durationMin = resolveDurationMinutes(
    snapshotDurationMinutes(run.contractSnapshotJson),
    env,
  );
  return computeHardDeadlineMs(run.startedAt, durationMin);
}

/**
 * Whether `nowMs` is still within the run's hard deadline. Fail-OPEN when the
 * deadline can't be computed (unparseable timestamp) — recovery is allowed
 * rather than a bad timestamp silently killing an in-flight mission.
 */
export function withinDeadline(
  run: RunBoundInput,
  nowMs: number,
  env: Record<string, string | undefined> = process.env,
): boolean {
  const deadline = runDeadlineMs(run, env);
  if (deadline === null) return true;
  return nowMs < deadline;
}

/**
 * Whether the run is still UNDER its hard USD cost cap. Wired to the real
 * cost-cap machinery (sibling `feat/mission-cost-cap`):
 *
 *   1. Resolve the effective cap with `resolveMissionCostCap` over the frozen
 *      per-mission `costCapUsd` — the SAME resolution the turn-loop enforcer
 *      uses. A `null` cap (global disable sentinel) means UNBOUNDED → `true`.
 *   2. Otherwise read the run-scoped spend (`getSessionTotalCost` since the
 *      run's immutable `started_at`) and require `spent < cap` — the exact
 *      complement of the enforcer's `spent >= cap → cost_cap_reached` stop.
 *
 * FAIL-OPEN on a cost-read error, mirroring `withinDeadline`'s stance on a bad
 * timestamp: a transient accumulator hiccup must not manufacture a spurious
 * cap that blocks recovery — and the turn-loop re-checks cost on the very first
 * resumed turn and stops immediately if it is genuinely over, so at most one
 * turn of exposure. Requires `sessionId` (the cost accessor's key); the
 * deadline check does not, which is why cost is a separate async gate.
 */
export async function withinCostCap(
  run: RunBoundInput,
  sessionId: string,
  deps: RecoveryBoundDeps = {},
): Promise<boolean> {
  const env = deps.env ?? process.env;
  const cap = resolveMissionCostCap(env, frozenCostCapUsd(run.contractSnapshotJson));
  if (cap === null) return true; // cap disabled → unbounded (matches enforcer)
  const read = deps.costReader ?? getSessionTotalCost;
  try {
    const spent = await read(sessionId, { since: run.startedAt });
    return spent < cap;
  } catch {
    return true; // fail-open — the live enforcer re-checks on the next turn
  }
}

/**
 * Combined bound: a run is recoverable only while BOTH the deadline AND the
 * cost cap allow it. Single call site for the watchdog (OV2) + the atomic
 * self-heal resume claim. The cheap synchronous deadline is evaluated FIRST so
 * a past-box run never even hits the cost accessor.
 */
export async function withinRecoveryBounds(
  run: RunBoundInput,
  nowMs: number,
  sessionId: string,
  deps: RecoveryBoundDeps = {},
): Promise<boolean> {
  if (!withinDeadline(run, nowMs, deps.env ?? process.env)) return false;
  return withinCostCap(run, sessionId, deps);
}
