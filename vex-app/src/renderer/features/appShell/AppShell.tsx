/**
 * Main app shell — THE SIGNAL DESK (the landing's design language, opened
 * for business).
 *
 * Onboarding proved identity in a dark room (one light, one signature);
 * the shell is the working register that signature unlocked. Same ink
 * canvas (#0a0d18 via --vex-surface-0), zero photography, zero resting
 * glow: depth comes from the three solid luminance steps defined by the
 * [data-vex-shell] scope in globals.css, separated by hairlines. The one
 * sanctioned gradient is the selection beam (.vex-select-beam).
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
import { HugeiconsIcon } from "@hugeicons/react";
import {
  PanelRightCloseIcon,
  PanelRightOpenIcon,
} from "@hugeicons/core-free-icons";
import { useUiStore } from "../../stores/uiStore.js";
import { BookPanel } from "./BookPanel.js";
import { DeskRuleTapeState } from "./DeskRuleTapeState.js";
import { MissionRail } from "./MissionRail.js";
import { useAutoCollapseBook } from "./useAutoCollapseBook.js";
import { SessionCreator } from "./SessionCreator.js";
import { SessionPanel } from "./SessionPanel.js";
import { SessionsLibrary } from "./SessionsLibrary.js";
import { SessionsList } from "./SessionsList.js";
import { SidebarIconButton } from "./SessionRows.js";
import { MemoryPanel } from "./MemoryPanel.js";

export function AppShell(): JSX.Element {
  const appShellView = useUiStore((s) => s.appShellView);
  const activeSessionId = useUiStore((s) => s.activeSessionId);
  const bookOpen = useUiStore((s) => s.bookOpen);
  const toggleBook = useUiStore((s) => s.toggleBook);
  const createSessionOpen = useUiStore((s) => s.createSessionOpen);
  const openCreateSession = useUiStore((s) => s.openCreateSession);
  const closeCreateSession = useUiStore((s) => s.closeCreateSession);

  // Stage F responsive: below ~1360px the four columns (sidebar + chat + rail +
  // BOOK) no longer fit, so auto-collapse BOOK on the narrowing edge. One-way on
  // the transition (not continuously enforced) so a user can still re-open BOOK
  // inside a narrow window — we don't fight a manual toggle.
  useAutoCollapseBook();

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
              // Collapse/expand chevron — same affordance as the sidebar's
              // PanelLeft toggle, mirrored to the right panel (PanelRight). The
              // version stamp now lives in the BookPanel collapse header; the
              // BookPanel itself carries a matching chevron, so both call the
              // same toggleBook.
              <SidebarIconButton
                label={
                  bookOpen ? "Collapse the BOOK panel" : "Expand the BOOK panel"
                }
                onClick={toggleBook}
              >
                <HugeiconsIcon
                  icon={bookOpen ? PanelRightCloseIcon : PanelRightOpenIcon}
                  size={17}
                  aria-hidden
                />
              </SidebarIconButton>
            ) : null}
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

      {appShellView === "session" ? (
        <MissionRail activeSessionId={activeSessionId} />
      ) : null}

      {appShellView === "session" ? (
        // Always mounted in session view — the panel owns its collapsed state
        // (a thin spine + version stamp) so toggling never remounts it or
        // replays the slide-in keyframe.
        <BookPanel
          activeSessionId={activeSessionId}
          bookOpen={bookOpen}
          onToggle={toggleBook}
        />
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
