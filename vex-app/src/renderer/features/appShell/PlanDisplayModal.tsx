/**
 * PlanDisplayModal — the action plan ("HOW") review surface, hosted in a
 * top-layer native `<dialog>` (the MISSION RAIL's plan `PremiumBadge` opens it).
 *
 * Wraps the SAME plan well + state line + standalone actions the inline
 * `SessionPlanCard` renders (`useSessionPlan`, `useAcceptPlan`,
 * `useRequestResume`). Read-only under `suppressAccept` (mission setup, where
 * the host accepts the plan together with the contract via
 * `MissionContractModal`); otherwise it surfaces the standalone "Accept plan"
 * and the "Resume mission" recovery action — identical to the card.
 *
 * No new IPC and no plan content leaves the renderer: `plan.accept` echoes the
 * reviewed markdown back as `expectedPlanMd` (the optimistic-concurrency guard
 * that already exists), exactly as the inline card does.
 */

import type { JSX } from "react";
import type { PlanAcceptResult } from "@shared/schemas/session-plan.js";
import { assertNever } from "@shared/ipc/result.js";
import { MarkdownContent } from "../../lib/markdown/MarkdownContent.js";
import { useAcceptPlan, useSessionPlan } from "../../lib/api/sessions.js";
import { useRequestResume } from "../../lib/api/runtime.js";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog.js";

/** Accent-hairline action key (Accept/Resume) — quiet until hovered. */
const ACTION_KEY =
  "rounded-md border border-[var(--vex-accent-border)] px-3 py-1.5 text-xs font-medium text-[var(--vex-accent-text)] transition-colors hover:bg-[var(--vex-accent-fill-8)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vex-accent)] disabled:cursor-not-allowed disabled:opacity-50";

export interface PlanDisplayModalProps {
  readonly sessionId: string;
  /** Active mission-run status (from the session detail), or null. */
  readonly missionStatus?: string | null;
  /**
   * When true the read-only plan review still renders but the standalone
   * "Accept plan" action is withheld — the host accepts the plan together with
   * the contract via the unified `mission.acceptContract` step (mission setup,
   * plan-mode on).
   */
  readonly suppressAccept?: boolean;
  readonly open: boolean;
  readonly onOpenChange: (next: boolean) => void;
}

