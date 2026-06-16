/**
 * MOVES — the per-session feed of what the agent DID: privileged actions from
 * the approval history (swaps / transfers / signs / posts), newest first.
 *
 * Built entirely on existing IPC (`approvals.getHistory` via useApprovalHistory)
 * — no new main-process work. Status is a PURE client-side derivation over
 * (status, executionStatus, decision); blue is rationed to the live `pending`
 * state, semantic colours for done/failed, muted for rejected/approved.
 *
 * NB: `execution_result_hash` (not in this DTO) is a result digest, never a tx
 * hash — a richer moves feed with real tx links is deliberately out of scope.
 */

import type { JSX } from "react";
import type { ApprovalSummaryDto } from "@shared/schemas/approvals.js";
import { useApprovalHistory } from "../../../lib/api/approvals.js";
import { formatClock } from "../../../lib/format.js";
import { cn } from "../../../lib/utils.js";
import { BookBlock } from "./BookBlock.js";

const MOVES_LIMIT = 20;

type MoveState = "pending" | "done" | "failed" | "rejected" | "approved";

/** Pure derivation — see the (status, executionStatus, decision) contract. */
function moveState(m: ApprovalSummaryDto): MoveState {
  if (
    m.status === "rejected" ||
    m.decision === "rejected" ||
    m.decision === "rejected_stop"
  ) {
    return "rejected";
  }
  if (m.executionStatus === "failed") return "failed";
  if (m.executionStatus === "succeeded") return "done";
  if (
    m.status === "pending" ||
    m.executionStatus === "not_started" ||
    m.executionStatus === "dispatching"
  ) {
    return "pending";
  }
  return "approved";
}

const DOT: Record<MoveState, string> = {
  pending: "bg-[var(--vex-accent)]",
  done: "bg-[var(--color-success)]",
  failed: "bg-[var(--color-destructive)]",
  rejected: "bg-[var(--vex-text-3)]",
  approved: "bg-[var(--vex-text-2)]",
};

export function MovesBlock({ sessionId }: { readonly sessionId: string }): JSX.Element {
  const query = useApprovalHistory(sessionId, MOVES_LIMIT);
  const result = query.data;
  const moves = result?.ok ? result.data : [];

  let body: JSX.Element;
  if (query.isLoading) {
    body = (
      <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--vex-text-3)]">
        Loading…
      </p>
    );
  } else if (result !== undefined && !result.ok) {
    body = (
      <p className="text-[11px] text-[var(--vex-warn-text)]">
        Couldn&apos;t load moves.
      </p>
    );
  } else if (moves.length === 0) {
    body = (
      <p className="text-[11px] text-[var(--vex-text-3)]">
        No moves yet — the agent&apos;s actions appear here.
      </p>
    );
  } else {
    body = (
      <ul className="flex flex-col gap-1">
        {moves.map((m) => {
          const state = moveState(m);
          const label = m.toolName ?? m.actionKind ?? "action";
          const time = formatClock(m.resolvedAt ?? m.createdAt);
          return (
            <li key={m.id} className="flex items-center gap-2">
              <span
                aria-hidden
                className={cn("h-1.5 w-1.5 shrink-0 rounded-full", DOT[state])}
              />
              <span
                className="min-w-0 flex-1 truncate font-mono text-[11px] text-[var(--vex-text)]"
                title={m.reasoningPreview.length > 0 ? m.reasoningPreview : undefined}
              >
                {label}
              </span>
              {time !== null ? (
                <span className="shrink-0 font-mono text-[10px] tabular-nums text-[var(--vex-text-3)]">
                  {time}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <BookBlock title="Moves" trailing={moves.length > 0 ? String(moves.length) : undefined}>
      {body}
    </BookBlock>
  );
}
