/**
 * Browse-all view for the sessions sidebar (Phase 1).
 *
 * Replaces `SessionPanel` in the panel area when
 * `uiStore.appShellView === "sessionsLibrary"`. Renders the full session
 * list (DB cap 100) inside a custom-scrollbar container — sidebar
 * fit-to-height hides anything past the visible budget, so this view is
 * the canonical way to reach an older session that did not make the cut.
 *
 * Re-uses `SessionGroups` so badges, mission status, and pin toggles
 * stay visually consistent with the sidebar rows.
 */

import { useCallback, useMemo } from "react";
import type { JSX } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  AlertCircleIcon,
  ArrowLeft01Icon,
} from "@hugeicons/core-free-icons";
import { cn } from "../../lib/utils.js";
import {
  useSessionsList,
  useSetSessionPinned,
} from "../../lib/api/sessions.js";
import { useUiStore } from "../../stores/uiStore.js";
import { SessionGroups } from "./SessionRows.js";
import {
  filterSessionsByMode,
  groupSessions,
} from "./sessionListModel.js";

export function SessionsLibrary(): JSX.Element {
  const activeSessionId = useUiStore((s) => s.activeSessionId);
  const setActiveSessionId = useUiStore((s) => s.setActiveSessionId);
  const setAppShellView = useUiStore((s) => s.setAppShellView);
  const sessionModeFilter = useUiStore((s) => s.sessionModeFilter);
  const query = useSessionsList();
  const pinMutation = useSetSessionPinned();
  const pendingPinId =
    pinMutation.isPending && pinMutation.variables
      ? pinMutation.variables.id
      : null;

  const groups = useMemo(() => {
    if (!query.data?.ok) return [];
    return groupSessions(
      filterSessionsByMode(query.data.data, sessionModeFilter),
    );
  }, [query.data, sessionModeFilter]);

  const totalRows = useMemo(
    () => groups.reduce((sum, g) => sum + g.rows.length, 0),
    [groups],
  );

  const handleBack = useCallback((): void => {
    setAppShellView("session");
  }, [setAppShellView]);

  const handleSelect = useCallback(
    (id: string): void => {
      setActiveSessionId(id);
      setAppShellView("session");
    },
    [setActiveSessionId, setAppShellView],
  );

  const handleTogglePin = useCallback(
    (id: string, nextPinned: boolean): void => {
      pinMutation.mutate({ id, pinned: nextPinned });
    },
    [pinMutation],
  );

  return (
    <div
      className="flex h-full min-h-0 w-full flex-col px-8 py-10 sm:px-12 lg:px-20"
      data-vex-screen="sessions-library"
    >
      <header className="mb-6 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleBack}
            aria-label="Back to session panel"
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/[0.06] bg-white/[0.025] text-[var(--color-text-secondary)] transition-colors hover:bg-white/[0.07] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3275f8]"
          >
            <HugeiconsIcon icon={ArrowLeft01Icon} size={17} aria-hidden />
          </button>
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight">All sessions</h1>
            <p className="text-sm text-[var(--color-text-secondary)]">
              {totalRows === 0
                ? "No sessions yet."
                : `${totalRows} session${totalRows === 1 ? "" : "s"} stored locally.`}
            </p>
          </div>
        </div>
      </header>

      <section
        aria-label="Sessions library"
        className={cn(
          "vex-scroll min-h-0 flex-1 overflow-y-auto rounded-2xl border border-white/[0.05] bg-[#061026]/40 p-4 backdrop-blur-2xl",
        )}
      >
        {query.isLoading ? (
          <p className="text-sm text-[var(--color-text-secondary)]">
            Loading sessions…
          </p>
        ) : query.data && query.data.ok === false ? (
          <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            <HugeiconsIcon icon={AlertCircleIcon} size={15} aria-hidden />
            <span>{query.data.error.message}</span>
          </div>
        ) : totalRows === 0 ? (
          <p className="text-sm text-[var(--color-text-secondary)]">
            Create a session from the sidebar to get started.
          </p>
        ) : (
          <SessionGroups
            groups={groups}
            activeSessionId={activeSessionId}
            sidebarOpen
            onSelect={handleSelect}
            onTogglePin={handleTogglePin}
            pendingPinId={pendingPinId}
            idPrefix="library-sessions"
          />
        )}
      </section>
    </div>
  );
}
