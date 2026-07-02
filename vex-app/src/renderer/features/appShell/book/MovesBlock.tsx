/**
 * MOVES — the per-session feed of what the agent DID on-chain: executed trades
 * (swaps / fills) from the `proj_activity` projection, newest first.
 *
 * Reads the agent's REAL executed activity via `useMoves` (→ `portfolio.listMoves`),
 * NOT the approval history. Approval rows only exist for `restricted`-permission
 * sessions, so a `full`-permission mission that executed swaps has zero approval
 * rows but real `proj_activity` rows — this block now surfaces those.
 *
 * Rows are activity rows / fills (NOT executions): a batch capture legitimately
 * produces multiple fills per execution, so they are shown individually.
 *
 * Dot colour is a PURE client-side derivation over the tolerant `captureStatus`
 * string (executed/filled/closed/claimed → done; open/pending → pending;
 * cancelled/rejected → muted; failed → destructive; null/unknown → neutral).
 * Unknown statuses fall back gracefully — the derivation never throws.
 */

import type { JSX } from "react";
import type { MoveItem } from "@shared/schemas/portfolio-moves.js";
import { useMoves } from "../../../lib/api/portfolio.js";
import { formatClock } from "../../../lib/format.js";
import { cn } from "../../../lib/utils.js";
import { BookBlock } from "./BookBlock.js";

const MOVES_LIMIT = 20;

type MoveState = "pending" | "done" | "failed" | "cancelled" | "neutral";

/**
 * Pure derivation over the tolerant `captureStatus`. The engine emits values
 * like `executed`, `open`, `closed`, `cancelled`, `claimed`, `pending`,
 * `filled`. Unrecognised or `null` statuses fall back to `neutral` — never
 * throw.
 */
function moveState(captureStatus: string | null): MoveState {
  switch (captureStatus?.toLowerCase()) {
    case "executed":
    case "filled":
    case "closed":
    case "claimed":
      return "done";
    case "open":
    case "pending":
      return "pending";
    case "cancelled":
    case "canceled":
    case "rejected":
      return "cancelled";
    case "failed":
      return "failed";
    default:
      return "neutral";
  }
}

const DOT: Record<MoveState, string> = {
  pending: "bg-[var(--vex-accent)]",
  done: "bg-[var(--color-success)]",
  failed: "bg-[var(--color-destructive)]",
  cancelled: "bg-[var(--vex-text-3)]",
  neutral: "bg-[var(--vex-text-2)]",
};

/** Trade descriptor: `${side} ${in}→${out}`, tolerating null legs. */
function moveLabel(m: MoveItem): string {
  const side = m.tradeSide ?? "trade";
  const input = m.inputToken ?? "?";
  const output = m.outputToken ?? "?";
  return `${side} ${input}→${output}`;
}

export function MovesBlock({ sessionId }: { readonly sessionId: string }): JSX.Element {
  const query = useMoves(sessionId);
  const result = query.data;
  const allMoves = result?.ok ? result.data : [];
  const moves = allMoves.slice(0, MOVES_LIMIT);

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
        No moves yet — the agent&apos;s trades appear here.
      </p>
    );
  } else {
    body = (
      // Landing .ws-stat grammar: hairline-separated rows, mono figures.
      <ul className="flex flex-col">
        {moves.map((m) => {
          const state = moveState(m.captureStatus);
          const label = moveLabel(m);
          const time = formatClock(m.createdAt);
          return (
            <li
              key={m.id}
              className="flex items-center gap-2 border-b border-[var(--vex-line)] py-1 last:border-b-0"
            >
              {/* Pending = verifiably in-flight → the pulse ring loops; every
               * terminal state (done/failed/cancelled) rests still. */}
              <span
                aria-hidden
                className={cn(
                  "h-1.5 w-1.5 shrink-0 rounded-full",
                  DOT[state],
                  state === "pending" && "vex-pulse-dot",
                )}
              />
              <span
                className="min-w-0 flex-1 truncate font-mono text-[11px] text-[var(--vex-text)]"
                title={m.instrumentKey ?? undefined}
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
