/**
 * Dashboard — the operator's performance surface over the mission-results
 * ledger. Robinhood-shaped: a big account-value headline (seed + all-time PnL)
 * with a range-scoped P/L delta, a per-mission (or per-day) bar chart of wins
 * and losses, a stat register, then the newest-first mission table.
 *
 * It mirrors the MemoryPanel shell grammar (`vex-eyebrow` section labels,
 * mono filter pills, hairline-separated blocks, `--vex-*` ink) so it reads as
 * one surface with the rest of the desk. All arithmetic lives in
 * `missionHistoryModel.ts`; this file is presentation over derived values. ETH
 * is the native unit; USD is a display-only tooltip/aside. The view is
 * deliberately additive — new blocks (seed funding, open bags, fees) slot in
 * as more sections without reshaping this shell.
 */

import { useState, type JSX } from "react";
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
  bestWorst,
  computeWinRate,
  dailyBuckets,
  filterByRange,
  formatDurationS,
  formatEth,
  pnlUsd,
  returnPct,
  seedEth,
  sumPnlEth,
  type DashboardRange,
} from "./missionHistoryModel.js";

type Grouping = "mission" | "day";

const RANGES: readonly DashboardRange[] = ["1W", "1M", "3M", "ALL"];
const RANGE_LABEL: Record<DashboardRange, string> = {
  "1W": "past week",
  "1M": "past month",
  "3M": "past 3 months",
  ALL: "all time",
};

/** A single bar in the chart — one mission or one consolidated day. */
interface BarItem {
  readonly key: string;
  readonly label: string;
  readonly valueEth: number;
  /** Optional secondary line for the tooltip (mission count / goal). */
  readonly sub?: string;
}

export function MissionHistory(): JSX.Element {
  const setAppShellView = useUiStore((s) => s.setAppShellView);
  const query = useMissionResults();

  return (
    <div
      data-vex-screen="dashboard"
      className="flex h-full min-h-0 flex-col text-foreground"
    >
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
          Dashboard
        </h1>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto flex w-full max-w-[820px] flex-col gap-8">
          <Body query={query} />
        </div>
      </div>
    </div>
  );
}

function Body({
  query,
}: {
  readonly query: UseQueryResult<Result<MissionListResultsResult>>;
}): JSX.Element {
  if (query.isPending) return <Loading label="Loading dashboard…" />;
  if (query.isError) return <ErrorState message={query.error.message} />;
  const res = query.data;
  if (!res.ok) return <ErrorState message={res.error.message} />;
  if (res.data.length === 0) {
    return <Empty label="No missions yet — finish a mission to see it here." />;
  }
  return <Dashboard results={res.data} />;
}

