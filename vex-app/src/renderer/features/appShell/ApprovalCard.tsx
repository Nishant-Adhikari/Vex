/**
 * Inline approval card (F3 — restricted-mode unblock).
 *
 * Shown by `ApprovalsRegion` between the transcript and the composer when the
 * agent's mutating tool call paused the run at `paused_approval` and the
 * backend enqueued an approval. Backend is live (puzzle-5 phase-3):
 * `useApprove`/`useReject` → `window.vex.approvals.{approve,reject}` →
 * `prepareApprove`/`prepareReject` → background `runResumeAfterDecision`.
 *
 * UX (per vex-ui-ux-quality + vex-provider-hot-wallet skills):
 *   - Default focus on Reject (least destructive) when this card is the
 *     FIRST newly-appearing one (parent decides via `focusOnMount`).
 *   - Two-step confirm for high-risk: `riskLevel ∈ {high,critical}` OR
 *     `actionKind ∈ {destructive,user_wallet_broadcast}`. First click arms,
 *     second click within CONFIRM_RESET_MS fires; timeout resets.
 *   - On success: invalidate pending / history (prefix) / messages
 *     (transcript) / runtime — the engine resume can flip status + write
 *     new transcript rows.
 *   - `useApprove`/`useReject` already use `retry: false`; we DO NOT auto-
 *     retry a dangerous action.
 *   - `Result.ok === false` surfaces as an inline error (TanStack `isError`
 *     does not catch application-level `Result` failures — Codex F3 #1).
 *   - `aria-live="polite"` so screen readers announce the card without
 *     stealing focus from existing content.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { JSX } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { ApprovalSummaryDto } from "@shared/schemas/approvals.js";
import { useApprove, useReject } from "../../lib/api/approvals.js";
import {
  approvalsKeys,
  messagesKeys,
  runtimeKeys,
} from "../../lib/api/queryKeys.js";

const HIGH_RISK_LEVELS = new Set(["high", "critical"]);
const HIGH_RISK_ACTION_KINDS = new Set([
  "destructive",
  "user_wallet_broadcast",
]);
const CONFIRM_RESET_MS = 4_000;

export interface ApprovalCardProps {
  readonly summary: ApprovalSummaryDto;
  readonly sessionId: string;
  /**
   * When true on initial mount, focus the Reject button. Parent computes this
   * for the FIRST newly-appearing card to honour the UX skill's "default focus
   * on least destructive" without stealing focus on every refetch.
   */
  readonly focusOnMount: boolean;
}

