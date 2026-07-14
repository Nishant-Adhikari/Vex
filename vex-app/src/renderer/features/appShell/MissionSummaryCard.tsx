/**
 * MissionSummaryCard — the post-mission summary readout (mission-results-ledger).
 *
 * When a mission finalizes, its `mission_results` ledger row becomes the source
 * of a crisp, structured card (NOT the agent's prose): outcome + duration, the
 * signed ETH PnL headline, a trades/settlement meta line, and the goal snippet.
 * It renders inline above the "Renew mission" branch in `MissionControls`.
 *
 * Presentation over derived values only — every string is formatted in
 * `missionSummaryModel.ts` (pure + unit-tested); the `--vex-*`/`--color-*` ink
 * matches the Mission History ledger so the two surfaces read as one register.
 * PnL is coloured by sign (success/destructive), USD is a tooltip only.
 */

import { useId, useState, type JSX } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowRight01Icon } from "@hugeicons/core-free-icons";
import type { MissionResultDto } from "@shared/schemas/mission.js";
import { cn } from "../../lib/utils.js";
import { useMoves } from "../../lib/api/portfolio.js";
import { useSessionMessagesTail } from "../../lib/api/messages.js";
import { formatClock } from "../../lib/format.js";
import { EM_DASH, formatDurationS } from "./missionHistoryModel.js";
import {
  formatBankrollRangeUsd,
  formatMetaLine,
  formatPnlEth,
  formatPnlPct,
  formatPnlUsd,
  pnlToneClass,
} from "./missionSummaryModel.js";
import {
  buildJournal,
  countMissionBagsHeld,
  type JournalEntry,
} from "./missionJournalModel.js";

export interface MissionSummaryCardProps {
  readonly result: MissionResultDto;
  /**
   * Owning session — powers the Decision Journal's moves + reasoning reads. When
   * omitted the card renders the structured summary alone (no journal), so the
   * component stays usable in contexts without a session id.
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

  // Decision Journal + mission-scoped bag count both derive from the session's
  // executed moves; the journal additionally reads the assistant reasoning tail.
  // Hooks run unconditionally (empty id → disabled query, `[]` data).
  const movesQuery = useMoves(sessionId ?? "");
  const messagesQuery = useSessionMessagesTail(sessionId ?? null);
  const movesResult = movesQuery.data;
  const moves = movesResult?.ok ? movesResult.data : [];
  const messages = messagesQuery.data ?? [];
  const journal = buildJournal(
    moves,
    messages,
    result.startedAt,
    result.endedAt,
  );
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

      {/* Mission Summary — the agent's end-of-mission narrative (prose). Only
          rendered when the run recorded a non-empty `stopSummary`. */}
      {result.stopSummary !== null && result.stopSummary.trim().length > 0 ? (
        <MissionNarrative summary={result.stopSummary} />
      ) : null}

      {/* Decision Journal — per-trade "why", each expandable to full reasoning. */}
      {journal.length > 0 ? <DecisionJournal entries={journal} /> : null}
    </section>
  );
}

/**
 * The agent's own end-of-mission narrative, rendered as readable prose. Line
 * breaks are preserved (`whitespace-pre-wrap`) so the agent's paragraphing
 * carries through; ink + hairline separator match the Decision Journal so the
 * two prose surfaces read as one register.
 */
function MissionNarrative({
  summary,
}: {
  readonly summary: string;
}): JSX.Element {
  return (
    <div className="rounded-[8px] border border-[var(--vex-line)] bg-white/[0.03] px-3.5 py-3">
      <p className="vex-eyebrow mb-1.5">Mission summary</p>
      <p className="whitespace-pre-wrap break-words text-[13.5px] leading-relaxed text-foreground">
        {summary.trim()}
      </p>
    </div>
  );
}

