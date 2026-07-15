/**
 * MissionSummaryCard — the post-mission summary readout (mission-results-ledger).
 *
 * When a mission finalizes, its `mission_results` ledger row becomes the source
 * of a crisp, structured card (NOT the agent's prose): outcome + duration, the
 * signed ETH PnL headline, a trades/settlement meta line, and the goal snippet.
 * Below that it renders the agent's end-of-mission Mission Summary — the plain
 * language "what happened / why" narrative, as a short bulleted list. It renders
 * inline above the "Renew mission" branch in `MissionControls`.
 *
 * Presentation over derived values only — every string is formatted in
 * `missionSummaryModel.ts` (pure + unit-tested); the `--vex-*`/`--color-*` ink
 * matches the Mission History ledger so the two surfaces read as one register.
 * PnL is coloured by sign (success/destructive), USD is a tooltip only.
 */

import { type JSX } from "react";
import type { MissionResultDto } from "@shared/schemas/mission.js";
import { cn } from "../../lib/utils.js";
import { useMoves } from "../../lib/api/portfolio.js";
import { EM_DASH, formatDurationS } from "./missionHistoryModel.js";
import {
  formatBankrollRangeUsd,
  formatMetaLine,
  formatPnlEth,
  formatPnlPct,
  formatPnlUsd,
  pnlToneClass,
} from "./missionSummaryModel.js";
import { countMissionBagsHeld } from "./missionJournalModel.js";

export interface MissionSummaryCardProps {
  readonly result: MissionResultDto;
  /**
   * Owning session — powers the mission-scoped `bagsHeld` read (executed moves
   * within the run window). When omitted the card renders the structured
   * summary alone, so the component stays usable in contexts without a session
   * id.
   */
  readonly sessionId?: string;
}

export function MissionSummaryCard({
  result,
  sessionId,
}: MissionSummaryCardProps): JSX.Element {
  const pct = formatPnlPct(result.pnlPct);
  const pnlEthText = formatPnlEth(result.pnlEth);
  // USD leads the headline; ETH moves to a secondary aside + the hover title.
  const pnlUsdText =
    result.ethPriceUsdEnd !== null
      ? formatPnlUsd(result.pnlEth, result.ethPriceUsdEnd)
      : null;
  const pnlTitle = pnlEthText === EM_DASH ? undefined : `${pnlEthText} at close`;

  // Mission-scoped bag count derives from the session's executed moves.
  // Hooks run unconditionally (empty id → disabled query, `[]` data).
  const movesQuery = useMoves(sessionId ?? "");
  const movesResult = movesQuery.data;
  const moves = movesResult?.ok ? movesResult.data : [];
  // Prefer the mission-scoped held count (moves within the run window that were
  // bought and not sold) over the ledger's `openPositionsCount`, which conflates
  // the wallet's pre-existing legacy holdings. Only override when the moves feed
  // actually loaded — a failed/pending read falls back to the ledger figure
  // rather than falsely claiming "flat".
  const bagsHeld =
    movesResult?.ok === true
      ? countMissionBagsHeld(moves, result.startedAt, result.endedAt)
      : result.openPositionsCount;

  return (
    <section
      data-vex-area="mission-summary"
      aria-label="Mission summary"
      className="mb-3 flex flex-col gap-3 rounded-[12px] border border-[var(--vex-line)] bg-white/[0.03] px-5 py-4"
    >
      {/* Line 1 — identity + outcome stamp + duration. */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--vex-text-2)]">
        <span className="tabular-nums text-foreground">
          Mission #{result.seqNo}
        </span>
        <span className="text-[var(--vex-text-3)]">·</span>
        <OutcomeBadge outcome={result.outcome} />
        <span className="text-[var(--vex-text-3)]">·</span>
        <span className="tabular-nums">{formatDurationS(result.durationS)}</span>
      </div>

      {/* Line 2 — the signed USD PnL headline (ETH aside + in the tooltip). */}
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--vex-text-3)]">
          PnL
        </span>
        <span
          title={pnlTitle}
          className={cn(
            "font-mono text-[32px] leading-none tabular-nums",
            pnlToneClass(result.pnlEth),
          )}
        >
          {pnlUsdText ?? pnlEthText}
          {pct.length > 0 ? (
            <span className="ml-2 text-sm">{pct}</span>
          ) : null}
          {pnlUsdText !== null && pnlEthText !== EM_DASH ? (
            <span className="ml-2 text-[11px] text-[var(--vex-text-3)]">
              ≈ {pnlEthText}
            </span>
          ) : null}
        </span>
      </div>

      {/* Line 3 — bankroll start→end in USD (the basis behind the PnL). */}
      <div className="flex items-baseline gap-2 font-mono text-[11px] tabular-nums text-[var(--vex-text-2)]">
        <span className="text-[10px] uppercase tracking-[0.18em] text-[var(--vex-text-3)]">
          Bankroll
        </span>
        <span>
          {formatBankrollRangeUsd(
            result.bankrollStartEth,
            result.bankrollEndEth,
            result.ethPriceUsdEnd,
          )}
        </span>
      </div>

      {/* Line 4 — trades + settlement (mission-scoped bag count). */}
      <p className="font-mono text-[11px] tabular-nums text-[var(--vex-text-2)]">
        {formatMetaLine(result.trades, bagsHeld)}
      </p>

      {/* Goal caption — truncated, only when present. */}
      {result.goalSnippet !== null ? (
        <p
          title={result.goalSnippet}
          className="truncate text-xs text-[var(--vex-text-3)]"
        >
          {result.goalSnippet}
        </p>
      ) : null}

      {/* Mission Summary — the agent's end-of-mission narrative, rendered as a
          short bulleted list. Only shown when the run recorded a non-empty
          `stopSummary`. */}
      {result.stopSummary !== null && result.stopSummary.trim().length > 0 ? (
        <MissionNarrative summary={result.stopSummary} />
      ) : null}
    </section>
  );
}

