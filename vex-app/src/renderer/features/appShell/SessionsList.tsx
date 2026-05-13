/**
 * Left sidebar — sessions list. Reads from `useSessionsList()`; selecting
 * a row sets `uiStore.activeSessionId` and hands control to SessionPanel.
 *
 * Row anatomy:
 *   - Mode badge (Agent | Mission)
 *   - Permission badge (Restricted | Full)
 *   - Optional active mission run status pill (mission rows only)
 *   - Snippet of `initialGoal` when present
 *   - Started-at timestamp (short locale form)
 *
 * No filtering / search in M12 — sidebar capacity is bounded at 100
 * rows by the IPC handler.
 */

import { useCallback } from "react";
import type { SessionListItem } from "@shared/schemas/sessions.js";
import { cn } from "../../lib/utils.js";
import { useSessionsList } from "../../lib/api/sessions.js";
import { useUiStore } from "../../stores/uiStore.js";

interface SessionsListProps {
  readonly onCreate: () => void;
}

export function SessionsList({ onCreate }: SessionsListProps): JSX.Element {
  const activeSessionId = useUiStore((s) => s.activeSessionId);
  const setActiveSessionId = useUiStore((s) => s.setActiveSessionId);
  const query = useSessionsList();

  const handleSelect = useCallback(
    (id: string): void => {
      setActiveSessionId(id);
    },
    [setActiveSessionId],
  );

  return (
    <aside
      className="flex h-full flex-col border-r border-border bg-card"
      data-vex-area="sessions-sidebar"
    >
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-secondary)]">
          Sessions
        </span>
        <button
          type="button"
          onClick={onCreate}
          className="rounded-md border border-border bg-background px-2 py-1 text-xs font-medium hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          + New
        </button>
      </header>

      <div className="flex-1 overflow-y-auto">
        {query.isLoading ? (
          <ListPlaceholder text="Loading sessions…" />
        ) : query.data && query.data.ok === false ? (
          <ListPlaceholder
            text={query.data.error.message}
            tone="error"
          />
        ) : query.data && query.data.ok ? (
          query.data.data.length === 0 ? (
            <ListPlaceholder text="No sessions yet." />
          ) : (
            <ol className="flex flex-col">
              {query.data.data.map((row) => (
                <SessionRow
                  key={row.id}
                  row={row}
                  selected={row.id === activeSessionId}
                  onSelect={handleSelect}
                />
              ))}
            </ol>
          )
        ) : null}
      </div>
    </aside>
  );
}

function ListPlaceholder({
  text,
  tone,
}: {
  readonly text: string;
  readonly tone?: "error";
}): JSX.Element {
  return (
    <p
      className={cn(
        "px-4 py-6 text-xs",
        tone === "error"
          ? "text-destructive"
          : "text-[var(--color-text-secondary)]",
      )}
    >
      {text}
    </p>
  );
}

interface SessionRowProps {
  readonly row: SessionListItem;
  readonly selected: boolean;
  readonly onSelect: (id: string) => void;
}

function SessionRow({ row, selected, onSelect }: SessionRowProps): JSX.Element {
  const startedLabel = formatShortDateTime(row.startedAt);
  const goalPreview =
    row.initialGoal === null
      ? null
      : row.initialGoal.length > 80
        ? `${row.initialGoal.slice(0, 80)}…`
        : row.initialGoal;
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(row.id)}
        aria-current={selected ? "true" : undefined}
        className={cn(
          "flex w-full flex-col gap-1 border-b border-border/60 px-4 py-3 text-left transition-colors",
          "hover:bg-accent/40 focus-visible:outline-none focus-visible:bg-accent/40",
          selected ? "bg-accent/50" : "bg-transparent",
        )}
      >
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={row.mode === "mission" ? "secondary" : "primary"}>
            {row.mode}
          </Badge>
          <Badge tone={row.permission === "full" ? "warning" : "muted"}>
            {row.permission}
          </Badge>
          {row.missionStatus !== null ? (
            <Badge tone="success">{row.missionStatus}</Badge>
          ) : null}
          <span className="ml-auto font-mono text-[10px] text-[var(--color-text-muted)]">
            {startedLabel}
          </span>
        </div>
        {goalPreview !== null ? (
          <p className="text-xs text-[var(--color-text-secondary)] line-clamp-2">
            {goalPreview}
          </p>
        ) : (
          <p className="text-xs italic text-[var(--color-text-muted)]">
            No goal
          </p>
        )}
      </button>
    </li>
  );
}

function Badge({
  tone,
  children,
}: {
  readonly tone: "primary" | "secondary" | "muted" | "warning" | "success";
  readonly children: string;
}): JSX.Element {
  const cls = {
    primary: "bg-primary/15 text-primary",
    secondary: "bg-secondary/15 text-secondary",
    muted: "bg-muted text-muted-foreground",
    warning: "bg-warning/20 text-warning",
    success: "bg-success/15 text-success",
  }[tone];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
        cls,
      )}
    >
      {children}
    </span>
  );
}

function formatShortDateTime(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}
