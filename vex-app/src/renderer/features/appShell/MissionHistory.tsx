/**
 * Mission History — a read-only AppShell sub-view (mission-results-ledger,
 * WP-J). Per-wallet ledger of finalized mission runs: a summary register
 * (total missions, win rate, cumulative ETH PnL) then one card per mission,
 * newest first. Each card leads with the ledger's PnL and the agent's own
 * plain-language account of the run; the raw counters sit underneath. Mirrors the MemoryPanel shell grammar (h-12 register header
 * + back key, hairline-separated ledger, `--vex-*` ink) so it reads as one
 * surface with the rest of the desk.
 *
 * The ledger is EVM/ETH-specific (bankroll = native ETH + WETH), so this
 * reads the PRIMARY EVM wallet from the inventory — never every wallet.
 *
 * All arithmetic + formatting lives in `missionHistoryModel.ts`; this file
 * is presentation over derived values. Naming: "mission result (ETH)" —
 * never "performance".
 */

import type { JSX } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowLeft01Icon, Cancel01Icon } from "@hugeicons/core-free-icons";
import type { Result } from "@shared/ipc/result.js";
import type { MissionListResultsResult, MissionResultDto } from "@shared/schemas/mission.js";
import { useUiStore } from "../../stores/uiStore.js";
import { useMissionResults } from "../../lib/api/mission.js";
import { useAvailableWallets } from "../../lib/api/wallet-inventory.js";
import { formatPercentDelta, formatUsdDelta } from "../../lib/format.js";
import { cn } from "../../lib/utils.js";
import { Empty, ErrorState, Loading } from "./MemoryPanelShared.js";
import { OutcomeBadge } from "./OutcomeBadge.js";
import { parseSummaryBullets } from "./missionSummaryProse.js";
import {
  EM_DASH,
  computeWinRate,
  formatDurationS,
  formatEth,
  missionDisplayOutcome,
  pnlUsd,
  sumPnlEth,
} from "./missionHistoryModel.js";