function Dashboard({
  results,
}: {
  readonly results: readonly MissionResultDto[];
}): JSX.Element {
  const [range, setRange] = useState<DashboardRange>("ALL");
  const [grouping, setGrouping] = useState<Grouping>("mission");

  // Seed + account value are ALL-TIME (the origin never changes with a filter);
  // the delta + register below are scoped to the selected range.
  const seed = seedEth(results);
  const cumulativeAll = sumPnlEth(results);
  const accountEth = seed === null ? null : seed + cumulativeAll;
  const latestPrice = latestEthPrice(results);
  const accountUsd =
    accountEth !== null && latestPrice !== null ? accountEth * latestPrice : null;

  const ranged = filterByRange(results, range, Date.now());
  const rangedPnl = sumPnlEth(ranged);
  const rangedPct = returnPct(seed, rangedPnl);
  const rangedUsd = sumUsd(ranged);

  const bars = buildBars(ranged, grouping);
  const extremes = bestWorst(ranged);
  const winRate = computeWinRate(ranged);
  const totalTrades = ranged.reduce((n, r) => n + r.trades, 0);

  return (
    <>
      {/* ── Performance hero ─────────────────────────────────────── */}
      <section className="flex flex-col gap-5">
        <div>
          <h2 className="vex-eyebrow">Performance</h2>
          <p className="mt-1 text-xs text-[var(--vex-text-2)]">
            Account value is your seed plus realized PnL across every mission.
            The delta below is scoped to the selected range.
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-baseline gap-3">
            <span className="font-mono text-[34px] font-medium leading-none tabular-nums text-foreground">
              {accountEth === null ? EM_DASH : formatEth(accountEth)}
            </span>
            <span className="font-mono text-sm text-[var(--vex-text-3)]">ETH</span>
            {accountUsd !== null ? (
              <span className="font-mono text-sm tabular-nums text-[var(--vex-text-2)]">
                {formatUsd(accountUsd)}
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-2 font-mono text-sm tabular-nums">
            <span className={pnlTone(rangedPnl)}>
              {formatEth(rangedPnl, { signed: true })} ETH
            </span>
            {rangedPct !== null ? (
              <span className={pnlTone(rangedPnl)}>
                ({formatPercentDelta(rangedPct)})
              </span>
            ) : null}
            {rangedUsd !== null ? (
              <span className="text-[var(--vex-text-3)]">
                {formatUsd(rangedUsd)}
              </span>
            ) : null}
            <span className="text-[var(--vex-text-3)]">· {RANGE_LABEL[range]}</span>
          </div>
        </div>

        {/* Controls — range pills (left) + grouping toggle (right). */}
        <div className="flex flex-wrap items-center gap-2">
          {RANGES.map((r) => (
            <Pill key={r} active={range === r} onClick={() => setRange(r)}>
              {r}
            </Pill>
          ))}
          <div className="ml-auto flex items-center gap-2">
            <Pill
              active={grouping === "mission"}
              onClick={() => setGrouping("mission")}
            >
              By mission
            </Pill>
            <Pill active={grouping === "day"} onClick={() => setGrouping("day")}>
              By day
            </Pill>
          </div>
        </div>

        <BarChart items={bars} price={latestPrice} />
      </section>

      {/* ── Register ─────────────────────────────────────────────── */}
      <section className="flex flex-col gap-4 border-t border-[var(--vex-line)] pt-6">
        <h2 className="vex-eyebrow">Register</h2>
        <div className="grid grid-cols-2 gap-x-10 gap-y-4 sm:grid-cols-3">
          <Stat
            label="Seed"
            value={seed === null ? EM_DASH : `${formatEth(seed)} ETH`}
          />
          <Stat label="Missions" value={String(ranged.length)} />
          <Stat
            label="Win rate"
            value={winRate === null ? EM_DASH : `${winRate.toFixed(0)}%`}
          />
          <Stat
            label="Best"
            value={
              extremes === null
                ? EM_DASH
                : `${formatEth(extremes.best, { signed: true })} ETH`
            }
            tone={extremes === null ? undefined : pnlTone(extremes.best)}
          />
          <Stat
            label="Worst"
            value={
              extremes === null
                ? EM_DASH
                : `${formatEth(extremes.worst, { signed: true })} ETH`
            }
            tone={extremes === null ? undefined : pnlTone(extremes.worst)}
          />
          <Stat label="Trades" value={String(totalTrades)} />
        </div>
      </section>

      {/* ── Missions ledger ──────────────────────────────────────── */}
      <section className="flex flex-col gap-4 border-t border-[var(--vex-line)] pt-6">
        <h2 className="vex-eyebrow">Missions</h2>
        {ranged.length === 0 ? (
          <p className="text-xs text-[var(--vex-text-3)]">
            No missions in the {RANGE_LABEL[range]}.
          </p>
        ) : (
          <ResultsTable results={ranged} />
        )}
      </section>
    </>
  );
}

/** Latest closing ETH price (newest-first input → first finite `ethPriceUsdEnd`). */
function latestEthPrice(results: readonly MissionResultDto[]): number | null {
  for (const r of results) {
    if (r.ethPriceUsdEnd !== null && Number.isFinite(r.ethPriceUsdEnd)) {
      return r.ethPriceUsdEnd;
    }
  }
  return null;
}

/** Sum of per-mission USD PnL (each valued at its own close price; nulls skip). */
function sumUsd(results: readonly MissionResultDto[]): number | null {
  let sum = 0;
  let seen = false;
  for (const r of results) {
    const usd = pnlUsd(r.pnlEth, r.ethPriceUsdEnd);
    if (usd !== null) {
      sum += usd;
      seen = true;
    }
  }
  return seen ? sum : null;
}

/**
 * Chart items oldest→newest for the chosen grouping. "By mission" is one bar
 * per run (null PnL → a flat 0 bar); "By day" consolidates via `dailyBuckets`.
 * The input is newest-first, so the mission mapping reverses it.
 */
function buildBars(
  results: readonly MissionResultDto[],
  grouping: Grouping,
): BarItem[] {
  if (grouping === "day") {
    return dailyBuckets(results).map((b) => ({
      key: b.key,
      label: b.label,
      valueEth: b.valueEth,
      sub: `${b.count} mission${b.count === 1 ? "" : "s"}`,
    }));
  }
  const bars: BarItem[] = [];
  for (let i = results.length - 1; i >= 0; i -= 1) {
    const r = results[i]!;
    bars.push({
      key: r.missionRunId,
      label: `#${r.seqNo}`,
      valueEth: r.pnlEth ?? 0,
      sub: r.goalSnippet ?? undefined,
    });
  }
  return bars;
}

const CHART_H = 180;
const PAD_TOP = 14;
const PAD_BOTTOM = 26;
const SLOT = 72;
const MIN_W = 480;
const BAR_MAX_W = 40;

/**
 * Hand-rolled zero-baseline bar chart (no chart lib, mirrors the ledger's
 * sparkline approach): bars rise green above a dashed zero line and fall red
 * below it, scaled to the data's own min/max. Wider than its column when there
 * are many bars — the wrapper scrolls horizontally rather than crushing them.
 */
function BarChart({
  items,
  price,
}: {
  readonly items: readonly BarItem[];
  readonly price: number | null;
}): JSX.Element {
  if (items.length === 0) {
    return (
      <div className="flex h-[140px] items-center justify-center rounded-[6px] border border-dashed border-[var(--vex-line)] text-xs text-[var(--vex-text-3)]">
        No missions in this range.
      </div>
    );
  }

  const values = items.map((i) => i.valueEth);
  const max = Math.max(0, ...values);
  const min = Math.min(0, ...values);
  const span = max === min ? 1 : max - min;
  const innerH = CHART_H - PAD_TOP - PAD_BOTTOM;
  const yOf = (v: number): number =>
    PAD_TOP + innerH * (1 - (v - min) / span);
  const baselineY = yOf(0);

  const n = items.length;
  const width = Math.max(MIN_W, n * SLOT);
  const slotW = width / n;
  const barW = Math.min(slotW * 0.42, BAR_MAX_W);
  const showValue = n <= 8;

  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${width} ${CHART_H}`}
        width={width}
        height={CHART_H}
        role="img"
        aria-label="Profit and loss per mission"
        className="max-w-full"
      >
        {/* Zero baseline. */}
        <line
          x1={0}
          y1={baselineY}
          x2={width}
          y2={baselineY}
          stroke="var(--vex-line-strong)"
          strokeWidth={1}
          strokeDasharray="2 3"
        />
        {items.map((item, i) => {
          const xCenter = slotW * (i + 0.5);
          const yVal = yOf(item.valueEth);
          const top = Math.min(baselineY, yVal);
          const h = Math.max(1, Math.abs(baselineY - yVal));
          const positive = item.valueEth >= 0;
          const fill = positive
            ? "var(--color-success)"
            : "var(--color-destructive)";
          const usd = price !== null ? item.valueEth * price : null;
          const tip =
            `${item.label}: ${formatEth(item.valueEth, { signed: true })} ETH` +
            (usd !== null ? ` (${formatUsd(usd)})` : "") +
            (item.sub ? ` — ${item.sub}` : "");
          return (
            <g key={item.key}>
              <title>{tip}</title>
              <rect
                x={xCenter - barW / 2}
                y={top}
                width={barW}
                height={h}
                rx={2}
                fill={fill}
                opacity={0.9}
              />
              {showValue ? (
                <text
                  x={xCenter}
                  y={positive ? top - 5 : top + h + 12}
                  textAnchor="middle"
                  className="fill-[var(--vex-text-3)] font-mono"
                  fontSize={9}
                >
                  {formatEth(item.valueEth, { signed: true })}
                </text>
              ) : null}
              <text
                x={xCenter}
                y={CHART_H - 8}
                textAnchor="middle"
                className="fill-[var(--vex-text-3)] font-mono"
                fontSize={9}
              >
                {item.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function Pill({
  active,
  onClick,
  children,
}: {
  readonly active: boolean;
  readonly onClick: () => void;
  readonly children: string;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      data-active={active}
      className={cn(
        "rounded-[3px] px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vex-accent)]",
        active
          ? "bg-[var(--vex-accent-fill-12)] text-[var(--vex-accent-text)]"
          : "text-[var(--vex-text-2)] hover:bg-white/[0.04] hover:text-foreground",
      )}
    >
      {children}
    </button>
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
  const pnlTitle = usd === null ? undefined : `${formatUsd(usd)} at close`;

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
 * destructive, `timed_out` = warning, `running` = accent, the rest muted. */
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