export function PlanDisplayModal({
  sessionId,
  missionStatus = null,
  suppressAccept = false,
  open,
  onOpenChange,
}: PlanDisplayModalProps): JSX.Element {
  const planQuery = useSessionPlan(sessionId);
  const acceptPlan = useAcceptPlan();
  const requestResume = useRequestResume();

  const plan = planQuery.data?.ok ? planQuery.data.data : null;
  const enabled = plan?.enabled ?? false;
  const hasPlan = enabled && (plan?.planMd?.length ?? 0) > 0;
  const pending = hasPlan && plan?.accepted === false;
  const showAcceptButton = pending && !suppressAccept;
  const awaitingResume =
    hasPlan &&
    plan?.accepted === true &&
    missionStatus === "paused_plan_acceptance";

  const acceptBusy = acceptPlan.isPending;
  const resumeBusy = requestResume.isPending;

  // Standalone-accept failure surfacing: `plan.accept` can refuse
  // (stale/no_plan/not_found) or the mutation can reject (transport). Without a
  // notice the user clicks "Accept plan" and sees nothing. Only relevant on the
  // standalone surface (suppressAccept hides the action; the contract modal owns
  // the unified-accept notice there).
  const acceptOutcome = acceptPlan.data?.ok ? acceptPlan.data.data.outcome : null;
  // A rejected mutation OR a resolved-but-failed Result envelope (ok: false) are
  // both failure surfaces with no `outcome`.
  const acceptErrored =
    acceptPlan.isError || (acceptPlan.data !== undefined && !acceptPlan.data.ok);
  const acceptNotice = suppressAccept
    ? null
    : planAcceptNotice(acceptOutcome, acceptErrored);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Shell dialog chrome: solid surface + hairline + the sanctioned
       * backdrop-blur-none override that beats the dialog base's blur-sm
       * (THE PROTOCOL DESK never uses glass — see shell-design-guard). */}
      <DialogContent
        data-vex-area="plan-display-modal"
        className="max-w-lg rounded-xl border-[var(--vex-line-strong)] bg-[var(--vex-surface-2)] text-foreground shadow-none backdrop:bg-black/70 backdrop:backdrop-blur-none"
      >
        <DialogHeader className="flex-row items-center justify-between gap-3">
          <DialogTitle className="text-base">Action plan</DialogTitle>
          {hasPlan ? (
            <span
              data-vex-state={pending ? "pending" : "accepted"}
              className={
                pending
                  ? "shrink-0 text-[11px] font-medium text-warning"
                  : "shrink-0 text-[11px] font-medium text-success"
              }
            >
              {pending ? "Pending your acceptance" : "Accepted"}
            </span>
          ) : null}
        </DialogHeader>

        <DialogBody>
          {enabled ? (
            <p className="text-xs text-[var(--vex-text-2)]">
              The agent researches first, writes an action plan (the “HOW”), and
              waits for your acceptance before executing.
            </p>
          ) : null}
          {hasPlan ? (
            // Recessed well — the plan reads like a filed document.
            <div className="rounded-[6px] border border-[var(--vex-line)] bg-[var(--vex-surface-down)] px-3 py-2">
              <MarkdownContent text={plan?.planMd ?? ""} />
            </div>
          ) : (
            <p className="text-sm text-[var(--vex-text-3)]">
              No action plan has been authored yet.
            </p>
          )}
          {pending && suppressAccept ? (
            <p className="text-[11px] text-[var(--vex-text-3)]">
              Accept this plan together with the contract.
            </p>
          ) : null}
        </DialogBody>

        {showAcceptButton || awaitingResume || acceptNotice !== null ? (
          <DialogFooter className="flex-col items-stretch gap-2 sm:flex-col">
            <div className="flex flex-wrap items-center gap-2">
              {awaitingResume ? (
                <span className="mr-auto text-[11px] text-warning">
                  Accepted, but the run didn’t resume.
                </span>
              ) : null}
              {showAcceptButton ? (
                <button
                  type="button"
                  disabled={acceptBusy}
                  onClick={() =>
                    acceptPlan.mutate({
                      sessionId,
                      expectedPlanMd: plan?.planMd ?? "",
                    })
                  }
                  className={ACTION_KEY}
                >
                  {acceptBusy ? "Accepting…" : "Accept plan"}
                </button>
              ) : null}
              {awaitingResume ? (
                <button
                  type="button"
                  disabled={resumeBusy}
                  onClick={() => requestResume.mutate({ sessionId })}
                  className={ACTION_KEY}
                >
                  {resumeBusy ? "Resuming…" : "Resume mission"}
                </button>
              ) : null}
            </div>
            {acceptNotice !== null ? (
              <p
                role="alert"
                data-vex-state="plan-accept-notice"
                className="w-full text-xs text-warning"
              >
                {acceptNotice}
              </p>
            ) : null}
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Map a standalone `plan.accept` attempt to a user-facing notice.
 *
 * Mirrors `MissionContractModal.acceptNoticeFor`: a resolved non-success
 * `outcome` (handled IPC Result) or a rejected mutation (`isError`, transport
 * failure with no `data`) both surface copy so the user never clicks
 * "Accept plan" and sees nothing. `accepted` → null (the plan refetch reflects
 * success).
 */
function planAcceptNotice(
  outcome: PlanAcceptResult["outcome"] | null,
  isError: boolean,
): string | null {
  if (outcome !== null) {
    switch (outcome) {
      case "accepted":
        return null;
      case "stale":
        return "Plan changed — review again before accepting.";
      case "no_plan":
        return "No plan authored yet — ask Vex to write a plan first.";
      case "not_found":
        return "Couldn't accept: this session no longer exists. Refresh and try again.";
      default:
        return assertNever(outcome);
    }
  }
  if (isError) {
    return "Couldn't accept the plan — something went wrong. Try again.";
  }
  return null;
}
