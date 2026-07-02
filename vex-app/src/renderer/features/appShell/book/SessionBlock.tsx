/**
 * SESSION — the session's metadata at a glance: mode, access, mission status,
 * created. Built on existing IPC (`sessions.get`) + the pure sessionListModel
 * helpers. Wallet holdings live in the POSITION block, not here.
 */

import type { JSX, ReactNode } from "react";
import { useSession } from "../../../lib/api/sessions.js";
import { cn } from "../../../lib/utils.js";
import { formatSessionTime, getMissionActivity } from "../sessionListModel.js";
import { BookBlock } from "./BookBlock.js";

/** Landing .ws-stat row: key muted / value white, hairline-separated. */
function Row({ label, children }: { readonly label: string; readonly children: ReactNode }): JSX.Element {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-[var(--vex-line)] py-1.5 last:border-b-0">
      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--vex-text-3)]">
        {label}
      </span>
      <span className="min-w-0 truncate text-right font-mono text-[11px] tabular-nums text-[var(--vex-text)]">
        {children}
      </span>
    </div>
  );
}

export function SessionBlock({ sessionId }: { readonly sessionId: string }): JSX.Element {
  const query = useSession(sessionId);
  const session = query.data?.ok ? query.data.data : null;

  if (session === null) {
    return (
      <BookBlock title="Session">
        <p className="text-[11px] text-[var(--vex-text-3)]">
          {query.isLoading ? "Loading…" : "Unavailable."}
        </p>
      </BookBlock>
    );
  }

  const activity = getMissionActivity(session);
  return (
    <BookBlock title="Session">
      <div className="flex flex-col">
        <Row label="Mode">{session.mode === "mission" ? "Mission" : "Agent"}</Row>
        <Row label="Access">{session.permission === "full" ? "Full" : "Restricted"}</Row>
        {activity !== null ? (
          <Row label="Status">
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden className={cn("h-1.5 w-1.5 rounded-full", activity.dotClass)} />
              {activity.label}
            </span>
          </Row>
        ) : null}
        <Row label="Started">{formatSessionTime(session.startedAt)}</Row>
      </div>
    </BookBlock>
  );
}
