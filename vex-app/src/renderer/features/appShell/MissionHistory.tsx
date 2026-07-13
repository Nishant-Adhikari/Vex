/**
 * Mission History — a read-only AppShell sub-view (mission-results-ledger).
 *
 * The per-wallet ledger of finalized mission runs: a summary register (total
 * missions, win rate, cumulative ETH PnL) over a hand-rolled cumulative-PnL
 * sparkline, then one row per mission newest-first. It mirrors the MemoryPanel
 * shell grammar (h-12 register header + back key, hairline-separated ledger,
 * `--vex-*` ink) so it reads as one surface with the rest of the desk.
 *
 * Data comes from `useMissionResults` (already wired IPC) — the list arrives
 * newest-first, so rendering is a straight map; only the sparkline needs the
 * oldest→newest running sum (`cumulativePnlSeries`). All arithmetic + formatting
 * lives in `missionHistoryModel.ts`; this file is presentation over derived
 * values. PnL is coloured by sign (success/destructive), USD is a tooltip only.
 */

import type { JSX } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowLeft01Icon } from "@hugeicons/core-free-icons";
import type { Result } from "@shared/ipc/result.js";
import type {
  MissionListResultsResult,
  MissionResultDto,
} from "@shared/schemas/mission.js";
import { useUiStore } from "../../stores/uiStore.js";
import { useMissionResults } from "../../lib/api/mission.js";
import { formatPercentDelta, formatUsd } from "../../lib/format.js";
import { cn } from "../../lib/utils.js";
import { Empty, ErrorState, Loading } from "./MemoryPanelShared.js";
import {
  EM_DASH,
  computeWinRate,
  cumulativePnlSeries,
  formatDurationS,
  formatEth,
  pnlUsd,
  sparklinePoints,
  sumPnlEth,
} from "./missionHistoryModel.js";

const SPARK_W = 240;
const SPARK_H = 44;

export function MissionHistory(): JSX.Element {
  const setAppShellView = useUiStore((s) => s.setAppShellView);
  const query = useMissionResults();

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
          <Body query={query} />
        </div>
      </div>
    </div>
  );
}

/**
 * Query-state fork: pending → loading, thrown/transport error OR an `ok:false`
 * Result envelope → error, empty array → friendly empty state, else the ledger.
 * The `isPending`/`isError` guards narrow `query.data` to a defined `Result`.
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

function Ledger({
  results,
}: {
  readonly results: readonly MissionResultDto[];
}): JSX.Element {
  const winRate = computeWinRate(results);
  const cumulative = sumPnlEth(results);
  const series = cumulativePnlSeries(results);

  return (
    <>
      <SummaryHeader
        total={results.length}
        winRate={winRate}
        cumulativeEth={cumulative}
        series={series}
      />
      <ResultsTable results={results} />
    </>
  );
}

function SummaryHeader({
  total,
  winRate,
  cumulativeEth,
  series,
}: {
  readonly total: number;
  readonly winRate: number | null;
  readonly cumulativeEth: number;
  readonly series: readonly number[];
}): JSX.Element {
  return (
    <section className="flex flex-col gap-4 border-b border-[var(--vex-line)] pb-6">
      <div className="flex flex-wrap items-end gap-x-10 gap-y-4">
        <Stat label="Missions" value={String(total)} />
        <Stat
          label="Win rate"
          value={winRate === null ? EM_DASH : `${winRate.toFixed(0)}%`}
        />
        <Stat
          label="Cumulative PnL"
          value={`${formatEth(cumulativeEth, { signed: true })} ETH`}
          tone={pnlTone(cumulativeEth)}
        />
      </div>
      <Sparkline series={series} />
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
      <span
        className={cn(
          "font-mono text-lg tabular-nums",
          tone ?? "text-foreground",
        )}
      >
        {value}
      </span>
    </div>
  );
}

/**
 * Hand-rolled cumulative-PnL sparkline (no chart lib): a single polyline over
 * the running total, plus a hairline zero baseline so a dip below break-even
 * reads at a glance. The stroke takes the sign of the final cumulative value.
 */
