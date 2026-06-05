/**
 * SessionPlanCard — session-scoped plan-mode control (the agent-authored "HOW").
 *
 * Shown for BOTH agent and mission sessions (plan-mode is session-scoped). The
 * engine is the authority: this card is UX only. Renders:
 *   - a plan-mode on/off toggle with a "recommended" badge,
 *   - the active plan markdown (when present),
 *   - an "Accept plan" action when a plan is pending acceptance (the gate that
 *     unblocks execution / resumes a paused mission run).
 *
 * Invalidate-based hooks (no optimistic write): a server refusal snaps back.
 */

import type { JSX } from "react";
import { MarkdownContent } from "../../lib/markdown/MarkdownContent.js";
import {
  useSessionPlan,
  useSetPlanMode,
  useAcceptPlan,
} from "../../lib/api/sessions.js";
import { useRequestResume } from "../../lib/api/runtime.js";

export function SessionPlanCard({
  sessionId,
  missionStatus,
}: {
  sessionId: string;
  /** Active mission-run status (from the session detail), or null. */
  missionStatus?: string | null;
}): JSX.Element | null {
  const planQuery = useSessionPlan(sessionId);
  const setPlanMode = useSetPlanMode();
  const acceptPlan = useAcceptPlan();
  const requestResume = useRequestResume();

  const plan = planQuery.data?.ok ? planQuery.data.data : null;
  const enabled = plan?.enabled ?? false;
  const hasPlan = enabled && (plan?.planMd?.length ?? 0) > 0;
  const pending = hasPlan && plan?.accepted === false;
  // Accepted but the mission run is still parked for acceptance — the accept's
  // resume did not launch. Recoverable: the accepted plan makes a plain resume
  // valid (the server gate allows an accepted paused run).
  const awaitingResume =
    hasPlan && plan?.accepted === true && missionStatus === "paused_plan_acceptance";

  const toggleBusy = setPlanMode.isPending;
  const acceptBusy = acceptPlan.isPending;
  const resumeBusy = requestResume.isPending;
  const toggleBlockedPendingAcceptance =
    setPlanMode.data?.ok === true
    && setPlanMode.data.data.outcome === "blocked_pending_acceptance";

  return (
    <section className="mb-3 rounded-lg border border-neutral-700 bg-neutral-900/40 px-4 py-3 text-sm">
      <header className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-medium text-neutral-200">Plan mode</span>
          <span className="rounded bg-emerald-900/50 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-emerald-300">
            recommended
          </span>
        </div>
        <button
          type="button"
          disabled={toggleBusy}
          onClick={() => setPlanMode.mutate({ sessionId, enabled: !enabled })}
          className="rounded border border-neutral-600 px-2 py-1 text-xs text-neutral-200 hover:bg-neutral-800 disabled:opacity-50"
          aria-pressed={enabled}
        >
          {enabled ? "On — turn off" : "Off — turn on"}
        </button>
      </header>

      {enabled ? (
        <p className="mt-1 text-xs text-neutral-400">
          The agent researches first, writes an action plan (the “HOW”), and waits for
          your acceptance before executing.
        </p>
      ) : null}

      {toggleBlockedPendingAcceptance ? (
        <p className="mt-1 text-xs text-amber-300">
          Can’t turn plan mode off while the mission is waiting for plan acceptance —
          accept the plan below, or stop the mission first.
        </p>
      ) : null}

      {hasPlan ? (
        <div className="mt-3">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs font-medium text-neutral-300">Action plan</span>
            <span
              className={
                pending
                  ? "text-[11px] font-medium text-amber-300"
                  : "text-[11px] font-medium text-emerald-300"
              }
            >
              {pending ? "Pending your acceptance" : "Accepted"}
            </span>
          </div>
          <div className="max-h-72 overflow-auto rounded border border-neutral-800 bg-neutral-950/60 px-3 py-2">
            <MarkdownContent text={plan?.planMd ?? ""} />
          </div>
          {pending ? (
            <div className="mt-2 flex justify-end">
              <button
                type="button"
                disabled={acceptBusy}
                onClick={() =>
                  acceptPlan.mutate({ sessionId, expectedPlanMd: plan?.planMd ?? "" })
                }
                className="rounded bg-emerald-700 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-600 disabled:opacity-50"
              >
                {acceptBusy ? "Accepting…" : "Accept plan"}
              </button>
            </div>
          ) : null}
          {awaitingResume ? (
            <div className="mt-2 flex items-center justify-end gap-2">
              <span className="text-[11px] text-amber-300">Accepted, but the run didn’t resume.</span>
              <button
                type="button"
                disabled={resumeBusy}
                onClick={() => requestResume.mutate({ sessionId })}
                className="rounded bg-emerald-700 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-600 disabled:opacity-50"
              >
                {resumeBusy ? "Resuming…" : "Resume mission"}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
