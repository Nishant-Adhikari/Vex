/**
 * ActiveMissionsBar — a persistent, always-visible strip listing EVERY
 * active/open mission run across ALL sessions (not just the focused one).
 *
 * Why it exists: the DESK RULE's MissionRail only reflects the FOCUSED
 * session. A second live run — or a run that orphaned (its ledger row stuck at
 * `outcome='running'` with no live runtime) — would otherwise be invisible,
 * and an unattended run may be holding a real-money position. This bar closes
 * that gap: it surfaces each open run with its number, label, live status, and
 * PnL, and clicking an entry jumps into that session.
 *
 * Live runs are visually distinct from stale/orphaned ledger rows — the latter
 * are stamped "needs cleanup" so they can never masquerade as live.
 *
 * 100% read-only presentation over `useActiveMissions`. Fail-soft: zero active
 * missions (or any hard query error) → the bar renders NOTHING and occupies no
 * space. It never blocks the shell.
 */

import type { JSX } from "react";
import { useUiStore } from "../../stores/uiStore.js";
import { cn } from "../../lib/utils.js";
import { formatPercentDelta } from "../../lib/format.js";
import { formatEth } from "./missionHistoryModel.js";
import { useActiveMissions } from "./useActiveMissions.js";
import type { ActiveMission, ActiveMissionStatus } from "./activeMissionsModel.js";

interface StatusStyle {
  readonly word: string;
  /** Dot + text tone classes (mirrors OutcomeBadge's token grammar). */
  readonly dot: string;
  readonly text: string;
}

const STATUS_STYLE: Record<ActiveMissionStatus, StatusStyle> = {
  running: {
    word: "running",
    dot: "bg-[var(--color-success)]",
    text: "text-[var(--color-success)]",
  },
  preparing: {
    word: "preparing",
    dot: "bg-[var(--vex-accent)]",
    text: "text-[var(--vex-accent-text)]",
  },
  paused: {
    word: "paused",
    dot: "bg-[var(--color-warning)]",
    text: "text-[var(--color-warning)]",
  },
  stale_orphaned: {
    word: "needs cleanup",
    dot: "bg-destructive",
    text: "text-destructive",
  },
};

export function ActiveMissionsBar(): JSX.Element | null {
  const { missions, isError } = useActiveMissions();
  const setActiveSessionId = useUiStore((s) => s.setActiveSessionId);
  const setAppShellView = useUiStore((s) => s.setAppShellView);

  // Collapse to nothing when idle or on a hard error — never a broken frame.
  if (isError || missions.length === 0) return null;

  const handleOpen = (sessionId: string): void => {
    setActiveSessionId(sessionId);
    setAppShellView("session");
  };

  return (
    <div
      data-vex-area="active-missions"
      role="group"
      aria-label={`Active missions (${missions.length})`}
      className="flex shrink-0 items-center gap-2 overflow-x-auto border-b border-[var(--vex-line)] bg-[var(--vex-surface-1)]/40 px-6 py-1.5"
    >
      <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--vex-text-3)]">
        Active
      </span>
      <ul className="flex min-w-0 items-center gap-2">
        {missions.map((m) => (
          <li key={m.missionRunId} className="shrink-0">
            <MissionChip mission={m} onOpen={handleOpen} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function MissionChip({
  mission,
  onOpen,
}: {
  readonly mission: ActiveMission;
  readonly onOpen: (sessionId: string) => void;
}): JSX.Element {
  const style = STATUS_STYLE[mission.status];
  const orphaned = mission.status === "stale_orphaned";
  const pnl = mission.pnlEth;
  const bags = mission.openPositionsCount;

  return (
    <button
      type="button"
      onClick={() => onOpen(mission.sessionId)}
      title={`${mission.label} — ${style.word}`}
      className={cn(
        "flex max-w-[240px] items-center gap-2 rounded-[6px] border px-2 py-1 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vex-accent)]",
        orphaned
          ? "border-destructive/40 hover:bg-destructive/10"
          : "border-[var(--vex-line)] hover:bg-white/[0.04]",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "h-1.5 w-1.5 shrink-0 rounded-full",
          style.dot,
          mission.status === "running" && "animate-pulse",
        )}
      />
      <span className="shrink-0 font-mono text-[11px] tabular-nums text-[var(--vex-text-2)]">
        #{mission.seqNo}
      </span>
      {mission.simulated ? (
        <span
          className="shrink-0 rounded-[3px] border border-[var(--vex-accent)]/40 px-1 font-mono text-[9px] uppercase tracking-[0.08em] text-[var(--vex-accent)]"
          title="Simulator run — paper-traded, no real transactions"
        >
          SIM
        </span>
      ) : null}
      <span className="min-w-0 truncate text-[12px] text-foreground">
        {mission.label}
      </span>
      <span
        className={cn(
          "shrink-0 font-mono text-[10px] uppercase tracking-[0.08em]",
          style.text,
        )}
      >
        {style.word}
      </span>
      {bags > 0 ? (
        <span
          className="shrink-0 font-mono text-[10px] text-[var(--color-warning)]"
          title={`${bags} open position${bags === 1 ? "" : "s"}`}
        >
          {bags} held
        </span>
      ) : null}
      {pnl !== null ? (
        <span className={cn("shrink-0 font-mono text-[11px] tabular-nums", pnlTone(pnl))}>
          {formatEth(pnl, { signed: true })}
          {mission.pnlPct !== null ? (
            <span className="ml-1 text-[10px] text-[var(--vex-text-3)]">
              {formatPercentDelta(mission.pnlPct)}
            </span>
          ) : null}
        </span>
      ) : null}
    </button>
  );
}

/** Sign → PnL colour class (mirrors MissionHistory's `pnlTone`). */
function pnlTone(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "text-[var(--vex-text-3)]";
  if (value > 0) return "text-[var(--color-success)]";
  if (value < 0) return "text-destructive";
  return "text-[var(--vex-text-2)]";
}