export function ApprovalCard({
  summary,
  sessionId,
  focusOnMount,
}: ApprovalCardProps): JSX.Element {
  const queryClient = useQueryClient();
  const approve = useApprove();
  const reject = useReject();
  const rejectRef = useRef<HTMLButtonElement | null>(null);

  const isHighRisk = useMemo(() => {
    if (
      summary.riskLevel !== null &&
      HIGH_RISK_LEVELS.has(summary.riskLevel)
    ) {
      return true;
    }
    if (
      summary.actionKind !== null &&
      HIGH_RISK_ACTION_KINDS.has(summary.actionKind)
    ) {
      return true;
    }
    return false;
  }, [summary.riskLevel, summary.actionKind]);

  // Two-step confirm for high-risk. First click arms; second within
  // CONFIRM_RESET_MS fires. Switching buttons (or timeout) resets.
  const [armedAction, setArmedAction] = useState<"approve" | "reject" | null>(
    null,
  );
  useEffect(() => {
    if (armedAction === null) return;
    const t = setTimeout(() => setArmedAction(null), CONFIRM_RESET_MS);
    return () => clearTimeout(t);
  }, [armedAction]);

  // Focus Reject only ONCE per Codex constraint #3 — empty deps so a refetch
  // that rerenders this card never refocuses (other components may have stolen
  // focus deliberately, e.g. user is typing in the composer).
  useEffect(() => {
    if (focusOnMount) rejectRef.current?.focus();
    // Intentionally empty deps — first-mount focus only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [inlineError, setInlineError] = useState<string | null>(null);
  const inFlight = approve.isPending || reject.isPending;

  const invalidateOnResolve = async (): Promise<void> => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: approvalsKeys.pending(sessionId),
      }),
      // history prefix (limit varies): match every history query for this session.
      queryClient.invalidateQueries({
        queryKey: ["approvals", "history", sessionId] as const,
      }),
      queryClient.invalidateQueries({
        queryKey: messagesKeys.forSession(sessionId),
      }),
      queryClient.invalidateQueries({
        queryKey: runtimeKeys.state(sessionId),
      }),
    ]);
  };

  const fireApprove = (): void => {
    setInlineError(null);
    approve.mutate(
      { id: summary.id },
      {
        onSuccess: async (result) => {
          if (result.ok) {
            setArmedAction(null);
            await invalidateOnResolve();
          } else {
            setInlineError(result.error.message);
          }
        },
        onError: (e) => setInlineError(e.message),
      },
    );
  };

  const fireReject = (): void => {
    setInlineError(null);
    reject.mutate(
      { id: summary.id },
      {
        onSuccess: async (result) => {
          if (result.ok) {
            setArmedAction(null);
            await invalidateOnResolve();
          } else {
            setInlineError(result.error.message);
          }
        },
        onError: (e) => setInlineError(e.message),
      },
    );
  };

  const onApproveClick = (): void => {
    if (inFlight) return;
    if (isHighRisk && armedAction !== "approve") {
      setArmedAction("approve");
      return;
    }
    fireApprove();
  };
  const onRejectClick = (): void => {
    if (inFlight) return;
    if (isHighRisk && armedAction !== "reject") {
      setArmedAction("reject");
      return;
    }
    fireReject();
  };

  const titleId = `approval-card-${summary.id}-title`;
  const previewTool = summary.preview?.toolName ?? null;
  const namespace = summary.preview?.namespace ?? null;
  const toolName = previewTool ?? summary.toolName ?? "(unknown tool)";
  const criticalArgs = summary.preview?.criticalArgs ?? null;

  return (
    <section
      role="region"
      aria-labelledby={titleId}
      aria-live="polite"
      data-vex-area="approval-card"
      data-approval-id={summary.id}
      className="mt-3 overflow-hidden rounded-lg border border-white/[0.10] bg-white/[0.035] text-sm text-[var(--color-text-secondary)] backdrop-blur-xl"
    >
      <header className="flex flex-wrap items-center gap-2 border-b border-white/[0.08] px-4 py-3">
        <div className="min-w-0 flex-1">
          <h3
            id={titleId}
            className="truncate font-medium text-[var(--color-text-primary)]"
          >
            Approval needed:{" "}
            <span className="font-mono">
              {namespace !== null ? `${namespace}:${toolName}` : toolName}
            </span>
          </h3>
        </div>
        {summary.riskLevel !== null ? (
          <span
            data-testid="risk-chip"
            className={`shrink-0 rounded-md px-2 py-0.5 text-xs font-medium uppercase tracking-wide ${riskChipClasses(
              summary.riskLevel,
            )}`}
          >
            {summary.riskLevel}
          </span>
        ) : null}
        {summary.actionKind !== null ? (
          <span
            data-testid="action-chip"
            className="shrink-0 rounded-md border border-white/[0.10] px-2 py-0.5 text-xs uppercase tracking-wide"
          >
            {summary.actionKind}
          </span>
        ) : null}
      </header>
      <div className="space-y-3 px-4 py-3">
        {summary.reasoningPreview.trim().length > 0 ? (
          <p className="italic text-[var(--color-text-secondary)]">
            {summary.reasoningPreview}
          </p>
        ) : null}
        {criticalArgs !== null && Object.keys(criticalArgs).length > 0 ? (
          <dl
            data-testid="critical-args"
            className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-xs"
          >
            {Object.entries(criticalArgs).map(([k, v]) => (
              // `display: contents` keeps the grid layout while giving each
              // pair a stable React key.
              <div key={k} className="contents">
                <dt className="uppercase tracking-wide text-[var(--color-text-tertiary)]">
                  {k}
                </dt>
                <dd className="break-all font-mono">{String(v)}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        {inlineError !== null ? (
          <p role="alert" className="text-xs text-destructive">
            {inlineError}
          </p>
        ) : null}
      </div>
      <footer className="flex items-center justify-end gap-2 border-t border-white/[0.08] px-4 py-3">
        <button
          ref={rejectRef}
          type="button"
          onClick={onRejectClick}
          disabled={inFlight}
          aria-label={
            isHighRisk && armedAction === "reject"
              ? "Confirm reject"
              : "Reject"
          }
          className="rounded-md border border-white/[0.10] px-3 py-1.5 text-xs hover:bg-white/[0.05] disabled:opacity-50"
        >
          {isHighRisk && armedAction === "reject"
            ? "Click again to confirm reject"
            : "Reject"}
        </button>
        <button
          type="button"
          onClick={onApproveClick}
          disabled={inFlight}
          aria-label={
            isHighRisk && armedAction === "approve"
              ? "Confirm approve"
              : "Approve"
          }
          className={`rounded-md px-3 py-1.5 text-xs font-medium ${
            isHighRisk
              ? "border border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/15"
              : "border border-emerald-500/40 bg-emerald-500/10 hover:bg-emerald-500/15"
          } disabled:opacity-50`}
        >
          {isHighRisk && armedAction === "approve"
            ? "Click again to confirm approve"
            : "Approve"}
        </button>
      </footer>
    </section>
  );
}

function riskChipClasses(level: string): string {
  switch (level) {
    case "critical":
      return "border border-red-500/40 bg-red-500/10 text-red-300";
    case "high":
      return "border border-amber-500/40 bg-amber-500/10 text-amber-300";
    case "medium":
      return "border border-yellow-500/30 bg-yellow-500/10 text-yellow-300";
    case "low":
      return "border border-blue-500/30 bg-blue-500/10 text-blue-300";
    default:
      return "border border-white/[0.10] bg-white/[0.05]";
  }
}