function Sparkline({
  series,
}: {
  readonly series: readonly number[];
}): JSX.Element | null {
  if (series.length === 0) return null;
  const points = sparklinePoints(series, SPARK_W, SPARK_H, 3);
  const last = series[series.length - 1] ?? 0;
  const stroke =
    last > 0
      ? "var(--color-success)"
      : last < 0
        ? "var(--color-destructive)"
        : "var(--vex-text-3)";
  // Zero baseline in the same coordinate space as the polyline (a flat
  // series maps every point to the vertical middle, so the line + baseline
  // coincide — intentional).
  const min = Math.min(...series, 0);
  const max = Math.max(...series, 0);
  const span = max === min ? 1 : max - min;
  const zeroY = 3 + (SPARK_H - 6) * (1 - (0 - min) / span);

  return (
    <svg
      viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
      width={SPARK_W}
      height={SPARK_H}
      role="img"
      aria-label="Cumulative profit and loss over the mission history"
      className="max-w-full overflow-visible"
    >
      <line
        x1={0}
        y1={zeroY}
        x2={SPARK_W}
        y2={zeroY}
        stroke="var(--vex-line)"
        strokeWidth={1}
        strokeDasharray="2 3"
      />
      <polyline
        points={points}
        fill="none"
        stroke={stroke}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ResultsTable({
  results,
}: {
  readonly results: readonly MissionResultDto[];
}): JSX.Element {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left text-xs">
        <thead>
          <tr className="border-b border-[var(--vex-line)] font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--vex-text-3)]">
            <Th>#</Th>
            <Th>Goal</Th>
            <Th>Outcome</Th>
            <Th align="right">Duration</Th>
            <Th align="right">Trades</Th>
            <Th align="right">PnL</Th>
          </tr>
        </thead>
        <tbody>
          {results.map((r) => (
            <ResultRow key={r.missionRunId} result={r} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ResultRow({
  result,
}: {
  readonly result: MissionResultDto;
}): JSX.Element {
  const usd = pnlUsd(result.pnlEth, result.ethPriceUsdEnd);
  const pnlTitle =
    usd === null ? undefined : `${formatUsd(usd)} at close`;

  return (
    <tr className="border-b border-[var(--vex-line)] last:border-b-0 hover:bg-white/[0.02]">
      <td className="py-2.5 pr-3 font-mono tabular-nums text-[var(--vex-text-2)]">
        #{result.seqNo}
      </td>
      <td className="max-w-[220px] truncate py-2.5 pr-3 text-foreground">
        <span title={result.goalSnippet ?? undefined}>
          {result.goalSnippet ?? EM_DASH}
        </span>
      </td>
      <td className="py-2.5 pr-3">
        <OutcomeBadge outcome={result.outcome} />
      </td>
      <td className="py-2.5 pr-3 text-right font-mono tabular-nums text-[var(--vex-text-2)]">
        {formatDurationS(result.durationS)}
      </td>
      <td className="py-2.5 pr-3 text-right font-mono tabular-nums text-[var(--vex-text-2)]">
        {result.trades}
      </td>
      <td className="py-2.5 text-right">
        <span
          title={pnlTitle}
          className={cn("font-mono tabular-nums", pnlTone(result.pnlEth))}
        >
          {formatEth(result.pnlEth, { signed: true })} ETH
        </span>
        {result.pnlPct !== null ? (
          <span className="ml-2 font-mono text-[10px] tabular-nums text-[var(--vex-text-3)]">
            {formatPercentDelta(result.pnlPct)}
          </span>
        ) : null}
      </td>
    </tr>
  );
}

/** Outcome → small colour-toned stamp. `completed` = success, `failed` =
 * destructive, `running` = accent (still live), the rest stay muted. */
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
      {outcome.replace(/_/g, " ")}
    </span>
  );
}

function Th({
  children,
  align,
}: {
  readonly children: string;
  readonly align?: "right";
}): JSX.Element {
  return (
    <th
      className={cn(
        "py-2 pr-3 font-normal",
        align === "right" ? "text-right" : "text-left",
      )}
    >
      {children}
    </th>
  );
}

/** Sign → PnL colour class: positive success, negative destructive, flat muted. */
function pnlTone(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "text-[var(--vex-text-3)]";
  if (value > 0) return "text-[var(--color-success)]";
  if (value < 0) return "text-destructive";
  return "text-[var(--vex-text-2)]";
}
