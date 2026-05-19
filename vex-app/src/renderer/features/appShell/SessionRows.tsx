import type { JSX } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  AiChat01Icon,
  Archive02Icon,
  StopCircleIcon,
  Target02Icon,
} from "@hugeicons/core-free-icons";
import type { SessionListItem } from "@shared/schemas/sessions.js";
import { DotmSquare3 } from "../../components/ui/dotm-square-3.js";
import { cn } from "../../lib/utils.js";
import {
  formatSessionTime,
  getMissionActivity,
  getSessionSubtitle,
  getSessionTitle,
  type SessionGroup,
} from "./sessionListModel.js";

interface SessionGroupsProps {
  readonly groups: readonly SessionGroup[];
  readonly activeSessionId: string | null;
  readonly sidebarOpen: boolean;
  readonly onSelect: (id: string) => void;
}

export function SessionGroups({
  groups,
  activeSessionId,
  sidebarOpen,
  onSelect,
}: SessionGroupsProps): JSX.Element {
  return (
    <div className="flex flex-col gap-4">
      {groups.map((group) =>
        group.rows.length > 0 ? (
          <section key={group.key} aria-labelledby={`sessions-${group.key}`}>
            {sidebarOpen ? (
              <h2
                id={`sessions-${group.key}`}
                className="mb-2 px-2 text-[11px] font-semibold text-[#6f91ff]"
              >
                {group.title}
              </h2>
            ) : null}
            <ol className="flex flex-col gap-1">
              {group.rows.map((row) => (
                <SessionRow
                  key={row.id}
                  row={row}
                  selected={row.id === activeSessionId}
                  sidebarOpen={sidebarOpen}
                  onSelect={onSelect}
                />
              ))}
            </ol>
          </section>
        ) : null,
      )}
    </div>
  );
}

export function SessionsLoadingPlaceholder({
  sidebarOpen,
}: {
  readonly sidebarOpen: boolean;
}): JSX.Element {
  return (
    <ListPlaceholder
      sidebarOpen={sidebarOpen}
      text="Loading sessions"
      icon={
        <DotmSquare3
          size={26}
          dotSize={4}
          color="#6f91ff"
          ariaLabel="Loading sessions"
        />
      }
    />
  );
}

export function SessionsErrorPlaceholder({
  sidebarOpen,
  message,
}: {
  readonly sidebarOpen: boolean;
  readonly message: string;
}): JSX.Element {
  return (
    <ListPlaceholder
      sidebarOpen={sidebarOpen}
      text={message}
      tone="error"
      icon={<HugeiconsIcon icon={StopCircleIcon} size={18} aria-hidden />}
    />
  );
}

export function SessionsEmptyPlaceholder({
  sidebarOpen,
}: {
  readonly sidebarOpen: boolean;
}): JSX.Element {
  return (
    <ListPlaceholder
      sidebarOpen={sidebarOpen}
      text="No sessions"
      icon={<HugeiconsIcon icon={Archive02Icon} size={18} aria-hidden />}
    />
  );
}

export function SidebarIconButton({
  label,
  onClick,
  children,
}: {
  readonly label: string;
  readonly onClick: () => void;
  readonly children: JSX.Element;
}): JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/[0.06] bg-white/[0.025] text-[var(--color-text-secondary)] transition-colors hover:bg-white/[0.07] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3275f8]"
    >
      {children}
    </button>
  );
}

function ListPlaceholder({
  sidebarOpen,
  text,
  tone,
  icon,
}: {
  readonly sidebarOpen: boolean;
  readonly text: string;
  readonly tone?: "error";
  readonly icon: JSX.Element;
}): JSX.Element {
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-lg border border-white/[0.045] bg-white/[0.025] p-3 text-xs",
        tone === "error" ? "text-destructive" : "text-[var(--color-text-secondary)]",
        !sidebarOpen && "justify-center px-0",
      )}
    >
      <span aria-hidden className="shrink-0">
        {icon}
      </span>
      {sidebarOpen ? <p className="min-w-0 truncate">{text}</p> : null}
    </div>
  );
}

function SessionRow({
  row,
  selected,
  sidebarOpen,
  onSelect,
}: {
  readonly row: SessionListItem;
  readonly selected: boolean;
  readonly sidebarOpen: boolean;
  readonly onSelect: (id: string) => void;
}): JSX.Element {
  const startedLabel = formatSessionTime(row.startedAt);
  const title = getSessionTitle(row);
  const subtitle = getSessionSubtitle(row);
  const activity = getMissionActivity(row);
  const Icon = row.mode === "mission" ? Target02Icon : AiChat01Icon;

  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(row.id)}
        aria-current={selected ? "true" : undefined}
        className={cn(
          "group relative flex w-full rounded-lg border text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3275f8]",
          selected
            ? "border-[#3275f8]/42 bg-[#3275f8]/13 shadow-[0_0_24px_rgba(50,117,248,0.12)]"
            : "border-transparent bg-transparent hover:border-white/[0.055] hover:bg-white/[0.035]",
          sidebarOpen ? "min-h-[68px] gap-3 px-3 py-3" : "h-11 items-center justify-center px-0",
        )}
        title={sidebarOpen ? undefined : title}
      >
        <span
          className={cn(
            "relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/[0.06] bg-white/[0.035] text-[#8da5ff]",
            selected && "border-[#3275f8]/42 bg-[#3275f8]/13 text-[#adc0ff]",
          )}
        >
          <HugeiconsIcon icon={Icon} size={17} aria-hidden />
          {activity !== null ? (
            <span
              aria-hidden
              className={cn(
                "absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border border-black/60",
                activity.dotClass,
              )}
            />
          ) : null}
        </span>

        {sidebarOpen ? (
          <span className="min-w-0 flex-1">
            <span className="flex items-start gap-2">
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                {title}
              </span>
              <span className="shrink-0 font-mono text-[10px] text-[var(--color-text-muted)]">
                {startedLabel}
              </span>
            </span>
            <span className="mt-1 block truncate text-xs text-[var(--color-text-secondary)]">
              {subtitle}
            </span>
            <span className="mt-2 flex items-center gap-2">
              <Badge tone={row.mode === "mission" ? "mission" : "agent"}>
                {row.mode}
              </Badge>
              <Badge tone={row.permission === "full" ? "full" : "restricted"}>
                {row.permission}
              </Badge>
              {activity !== null ? (
                <Badge tone={activity.tone}>{activity.label}</Badge>
              ) : null}
            </span>
          </span>
        ) : null}
      </button>
    </li>
  );
}

function Badge({
  tone,
  children,
}: {
  readonly tone:
    | "agent"
    | "mission"
    | "restricted"
    | "full"
    | "active"
    | "paused"
    | "stopped";
  readonly children: string;
}): JSX.Element {
  const cls = {
    agent: "bg-[#3275f8]/12 text-[#8da5ff]",
    mission: "bg-[#7c5cff]/14 text-[#b2a3ff]",
    restricted: "bg-white/[0.05] text-[var(--color-text-secondary)]",
    full: "bg-warning/14 text-warning",
    active: "bg-success/12 text-success",
    paused: "bg-warning/14 text-warning",
    stopped: "bg-white/[0.05] text-[var(--color-text-muted)]",
  }[tone];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em]",
        cls,
      )}
    >
      {children}
    </span>
  );
}
