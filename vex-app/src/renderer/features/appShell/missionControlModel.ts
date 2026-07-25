/**
 * MISSION CONTROL model — PURE derivations for the BOOK panel's run-status
 * header (mission identity + status pill + run-scoped budget meter). Kept free
 * of React/IPC so the mapping is unit-tested in isolation.
 *
 * The header answers "what run is this and what state is it in?" at a glance:
 *   - `deriveRunStatusPill` maps the live `mission_runs.status` to a labelled,
 *     toned pill (a live pulse only while genuinely `running`).
 *   - `deriveMissionName` picks the best human label (session title → goal
 *     snippet → generic), mirroring the Active Missions bar's rule.
 *   - `computeBudgetMeter` reconciles run-scoped token spend against the
 *     ENFORCED mission budget (the turn-loop denominator), degrading to `null`
 *     when the budget is unknown/disabled so the caller shows no bar (never a
 *     fabricated percentage).
 */

import type { MissionRunStatus } from "@shared/schemas/sessions.js";

/**
 * Pill colour intent — the component maps each tone to concrete classes.
 *   - `running` — live, the accent/success tone + a pulse.
 *   - `paused`  — parked awaiting input/time (approval / wake / user / plan).
 *   - `error`   — a faulted or failed run (needs attention).
 *   - `done`    — a completed run (terminal, benign).
 *   - `idle`    — no active run, or a stopped/cancelled terminal run.
 */
export type RunPillTone = "running" | "paused" | "error" | "done" | "idle";

export interface RunStatusPill {
  readonly label: string;
  readonly tone: RunPillTone;
  /** `true` only while the run is genuinely `running` — drives the live pulse. */
  readonly pulse: boolean;
}

/**
 * Map a live run status (+ whether an active run row exists) to the header pill.
 * `hasActiveRun === false` (agent session, or a run that has dropped out) yields
 * the neutral "No active run" idle pill regardless of a stale status.
 */
export function deriveRunStatusPill(
  status: MissionRunStatus | null,
  hasActiveRun: boolean,
): RunStatusPill {
  if (!hasActiveRun && status === null) {
    return { label: "No active run", tone: "idle", pulse: false };
  }
  switch (status) {
    case "running":
      return { label: "Running", tone: "running", pulse: true };
    case "paused_user":
      return { label: "Paused", tone: "paused", pulse: false };
    case "paused_approval":
      return { label: "Awaiting approval", tone: "paused", pulse: false };
    case "paused_wake":
      return { label: "Sleeping", tone: "paused", pulse: false };
    case "paused_plan_acceptance":
      return { label: "Awaiting plan", tone: "paused", pulse: false };
    case "paused_error":
      return { label: "Paused — error", tone: "error", pulse: false };
    case "completed":
      return { label: "Completed", tone: "done", pulse: false };
    case "failed":
      return { label: "Failed", tone: "error", pulse: false };
    case "stopped":
      return { label: "Stopped", tone: "idle", pulse: false };
    case "cancelled":
      return { label: "Cancelled", tone: "idle", pulse: false };
    default:
      // Active run row with an unmapped/null status — surface neutrally as
      // preparing, never as an error.
      return { label: "Preparing", tone: "paused", pulse: false };
  }
}

/**
 * Best human name for the run: the user-entered session title, else a trimmed
 * mission goal snippet, else a generic fallback. Same precedence the Active
 * Missions bar uses so a mission reads identically everywhere.
 */
export function deriveMissionName(
  title: string | null | undefined,
  goalSnippet: string | null | undefined,
  fallback = "Mission",
): string {
  const t = title?.trim();
  if (t) return t;
  const g = goalSnippet?.trim();
  if (g) return g;
  return fallback;
}

export interface BudgetMeter {
  readonly tokensUsed: number;
  readonly budget: number;
  /** Integer percent [0,100] of the enforced budget consumed this run. */
  readonly pct: number;
  /** `true` once spend meets/exceeds the budget (the enforcer stops the run). */
  readonly exhausted: boolean;
}

/**
 * Reconcile run-scoped token spend against the ENFORCED mission budget — the
 * exact `runTokensUsed / tokenBudget` fraction the turn-loop enforcer checks.
 * Returns `null` (→ show no budget bar) when either input is unusable: the
 * budget is disabled/absent (`null`/≤0) or the run-scoped token read failed
 * (`null`). `0` tokens is valid (a brand-new run reads ~0%).
 */
export function computeBudgetMeter(
  runTokensUsed: number | null,
  tokenBudget: number | null,
): BudgetMeter | null {
  if (tokenBudget === null || tokenBudget <= 0) return null;
  if (runTokensUsed === null || !Number.isFinite(runTokensUsed)) return null;
  const used = Math.max(0, runTokensUsed);
  const pct = Math.min(100, Math.max(0, Math.round((used / tokenBudget) * 100)));
  return {
    tokensUsed: used,
    budget: tokenBudget,
    pct,
    exhausted: used >= tokenBudget,
  };
}
