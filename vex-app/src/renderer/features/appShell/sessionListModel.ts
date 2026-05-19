import type {
  MissionRunStatus,
  SessionListItem,
} from "@shared/schemas/sessions.js";
import type { SessionModeFilter } from "../../stores/uiStore.js";

export interface SessionGroup {
  readonly key: "today" | "yesterday" | "older";
  readonly title: string;
  readonly rows: readonly SessionListItem[];
}

export interface MissionActivity {
  readonly label: string;
  readonly tone: "active" | "paused" | "stopped";
  readonly dotClass: string;
}

export const SESSION_MODE_FILTERS: ReadonlyArray<{
  readonly value: SessionModeFilter;
  readonly label: string;
}> = [
  { value: "all", label: "All" },
  { value: "agent", label: "Agent" },
  { value: "mission", label: "Mission" },
];

const ACTIVE_MISSION_STATUSES: ReadonlySet<MissionRunStatus> = new Set(["running"]);
const PAUSED_MISSION_STATUSES: ReadonlySet<MissionRunStatus> = new Set([
  "paused_approval",
  "paused_wake",
  "paused_error",
]);
const TERMINAL_MISSION_STATUSES: ReadonlySet<MissionRunStatus> = new Set([
  "completed",
  "failed",
  "stopped",
  "cancelled",
]);

export function filterSessionsByMode(
  rows: readonly SessionListItem[],
  filter: SessionModeFilter,
): readonly SessionListItem[] {
  if (filter === "all") return rows;
  return rows.filter((row) => row.mode === filter);
}

export function groupSessions(rows: readonly SessionListItem[]): readonly SessionGroup[] {
  const groups: SessionGroup[] = [
    { key: "today", title: "Today", rows: [] },
    { key: "yesterday", title: "Yesterday", rows: [] },
    { key: "older", title: "Older", rows: [] },
  ];
  const mutableRows = new Map<SessionGroup["key"], SessionListItem[]>(
    groups.map((g) => [g.key, []]),
  );

  for (const row of rows) {
    mutableRows.get(getSessionBucket(row.startedAt))?.push(row);
  }

  return groups.map((g) => ({
    ...g,
    rows: mutableRows.get(g.key) ?? [],
  }));
}

export function getSessionTitle(row: SessionListItem): string {
  if (row.initialGoal !== null && row.initialGoal.trim().length > 0) {
    const title = row.initialGoal.trim();
    return title.length > 48 ? `${title.slice(0, 48)}...` : title;
  }
  return row.mode === "mission" ? "Mission setup" : "Agent session";
}

export function getSessionSubtitle(row: SessionListItem): string {
  if (row.mode === "mission") return row.initialGoal ?? "Mission setup";
  return "Agent conversation";
}

export function getMissionActivity(row: SessionListItem): MissionActivity | null {
  if (row.mode !== "mission" || row.missionStatus === null) return null;
  if (ACTIVE_MISSION_STATUSES.has(row.missionStatus)) {
    return {
      label: "Active",
      tone: "active",
      dotClass: "bg-success shadow-[0_0_10px_rgba(16,185,129,0.9)]",
    };
  }
  if (PAUSED_MISSION_STATUSES.has(row.missionStatus)) {
    return {
      label: "Paused",
      tone: "paused",
      dotClass: "bg-warning shadow-[0_0_10px_rgba(245,158,11,0.9)]",
    };
  }
  if (TERMINAL_MISSION_STATUSES.has(row.missionStatus)) {
    return {
      label: "Stopped",
      tone: "stopped",
      dotClass: "bg-[var(--color-text-muted)]",
    };
  }
  return {
    label: row.missionStatus,
    tone: "paused",
    dotClass: "bg-warning shadow-[0_0_10px_rgba(245,158,11,0.9)]",
  };
}

export function formatSessionTime(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const bucket = getSessionBucket(iso);
    if (bucket === "older") {
      return d.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      });
    }
    return d.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function getSessionBucket(iso: string): SessionGroup["key"] {
  const value = new Date(iso);
  if (Number.isNaN(value.getTime())) return "older";

  const today = startOfLocalDay(new Date());
  const sessionDay = startOfLocalDay(value);
  const diffMs = today.getTime() - sessionDay.getTime();
  const diffDays = Math.round(diffMs / 86_400_000);
  if (diffDays === 0) return "today";
  if (diffDays === 1) return "yesterday";
  return "older";
}

function startOfLocalDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}
