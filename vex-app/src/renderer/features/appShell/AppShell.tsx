/**
 * Main app shell — THE PROTOCOL DESK (Countersign, opened for business).
 *
 * Onboarding proved identity in a dark room (one light, one signature);
 * the shell is the working register that signature unlocked. Same canvas
 * (#04060f via --vex-surface-0), zero photography, zero gradients, zero
 * resting glow: depth comes from the three solid luminance steps defined
 * by the [data-vex-shell] scope in globals.css, separated by hairlines.
 *
 * Layout: sidebar rail (SessionsList) | content column under the DESK RULE
 * | optional on-demand BOOK panel (right <aside>, gated on bookOpen). The
 * DESK RULE (h-12 header) carries the live tape-state word (left) plus the
 * BOOK toggle + version stamp (right); its bottom-hairline accent tick sits
 * over the left-anchored transcript spine.
 *
 * `data-vex-shell="true"` scopes the Protocol Desk tokens (sibling of
 * data-vex-onboarding); `data-vex-screen="appShell"` stays the e2e/test
 * selector. The window keeps its native OS frame, so no -webkit-app-region
 * drag strip is mounted (S0 decision — revisit only if the frame goes
 * custom).
 */

import type { JSX } from "react";
import { useUiStore } from "../../stores/uiStore.js";
import { cn } from "../../lib/utils.js";
import { BookPanel } from "./BookPanel.js";
import { DeskRuleTapeState } from "./DeskRuleTapeState.js";
import { SessionCreator } from "./SessionCreator.js";
import { SessionPanel } from "./SessionPanel.js";
import { SessionsLibrary } from "./SessionsLibrary.js";
import { SessionsList } from "./SessionsList.js";
import { MemoryPanel } from "./MemoryPanel.js";

export function AppShell(): JSX.Element {
  const appShellView = useUiStore((s) => s.appShellView);
  const activeSessionId = useUiStore((s) => s.activeSessionId);
  const bookOpen = useUiStore((s) => s.bookOpen);
  const toggleBook = useUiStore((s) => s.toggleBook);
  const createSessionOpen = useUiStore((s) => s.createSessionOpen);
  const openCreateSession = useUiStore((s) => s.openCreateSession);
  const closeCreateSession = useUiStore((s) => s.closeCreateSession);

  return (
    <main
      className="flex h-screen w-screen overflow-hidden bg-[var(--vex-surface-0)] text-foreground"
      data-vex-shell="true"
      data-vex-screen="appShell"
    >
      <SessionsList onCreate={() => openCreateSession()} />

      <section className="flex min-w-0 flex-1 flex-col">
        {/* DESK RULE — the working header datum and the head of the tape: its
         * accent tick sits over the left-anchored spine, with the live tape
         * state on the left and the version stamp pinned right. The rule itself
         * never moves; only the tape-state word changes. */}
        <header className="relative flex h-12 shrink-0 items-center gap-3 border-b border-[var(--vex-line)] px-6">
          <span
            aria-hidden
            className="absolute -bottom-px left-6 h-px w-6 bg-[var(--vex-accent)]"
          />
          <DeskRuleTapeState />
          <div className="ml-auto flex items-center gap-3">
            {appShellView === "session" ? (
              <button
                type="button"
                onClick={toggleBook}
                aria-pressed={bookOpen}
                aria-label={bookOpen ? "Hide the BOOK panel" : "Show the BOOK panel"}
                className={cn(
                  "rounded-md border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.28em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vex-accent)]",
                  bookOpen
                    ? "border-[var(--vex-accent-border)] bg-[var(--vex-accent-fill-8)] text-[var(--vex-accent-text)]"
                    : "border-[var(--vex-line-strong)] text-[var(--vex-text-3)] hover:text-[var(--vex-text-2)]",
                )}
              >
                Book
              </button>
            ) : null}
            <span className="font-mono text-[10px] uppercase tracking-[0.28em] text-[var(--vex-text-3)]">
              v{__VEX_APP_VERSION__}
            </span>
          </div>
        </header>

        <div className="min-h-0 flex-1">
          {appShellView === "sessionsLibrary" ? (
            <SessionsLibrary />
          ) : appShellView === "memory" ? (
            <MemoryPanel />
          ) : (
            <SessionPanel />
          )}
        </div>
      </section>

      {bookOpen && appShellView === "session" ? (
        <BookPanel activeSessionId={activeSessionId} />
      ) : null}

      <SessionCreator
        open={createSessionOpen}
        onOpenChange={(next) => {
          if (!next) closeCreateSession();
        }}
      />
    </main>
  );
}