/**
 * The agent's own end-of-mission narrative, rendered as a short bulleted list.
 * The summary arrives as one bullet per line ("- ..."); we split on newlines,
 * strip any leading bullet marker, and render each remaining line as a `<li>`.
 * A single-paragraph summary (no line breaks) falls back to one bullet so it
 * still displays. Boxed with the "Mission summary" eyebrow to stay prominent.
 */
function MissionNarrative({
  summary,
}: {
  readonly summary: string;
}): JSX.Element {
  const items = summary
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^[-•*]\s+/, "").trim())
    .filter((line) => line.length > 0);
  const bullets = items.length > 0 ? items : [summary.trim()];
  return (
    <div className="rounded-[8px] border border-[var(--vex-line)] bg-white/[0.03] px-3.5 py-3">
      <p className="vex-eyebrow mb-1.5">Mission summary</p>
      <ul className="flex flex-col gap-1.5 text-[13.5px] leading-relaxed text-foreground">
        {bullets.map((line, i) => (
          <li key={i} className="flex gap-2 break-words">
            <span
              aria-hidden
              className="mt-[2px] shrink-0 select-none text-[var(--vex-text-3)]"
            >
              –
            </span>
            <span className="min-w-0 flex-1">{line}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Outcome → small colour-toned stamp. Mirrors `MissionHistory`'s badge tones:
 * `completed` = success, `failed` = destructive, `running` = accent, the rest
 * stay muted. */
function OutcomeBadge({ outcome }: { readonly outcome: string }): JSX.Element {
  const tone =
    outcome === "completed"
      ? "border-[color-mix(in_oklab,var(--color-success)_40%,transparent)] text-[var(--color-success)]"
      : outcome === "failed"
        ? "border-destructive/40 text-destructive"
        : outcome === "timed_out"
          ? "border-[color-mix(in_oklab,var(--color-warning)_40%,transparent)] text-[var(--color-warning)]"
          : outcome === "running"
            ? "border-[var(--vex-accent-border)] text-[var(--vex-accent-text)]"
            : "border-[var(--vex-line)] text-[var(--vex-text-2)]";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-[3px] border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em]",
        tone,
      )}
    >
      {(outcome || EM_DASH).replace(/_/g, " ")}
    </span>
  );
}