export function MissionHistory(): JSX.Element {
  const setAppShellView = useUiStore((s) => s.setAppShellView);
  const walletsQuery = useAvailableWallets();
  const primaryWallet =
    walletsQuery.data && walletsQuery.data.ok ? (walletsQuery.data.data.evm[0] ?? null) : null;
  const resultsQuery = useMissionResults(primaryWallet?.address ?? null);

  return (
    <div
      data-vex-screen="missionHistory"
      className="flex h-full min-h-0 flex-col text-foreground"
    >
      {/* Register header — same h-12 datum + quiet back key as the Memory
       * panel; the affordance is an icon, never a chrome pill. */}
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-[var(--vex-line)] px-6">
        <button
          type="button"
          onClick={() => setAppShellView("session")}
          aria-label="Back to chat"
          className="flex h-8 w-8 items-center justify-center rounded-[6px] text-[var(--vex-text-2)] transition-colors hover:bg-white/[0.04] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vex-accent)]"
        >
          <HugeiconsIcon icon={ArrowLeft01Icon} size={17} aria-hidden />
        </button>
        <h1 className="font-mono text-[13px] font-medium uppercase tracking-[0.3em] text-foreground">
          Missions
        </h1>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto flex w-full max-w-[760px] flex-col gap-6">
          {primaryWallet === null ? (
            <Empty label="No wallet available — add a wallet to see mission history." />
          ) : (
            <Body query={resultsQuery} />
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Query-state fork: pending -> loading, thrown/transport error OR an
 * `ok:false` Result envelope -> error, empty array -> friendly empty state,
 * else the ledger.
 */
function Body({
  query,
}: {
  readonly query: UseQueryResult<Result<MissionListResultsResult>>;
}): JSX.Element {
  if (query.isPending) return <Loading label="Loading missions…" />;
  if (query.isError) return <ErrorState message={query.error.message} />;
  const res = query.data;
  if (!res.ok) return <ErrorState message={res.error.message} />;
  if (res.data.length === 0) {
    return <Empty label="No missions yet — finish a mission to see it here." />;
  }
  return <Ledger results={res.data} />;
}

/**
 * Dismissal is a VIEW filter, deliberately applied here and nowhere else.
 *
 * The register totals below are computed over `results` — every finished
 * run, including the dismissed ones. Hiding a card the operator has already
 * read must not quietly restate their win rate or cumulative PnL: the
 * numbers are an audit trail of real-money trades, and dismissing a card
 * changes what is on screen, never what is true.
 */
function Ledger({ results }: { readonly results: readonly MissionResultDto[] }): JSX.Element {
  const dismissed = useUiStore((s) => s.dismissedMissionRunIds);
  const restore = useUiStore((s) => s.restoreDismissedMissionRuns);

  // Totals over ALL results — see the note above.
  const winRate = computeWinRate(results);
  const cumulative = sumPnlEth(results);

  const visible = results.filter((r) => !dismissed.includes(r.missionRunId));
  const hiddenCount = results.length - visible.length;

  return (
    <>
      <SummaryHeader total={results.length} winRate={winRate} cumulativeEth={cumulative} />
      {visible.length === 0 && hiddenCount > 0 ? (
        <Empty label="Every mission is hidden — nothing has been deleted." />
      ) : (
        <ResultsLedger results={visible} />
      )}
      {hiddenCount > 0 ? (
        // Sits under the list as a quiet footer rather than as a row inside
        // it: a hidden card is not a ledger entry, and the list is now a
        // stack of cards with no row grammar to borrow.
        <div className="flex items-center gap-3 border-t border-[var(--vex-line)] pt-4 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--vex-text-3)]">
          <span>{hiddenCount} hidden — still counted above</span>
          <button
            type="button"
            onClick={restore}
            className="rounded-[4px] px-1.5 py-0.5 underline underline-offset-2 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vex-accent)]"
          >
            Show hidden
          </button>
        </div>
      ) : null}
    </>
  );
}

function SummaryHeader({
  total,
  winRate,
  cumulativeEth,
}: {
  readonly total: number;
  readonly winRate: number | null;
  readonly cumulativeEth: number;
}): JSX.Element {
  return (
    <section className="flex flex-wrap items-end gap-x-10 gap-y-4 border-b border-[var(--vex-line)] pb-6">
      <Stat label="Missions" value={String(total)} />
      <Stat label="Win rate" value={winRate === null ? EM_DASH : `${winRate.toFixed(0)}%`} />
      <Stat
        label="Cumulative PnL"
        value={`${formatEth(cumulativeEth, { signed: true })} ETH`}
        tone={pnlTone(cumulativeEth)}
      />
    </section>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  readonly label: string;
  readonly value: string;
  readonly tone?: string;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-1">
      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--vex-text-3)]">
        {label}
      </span>
      <span className={cn("font-mono text-lg tabular-nums", tone ?? "text-foreground")}>
        {value}
      </span>
    </div>
  );
}

function ResultsLedger({
  results,
}: {
  readonly results: readonly MissionResultDto[];
}): JSX.Element {
  return (
    <ul className="flex flex-col">
      {results.map((r) => (
        <ResultRow key={r.missionRunId} result={r} />
      ))}
    </ul>
  );
}

/**
 * One mission, as a card.
 *
 * Reading order is deliberate: the money figure, then the agent's own
 * account of the run, then the raw counters. The prose is what a
 * non-technical operator actually reads, so it is body text in the middle
 * of the card — not a tooltip and not a sixth column.
 *
 * The two halves have different authors and must not be confused. The PnL
 * line is computed HERE from the ledger's `pnlEth`/`ethPriceUsdEnd`; the
 * prose is rendered verbatim and is never parsed for numbers. An agent that
 * contradicts the ledger is a prompt bug (see `mission-run.ts`), and the
 * figure the user sees stays right regardless.
 */
function ResultRow({ result }: { readonly result: MissionResultDto }): JSX.Element {
  const dismiss = useUiStore((s) => s.dismissMissionRun);
  const usd = pnlUsd(result.pnlEth, result.ethPriceUsdEnd);
  const beats = parseSummaryBullets(result.stopSummary);

  return (
    <li className="flex flex-col gap-3 border-b border-[var(--vex-line)] py-4 last:border-b-0">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] tabular-nums text-[var(--vex-text-3)]">
              #{result.seqNo}
            </span>
            <OutcomeBadge outcome={missionDisplayOutcome(result)} />
          </div>
          <span className="truncate text-xs text-[var(--vex-text-2)]" title={result.goalSnippet ?? undefined}>
            {result.goalSnippet ?? EM_DASH}
          </span>
        </div>

        <div className="flex shrink-0 items-start gap-3">
          {/* Authoritative money, straight off the ledger row. */}
          <div className={cn("flex flex-col items-end gap-0.5", pnlTone(result.pnlEth))}>
            <span className="font-mono text-base tabular-nums">
              {usd === null ? EM_DASH : formatUsdDelta(usd)}
            </span>
            <span className="font-mono text-[10px] tabular-nums text-[var(--vex-text-3)]">
              {formatEth(result.pnlEth, { signed: true })} ETH
              {result.pnlPct !== null ? ` · ${formatPercentDelta(result.pnlPct)}` : ""}
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
            className="flex h-6 w-6 items-center justify-center rounded-[6px] text-[var(--vex-text-3)] transition-colors hover:bg-white/[0.04] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vex-accent)]"
          >
            <HugeiconsIcon icon={Cancel01Icon} size={13} aria-hidden />
          </button>
        </div>
      </div>

      {beats.length > 0 ? (
        <ul className="flex flex-col gap-1.5 text-[13px] leading-relaxed text-foreground">
          {beats.map((beat, i) => (
            // Beats are positional prose with no stable id; the list is
            // re-rendered wholesale whenever the summary changes.
            // eslint-disable-next-line react/no-array-index-key
            <li key={i} className="flex gap-2">
              <span aria-hidden className="select-none text-[var(--vex-text-3)]">
                —
              </span>
              <span>{beat}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {/* Raw counters, demoted below the account of what happened. */}
      <div className="flex gap-4 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--vex-text-3)]">
        <span>{formatDurationS(result.durationS)}</span>
        <span>
          {result.trades} {result.trades === 1 ? "trade" : "trades"}
        </span>
      </div>
    </li>
  );
}

/** Sign -> PnL colour class: positive success, negative destructive, flat/unknown muted. */
function pnlTone(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "text-[var(--vex-text-3)]";
  if (value > 0) return "text-[var(--color-success)]";
  if (value < 0) return "text-destructive";
  return "text-[var(--vex-text-2)]";
}
