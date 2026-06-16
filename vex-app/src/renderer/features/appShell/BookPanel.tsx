/**
 * BOOK — the on-demand right-side instrument panel (a new <aside> sibling in the
 * AppShell <main> flex row). Per-session register: MOVES (what the agent did),
 * RUNTIME & COST (model/context/usage/compaction), SESSION (metadata). The
 * global no-session POSITION view + the in-session scoped POSITION block land in
 * Stage 4 (new portfolio IPC).
 *
 * Mode is a pure derivation of `activeSessionId`: null = welcome (global), else
 * the open session (scoped). Signal Tape language: surface-1, hairline border-l,
 * blue rationed to the content. Slides in via a CSP-safe one-shot keyframe
 * (`vex-book-enter`); reduced motion collapses it to the final frame.
 */

import type { JSX } from "react";
import { SessionRuntimeBar } from "./SessionRuntimeBar.js";
import { BookBlock } from "./book/BookBlock.js";
import { MovesBlock } from "./book/MovesBlock.js";
import { SessionBlock } from "./book/SessionBlock.js";

export function BookPanel({
  activeSessionId,
}: {
  readonly activeSessionId: string | null;
}): JSX.Element {
  return (
    <aside
      data-vex-area="book-panel"
      aria-label="Session instrument"
      className="vex-book-enter flex h-full w-[320px] shrink-0 flex-col overflow-y-auto border-l border-[var(--vex-line)] bg-[var(--vex-surface-1)]"
    >
      {activeSessionId !== null ? (
        <>
          <MovesBlock sessionId={activeSessionId} />
          <BookBlock title="Runtime & Cost">
            <SessionRuntimeBar sessionId={activeSessionId} layout="stack" />
          </BookBlock>
          <SessionBlock sessionId={activeSessionId} />
          {/* POSITION (session-scoped) — Stage 4 (new portfolio IPC). */}
        </>
      ) : (
        // Global portfolio (no active session) — POSITION lands in Stage 4.
        <BookBlock title="Portfolio">
          <p className="text-[11px] text-[var(--vex-text-3)]">
            Your portfolio appears here.
          </p>
        </BookBlock>
      )}
    </aside>
  );
}
