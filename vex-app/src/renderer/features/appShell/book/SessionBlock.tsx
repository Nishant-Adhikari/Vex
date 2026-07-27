/**
 * SESSION — the session's metadata, read as part of MISSION CONTROL rather than
 * a tall block of its own. Deliberately DENSE + DEDUPED against the
 * `MissionControlHeader` directly above it: the header already owns STATUS (its
 * pill) and the run's timing (RUNNING TIME / TIME LEFT), so those are NOT
 * repeated here. What remains is the genuinely session-level trio — MODE,
 * ACCESS, MISSION PNL — plus the run's END time (the one timestamp the header
 * does not surface once a run has finished). They lay out in a compact TWO-
 * COLUMN grid (short label/value pairs, two per row) so the section is roughly
 * half its former height. Built on existing IPC (`sessions.get` +
 * `mission.getSessionResult`); wallet holdings live in the POSITION block.
 */

import type { JSX, ReactNode } from "react";
import { useSession } from "../../../lib/api/sessions.js";
import { useMissionSessionResult } from "../../../lib/api/mission.js";
import { formatUsd } from "../../../lib/format.js";
import { pnlUsd } from "../missionHistoryModel.js";
import { formatSessionTime } from "../sessionListModel.js";
import { BookBlock, type BookBlockReorder } from "./BookBlock.js";

/**
 * One compact grid cell: muted micro-label stacked over its value. `wide`
 * spans both columns (for the PnL, whose "+$x (+y%)" reads poorly truncated
 * into a half-width cell).
 */
function Cell({
  label,
  wide = false,
  children,
}: {
  readonly label: string;
  readonly wide?: boolean;
  readonly children: ReactNode;
}): JSX.Element {
  return (
    <div className={wide ? "col-span-2 flex min-w-0 flex-col gap-0.5" : "flex min-w-0 flex-col gap-0.5"}>
      <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-[var(--vex-text-3)]">
        {label}
      </span>
      <span className="min-w-0 truncate font-mono text-[11px] tabular-nums text-[var(--vex-text)]">
        {children}
      </span>
    </div>
  );
}

export function SessionBlock({
  sessionId,
  collapsible = false,
  sectionId,
  reorder,
}: {
  readonly sessionId: string;
  readonly collapsible?: boolean;
  readonly sectionId?: string;
  readonly reorder?: BookBlockReorder;
}): JSX.Element {
  const query = useSession(sessionId);
  const session = query.data?.ok ? query.data.data : null;
  // The mission RUN's start/end (from the results ledger) — distinct from the
  // session's creation time below. Null for sessions with no finalized-or-live
  // mission run; a live run shows a start with a pending ("—") end.
  const resultQuery = useMissionSessionResult(sessionId);
  const missionResult = resultQuery.data?.ok ? resultQuery.data.data : null;

  if (session === null) {
    return (
      <BookBlock
        title="Session"
        collapsible={collapsible}
        sectionId={sectionId}
        reorder={reorder}
      >
        <p className="text-[11px] text-[var(--vex-text-3)]">
          {query.isLoading ? "Loading…" : "Unavailable."}
        </p>
      </BookBlock>
    );
  }

  // STATUS + the run's START/elapsed timing are already the
  // MissionControlHeader's job (its pill + RUNNING TIME / TIME LEFT), so they
  // are intentionally NOT repeated here. SESSION keeps only what the header
  // doesn't show: MODE, ACCESS, the run END time (once finished), and PnL.
  const endedAt =
    missionResult !== null && missionResult.endedAt !== null
      ? formatSessionTime(missionResult.endedAt)
      : null;
  return (
    <BookBlock
      title="Session"
      collapsible={collapsible}
      sectionId={sectionId}
      reorder={reorder}
    >
      {/* Compact two-column grid — short label/value pairs, two per row. */}
      <div className="grid grid-cols-2 gap-x-3 gap-y-2">
        <Cell label="Mode">{session.mode === "mission" ? "Mission" : "Agent"}</Cell>
        <Cell label="Access">
          {session.permission === "full" ? "Full" : "Restricted"}
        </Cell>
        {endedAt !== null ? <Cell label="Ended">{endedAt}</Cell> : null}
        {missionResult !== null && missionResult.pnlEth !== null ? (
          <Cell label="Mission PnL" wide>
            <span
              title={`${missionResult.pnlEth >= 0 ? "+" : ""}${missionResult.pnlEth.toFixed(4)} ETH`}
              className={
                missionResult.pnlEth >= 0
                  ? "text-[var(--color-success)]"
                  : "text-[var(--color-destructive)]"
              }
            >
              {(() => {
                const usd = pnlUsd(missionResult.pnlEth, missionResult.ethPriceUsdEnd);
                return usd !== null
                  ? `${usd >= 0 ? "+" : "-"}${formatUsd(Math.abs(usd))}`
                  : `${missionResult.pnlEth >= 0 ? "+" : ""}${missionResult.pnlEth.toFixed(4)} ETH`;
              })()}
              {missionResult.pnlPct !== null
                ? ` (${missionResult.pnlPct >= 0 ? "+" : ""}${missionResult.pnlPct.toFixed(2)}%)`
                : ""}
            </span>
          </Cell>
        ) : null}
      </div>
    </BookBlock>
  );
}
