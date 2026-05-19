import { useCallback, useMemo } from "react";
import type { JSX } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Add01Icon,
  FilterHorizontalIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
} from "@hugeicons/core-free-icons";
import { cn } from "../../lib/utils.js";
import { useSessionsList } from "../../lib/api/sessions.js";
import { useUiStore } from "../../stores/uiStore.js";
import { EditInfrastructureButton } from "./EditInfrastructureButton.js";
import { ReportIssueButton } from "./ReportIssueButton.js";
import {
  SessionGroups,
  SessionsEmptyPlaceholder,
  SessionsErrorPlaceholder,
  SessionsLoadingPlaceholder,
  SidebarIconButton,
} from "./SessionRows.js";
import {
  filterSessionsByMode,
  groupSessions,
  SESSION_MODE_FILTERS,
} from "./sessionListModel.js";

interface SessionsListProps {
  readonly onCreate: () => void;
}

export function SessionsList({ onCreate }: SessionsListProps): JSX.Element {
  const activeSessionId = useUiStore((s) => s.activeSessionId);
  const setActiveSessionId = useUiStore((s) => s.setActiveSessionId);
  const sidebarOpen = useUiStore((s) => s.sidebarOpen);
  const setSidebarOpen = useUiStore((s) => s.setSidebarOpen);
  const sessionModeFilter = useUiStore((s) => s.sessionModeFilter);
  const setSessionModeFilter = useUiStore((s) => s.setSessionModeFilter);
  const query = useSessionsList();

  const visibleRows = useMemo(() => {
    if (!query.data?.ok) return [];
    return filterSessionsByMode(query.data.data, sessionModeFilter);
  }, [query.data, sessionModeFilter]);

  const groups = useMemo(() => groupSessions(visibleRows), [visibleRows]);

  const handleSelect = useCallback(
    (id: string): void => {
      setActiveSessionId(id);
    },
    [setActiveSessionId],
  );

  const toggleSidebar = useCallback((): void => {
    setSidebarOpen(!sidebarOpen);
  }, [setSidebarOpen, sidebarOpen]);

  return (
    <aside
      className={cn(
        "relative z-10 flex h-full shrink-0 flex-col border-r border-white/[0.045] bg-[#030916]/[0.16] pb-12 shadow-[inset_-1px_0_0_rgba(255,255,255,0.025),0_0_48px_rgba(0,0,0,0.16)] backdrop-blur-xl backdrop-saturate-150 transition-[width] duration-300",
        sidebarOpen ? "w-[296px]" : "w-[72px]",
      )}
      data-vex-area="sessions-sidebar"
      data-vex-sidebar-open={sidebarOpen ? "true" : "false"}
    >
      <header
        className={cn(
          "flex h-16 items-center border-b border-white/[0.045]",
          sidebarOpen ? "justify-between px-4" : "justify-center px-2",
        )}
      >
        <div className={cn("flex min-w-0 items-center gap-3", !sidebarOpen && "hidden")}>
          <img
            src="/vex.jpg"
            alt=""
            draggable={false}
            className="h-9 w-9 rounded-full object-cover ring-1 ring-[#3275f8]/42"
          />
          <span className="truncate text-sm font-semibold tracking-tight">
            Vex
          </span>
        </div>
        <SidebarIconButton
          label={sidebarOpen ? "Collapse sessions sidebar" : "Expand sessions sidebar"}
          onClick={toggleSidebar}
        >
          <HugeiconsIcon
            icon={sidebarOpen ? PanelLeftCloseIcon : PanelLeftOpenIcon}
            size={17}
            aria-hidden
          />
        </SidebarIconButton>
      </header>

      <div className={cn("border-b border-white/[0.045] p-3", !sidebarOpen && "px-2")}>
        <button
          type="button"
          onClick={onCreate}
          className={cn(
            "flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-[#3275f8]/32 bg-[#3275f8]/10 text-sm font-medium text-[#6f91ff] transition-colors hover:bg-[#3275f8]/16 hover:text-[#9bb2ff] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3275f8]",
            sidebarOpen ? "px-3" : "px-0",
          )}
          aria-label="New session"
        >
          <HugeiconsIcon icon={Add01Icon} size={17} aria-hidden />
          {sidebarOpen ? <span>New session</span> : null}
        </button>
      </div>

      {sidebarOpen ? (
        <div className="border-b border-white/[0.045] px-3 py-3">
          <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--color-text-muted)]">
            <HugeiconsIcon icon={FilterHorizontalIcon} size={13} aria-hidden />
            <span>Sessions</span>
          </div>
          <div
            role="tablist"
            aria-label="Filter sessions"
            className="grid grid-cols-3 rounded-lg border border-white/[0.045] bg-white/[0.025] p-1"
          >
            {SESSION_MODE_FILTERS.map((filter) => (
              <button
                key={filter.value}
                type="button"
                role="tab"
                aria-selected={sessionModeFilter === filter.value}
                onClick={() => setSessionModeFilter(filter.value)}
                className={cn(
                  "h-8 rounded-md text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3275f8]",
                  sessionModeFilter === filter.value
                    ? "bg-[#3275f8]/18 text-foreground shadow-[0_0_18px_rgba(50,117,248,0.12)]"
                    : "text-[var(--color-text-secondary)] hover:bg-white/[0.055] hover:text-foreground",
                )}
              >
                {filter.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3 [scrollbar-gutter:stable]">
        {query.isLoading ? (
          <SessionsLoadingPlaceholder sidebarOpen={sidebarOpen} />
        ) : query.data && query.data.ok === false ? (
          <SessionsErrorPlaceholder
            sidebarOpen={sidebarOpen}
            message={query.data.error.message}
          />
        ) : query.data && query.data.ok ? (
          visibleRows.length === 0 ? (
            <SessionsEmptyPlaceholder sidebarOpen={sidebarOpen} />
          ) : (
            <SessionGroups
              groups={groups}
              activeSessionId={activeSessionId}
              sidebarOpen={sidebarOpen}
              onSelect={handleSelect}
            />
          )
        ) : null}
      </div>

      <footer
        className={cn(
          "flex border-t border-white/[0.045] p-3",
          sidebarOpen ? "items-center justify-between gap-2" : "flex-col gap-2 px-2",
        )}
      >
        <EditInfrastructureButton compact={!sidebarOpen} />
        <ReportIssueButton compact={!sidebarOpen} />
      </footer>
    </aside>
  );
}
