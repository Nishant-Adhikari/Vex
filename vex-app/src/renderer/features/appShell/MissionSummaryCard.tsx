/**
 * MissionSummaryCard — THE mission summary. One component, both surfaces.
 *
 * A finished mission is reported in two places: the session view, right after
 * the run ends (`MissionControls`), and the Missions ledger list
 * (`MissionHistory`). Those were two different designs saying the same thing,
 * which is one design too many — an operator who learned to read the post-run
 * card had to learn the ledger row separately. This is the single card both
 * surfaces render; `density` scales it, and scales NOTHING else. Same
 * elements, same order, same sources, same dismiss affordance, larger or
 * smaller type.
 *
 * READING ORDER, deliberate: the money figure, then what the run was for,
 * then the agent's own account of it, then the raw counters. The prose is
 * what a non-technical operator actually reads, so it is body text in the
 * middle of the card — never a tooltip, never a column.
 *
 * THE TWO HALVES HAVE DIFFERENT AUTHORS AND MUST NOT BE CONFUSED. Every money
 * value is derived HERE from the ledger's `pnlEth`/`ethPriceUsdEnd` via
 * `missionSummaryModel.ts`. The prose is rendered verbatim and is never
 * parsed for numbers. An agent that contradicts the ledger is a prompt bug
 * (see `engine/prompts/mission-run.ts`); the figure the user sees stays right
 * regardless. Nothing is gated on the outcome either — a `failed` run that
 * wrote a summary still shows it, because that is precisely the run whose
 * account the operator most needs.
 */

import type { JSX } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon } from "@hugeicons/core-free-icons";
import type { MissionResultDto } from "@shared/schemas/mission.js";
import { useUiStore } from "../../stores/uiStore.js";
import { cn } from "../../lib/utils.js";
import { OutcomeBadge } from "./OutcomeBadge.js";
import { parseSummaryBullets } from "./missionSummaryProse.js";
import { EM_DASH, formatDurationS, missionDisplayOutcome } from "./missionHistoryModel.js";
import {
  formatPnlEth,
  formatPnlPct,
  formatPnlUsd,
  formatTrades,
  pnlToneClass,
  type MissionSummaryDensity,
} from "./missionSummaryModel.js";

/**
 * Density → type/space scale. Only sizes live here: any element that exists
 * at one density exists at the other, so the two surfaces cannot drift into
 * separate designs by accident.
 */
const SCALE: Record<
  MissionSummaryDensity,
  {
    readonly shell: string;
    readonly pnl: string;
    readonly pnlAside: string;
    readonly goal: string;
    readonly prose: string;
  }
> = {
  hero: {
    shell: "gap-3 px-5 py-4",
    pnl: "text-[32px]",
    pnlAside: "text-xs",
    goal: "text-sm",
    prose: "text-[13.5px]",
  },
  compact: {
    shell: "gap-2 px-4 py-3",
    pnl: "text-[20px]",
    pnlAside: "text-[11px]",
    goal: "text-xs",
    prose: "text-[13px]",
  },
};

export interface MissionSummaryCardProps {
  readonly result: MissionResultDto;
  /** Defaults to the ledger-list scale; the session view asks for `hero`. */
  readonly density?: MissionSummaryDensity;
}

export function MissionSummaryCard({
  result,
  density = "compact",
}: MissionSummaryCardProps): JSX.Element {
  // Dismissal is view state and nothing else: it writes one id into the
  // persisted UI store. No IPC, no mutation, no ledger write. The
  // `mission_results` row and the `mission_runs` record are an audit trail of
  // real-money trades and survive untouched — which is why the affordance
  // says "hide" and never "delete".
  const dismiss = useUiStore((s) => s.dismissMissionRun);
  const scale = SCALE[density];
  const beats = parseSummaryBullets(result.stopSummary);
  const pct = formatPnlPct(result.pnlPct);
  const pnlEthText = formatPnlEth(result.pnlEth);

  return (
    <section
      data-vex-area="mission-summary"
      data-vex-density={density}
      aria-label={`Mission #${result.seqNo} summary`}
      className={cn(
        "flex flex-col rounded-[12px] border border-[var(--vex-line)] bg-white/[0.03]",
        scale.shell,
      )}
    >
      {/* Identity strip — who this was, how it ended, how long it took. */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--vex-text-3)]">
        <span className="tabular-nums text-[var(--vex-text-2)]">#{result.seqNo}</span>
        <OutcomeBadge outcome={missionDisplayOutcome(result)} />
        <span aria-hidden>·</span>
        <span className="tabular-nums">{formatDurationS(result.durationS)}</span>
        <span aria-hidden>·</span>
        <span className="tabular-nums">{formatTrades(result.trades)}</span>
      </div>

      {/* The focal point: authoritative money, straight off the ledger row,
        * with the dismiss key grouped alongside it at the card's top-right. */}
      <div className="flex items-start justify-between gap-4">
        <div className={cn("flex min-w-0 flex-col gap-0.5", pnlToneClass(result.pnlEth))}>
          <span className={cn("font-mono leading-none tabular-nums", scale.pnl)}>
            {formatPnlUsd(result.pnlEth, result.ethPriceUsdEnd)}
          </span>
          <span
            className={cn(
              "font-mono tabular-nums text-[var(--vex-text-3)]",
              scale.pnlAside,
            )}
          >
            {pnlEthText}
            {pct.length > 0 ? ` · ${pct}` : ""}
          </span>
        </div>

        {/* No confirm dialog: nothing is destroyed, so a confirm would be
          * pure friction. The label carries the whole meaning instead —
          * "Hide", never "Delete", because the record survives. */}
        <button
          type="button"
          onClick={() => dismiss(result.missionRunId)}
          aria-label={`Hide mission #${result.seqNo} from this list`}
          title="Hide from this list (the mission record is kept)"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] text-[var(--vex-text-3)] transition-colors hover:bg-white/[0.04] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vex-accent)]"
        >
          <HugeiconsIcon icon={Cancel01Icon} size={13} aria-hidden />
        </button>
      </div>

      {/* What the run was for. */}
      <p
        className={cn("truncate text-[var(--vex-text-2)]", scale.goal)}
        title={result.goalSnippet ?? undefined}
      >
        {result.goalSnippet ?? EM_DASH}
      </p>

      {/* The agent's own account, verbatim. Rendered whenever it exists —
        * never gated on the outcome. */}
      {beats.length > 0 ? (
        <ul
          className={cn(
            "flex flex-col gap-1.5 leading-relaxed text-foreground",
            scale.prose,
          )}
        >
          {beats.map((beat, i) => (
            // Beats are positional prose with no stable id; the list is
            // re-rendered wholesale whenever the summary changes.
            // eslint-disable-next-line react/no-array-index-key
            <li key={i} className="flex gap-2 break-words">
              <span aria-hidden className="shrink-0 select-none text-[var(--vex-text-3)]">
                —
              </span>
              <span className="min-w-0 flex-1">{beat}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