/**
 * Chronological, trade-anchored journal. Each row is a BUY/SELL chip + traded
 * token + a distilled one-line rationale, expandable to the agent's untouched
 * reasoning. Mirrors the card/MOVES grammar: mono figures, `.vex-eyebrow` micro
 * label, hairline separators. One row open at a time.
 */
function DecisionJournal({
  entries,
}: {
  readonly entries: readonly JournalEntry[];
}): JSX.Element {
  const [openKey, setOpenKey] = useState<string | null>(null);
  return (
    <div className="mt-1 border-t border-[var(--vex-line)] pt-2">
      <p className="vex-eyebrow mb-1.5">Decision journal</p>
      <ul className="flex flex-col">
        {entries.map((entry) => (
          <JournalRow
            key={entry.key}
            entry={entry}
            open={openKey === entry.key}
            onToggle={() =>
              setOpenKey((prev) => (prev === entry.key ? null : entry.key))
            }
          />
        ))}
      </ul>
    </div>
  );
}

/** SIDE chip tones — hairline chips, ink on the text (mirrors MovesBlock). */
const JOURNAL_SIDE_TONE: Record<JournalEntry["side"], string> = {
  buy: "border-[color-mix(in_oklab,var(--color-success)_40%,transparent)] text-success",
  sell: "border-[var(--vex-line-strong)] text-[var(--vex-text-2)]",
  swap: "border-[var(--vex-line)] text-[var(--vex-text-3)]",
  other: "border-[var(--vex-line)] text-[var(--vex-text-3)]",
};

function JournalRow({
  entry,
  open,
  onToggle,
}: {
  readonly entry: JournalEntry;
  readonly open: boolean;
  readonly onToggle: () => void;
}): JSX.Element {
  const bodyId = useId();
  const time = formatClock(entry.createdAt);
  const hasReasoning = entry.rationaleFull !== null;
  const line =
    entry.rationaleLine !== null && entry.rationaleLine.length > 0
      ? entry.rationaleLine
      : "No recorded rationale for this trade.";
  return (
    <li className="border-b border-[var(--vex-line)] py-1 last:border-b-0">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={bodyId}
        disabled={!hasReasoning}
        className={cn(
          "group flex w-full items-start gap-2 rounded-[3px] py-0.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vex-accent)]",
          hasReasoning ? "cursor-pointer" : "cursor-default",
        )}
      >
        <HugeiconsIcon
          icon={ArrowRight01Icon}
          size={11}
          aria-hidden
          className={cn(
            "mt-[3px] shrink-0 text-[var(--vex-text-3)] transition-transform",
            open && "rotate-90",
            !hasReasoning && "opacity-0",
          )}
        />
        <span
          className={cn(
            "mt-px inline-flex h-4 min-w-[36px] shrink-0 items-center justify-center rounded-[3px] border px-1 font-mono text-[9px] uppercase tracking-[0.14em]",
            JOURNAL_SIDE_TONE[entry.side],
          )}
        >
          {entry.sideLabel}
        </span>
        <span
          title={entry.tokenFull ?? undefined}
          className="mt-px shrink-0 font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--vex-text-2)]"
        >
          {entry.token}
        </span>
        <span className="min-w-0 flex-1 text-[11px] leading-snug text-[var(--vex-text-3)] transition-colors group-hover:text-[var(--vex-text-2)]">
          {line}
        </span>
        {time !== null ? (
          <span className="mt-px shrink-0 text-right font-mono text-[10px] tabular-nums text-[var(--vex-text-3)]">
            {time}
          </span>
        ) : null}
      </button>
      {open && hasReasoning ? (
        <div
          id={bodyId}
          className="mt-1 rounded-[6px] border border-[var(--vex-line)] bg-[var(--vex-surface-down)] px-2.5 py-1.5"
        >
          <pre className="max-h-[280px] overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-[var(--vex-text-2)]">
            {entry.rationaleFull}
          </pre>
        </div>
      ) : null}
    </li>
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
