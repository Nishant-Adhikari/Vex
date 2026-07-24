/**
 * RUNTIME & COST — the BOOK panel's mission-run instrument section.
 *
 * Leads with a RUN-SCOPED BUDGET meter for an active mission run: run-scoped
 * tokens + cost (reset per run — counted from the run's `started_at`, so a new
 * mission in the same session starts near 0 instead of inheriting the prior
 * run's cumulative total) reconciled against the ENFORCED mission token budget
 * (`durationMinutes × AGENT_MISSION_TOKENS_PER_MINUTE`) — the exact denominator
 * the turn-loop enforcer checks, both surfaced via `runtime.getState`. So the
 * percentage means "% of THIS run's budget", not context-window fill.
 *
 * Beneath it sits the `SessionRuntimeBar` (model · last-turn usage · context
 * window · compaction) — the context-window meter there is a DISTINCT indicator
 * (how full the model's context is), clearly separate from the budget meter.
 *
 * The live RUNNING TIME / TIME LEFT readout moved UP into the MISSION CONTROL
 * header (`MissionControlHeader`); this section is model/usage/budget only.
 *
 * Fail-soft: no active run, or a disabled/unknown budget → the budget meter is
 * omitted and the section degrades to the session runtime bar alone (never a
 * blanked panel, never a fabricated percentage).
 */

import type { JSX } from "react";
import { useRuntimeState } from "../../../lib/api/runtime.js";
import { SessionRuntimeBar } from "../SessionRuntimeBar.js";
import { computeBudgetMeter } from "../missionControlModel.js";
import { BookBlock } from "./BookBlock.js";

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function fmtCost(cost: number): string {
  return cost >= 1 ? `$${cost.toFixed(2)}` : `$${cost.toFixed(4)}`;
}

export function MissionRuntimeCostBlock({
  sessionId,
}: {
  readonly sessionId: string;
}): JSX.Element {
  const runtimeQuery = useRuntimeState(sessionId);
  const runtime = runtimeQuery.data?.ok ? runtimeQuery.data.data : null;

  const hasActiveRun = runtime?.hasActiveRun === true;
  const budget = hasActiveRun
    ? computeBudgetMeter(
        runtime?.runTokensUsed ?? null,
        runtime?.tokenBudget ?? null,
      )
    : null;
  const runCost = hasActiveRun ? (runtime?.runCostUsd ?? null) : null;

  return (
    <BookBlock title="Runtime & Cost" collapsible defaultOpen>
      {budget !== null ? (
        <div data-vex-area="mission-budget-meter" className="mb-3 flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--vex-text-3)]">
              Budget
            </span>
            <span className="font-mono text-[11px] tabular-nums text-[var(--vex-text)]">
              {fmtTokens(budget.tokensUsed)}
              <span className="text-[var(--vex-text-3)]">
                {" / "}
                {fmtTokens(budget.budget)}
              </span>
            </span>
          </div>
          <span
            aria-label={`Mission budget ${budget.pct}% used this run`}
            className="relative h-1 w-full overflow-hidden rounded-full bg-white/[0.12]"
          >
            <span
              className={
                budget.exhausted
                  ? "absolute inset-y-0 left-0 rounded-full bg-[var(--vex-warn-text)]"
                  : "absolute inset-y-0 left-0 rounded-full bg-[var(--vex-accent)]"
              }
              style={{ width: `${budget.pct}%` }}
            />
          </span>
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-mono text-[10px] tabular-nums text-[var(--vex-text-3)]">
              {budget.pct}% of run budget
            </span>
            {runCost !== null ? (
              <span className="font-mono text-[10px] tabular-nums text-[var(--vex-text-3)]">
                {fmtCost(runCost)} this run
              </span>
            ) : null}
          </div>
        </div>
      ) : null}
      <SessionRuntimeBar sessionId={sessionId} layout="stack" />
    </BookBlock>
  );
}
