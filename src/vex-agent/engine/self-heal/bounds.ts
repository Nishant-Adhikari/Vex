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
 * COST CAP: a sibling PR (`feat/mission-cost-cap`) adds a USD cost cap to the
 * budget guard. Until it lands, `withinCostCap` is a permissive hook that only
 * enforces the deadline; when the cost-cap module merges, wire its check in
 * HERE (single seam) and the whole self-heal ladder respects it automatically.
 */

import {
  computeHardDeadlineMs,
  resolveDurationMinutes,
} from "../mission/mission-deadline.js";
import { snapshotDurationMinutes } from "./policy.js";

export interface RunBoundInput {
  readonly startedAt: string;
  readonly contractSnapshotJson: Record<string, unknown> | null;
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
 * COST-CAP HOOK (sibling `feat/mission-cost-cap`). Currently permissive — the
 * deadline is the live bound. When the cost-cap guard lands, evaluate it here so
 * every self-heal re-arm is cost-bounded without touching the watchdog.
 */
export function withinCostCap(_run: RunBoundInput): boolean {
  return true;
}

/**
 * Combined bound: a run is recoverable only while BOTH the deadline and the
 * cost cap allow it. Single call site for the watchdog + the self-heal claim.
 */
export function withinRecoveryBounds(
  run: RunBoundInput,
  nowMs: number,
  env: Record<string, string | undefined> = process.env,
): boolean {
  return withinDeadline(run, nowMs, env) && withinCostCap(run);
}
