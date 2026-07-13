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
import type { PortfolioRange } from "@shared/schemas/portfolio.js";
import { useUiStore } from "../../stores/uiStore.js";
import { useMissionResults } from "../../lib/api/mission.js";
import {
  usePortfolioScoped,
  usePortfolioSeries,
} from "../../lib/api/portfolio.js";
import { useAvailableWallets } from "../../lib/api/session-wallets.js";
import { formatPercentDelta, formatUsd } from "../../lib/format.js";
import { cn } from "../../lib/utils.js";
import { Empty, ErrorState, Loading } from "./MemoryPanelShared.js";
import { PortfolioChart } from "./PortfolioChart.js";
import {
  EM_DASH,
  bestWorst,
  computeWinRate,
  filterByRange,
  formatDurationS,
  formatEth,
  pnlUsd,
  returnPct,
  seedEth,
  sumPnlEth,
  type DashboardRange,
} from "./missionHistoryModel.js";

const RANGES: readonly DashboardRange[] = ["1W", "1M", "3M", "ALL"];
const RANGE_LABEL: Record<DashboardRange, string> = {
  "1W": "past week",
  "1M": "past month",
  "3M": "past 3 months",
  ALL: "all time",
};

const PF_RANGES: readonly PortfolioRange[] = ["1D", "1W", "1M", "ALL"];
const PF_RANGE_LABEL: Record<PortfolioRange, string> = {
  "1D": "today",
  "1W": "past week",
  "1M": "past month",
  ALL: "all time",
};

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

  // Seed + account value are ALL-TIME (the origin never changes with a filter);
  // the delta + stats below are scoped to the selected range.
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

  const extremes = bestWorst(ranged);
  const winRate = computeWinRate(ranged);
  const totalTrades = ranged.reduce((n, r) => n + r.trades, 0);

  return (
    <>
      {/* ── Portfolio equity curve (total value across all wallets) ── */}
      <PortfolioSection />

      {/* ── Mission performance ──────────────────────────────────── */}
      <section className="flex flex-col gap-5 border-t border-[var(--vex-line)] pt-7">
        <div>
          <h2 className="vex-eyebrow">Mission performance</h2>
          <p className="mt-1 text-xs text-[var(--vex-text-2)]">
            Realized PnL the missions produced — seed plus mission PnL. The
            delta below is scoped to the selected range.
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-baseline gap-3">
            <span className="font-mono text-[34px] font-medium leading-none tabular-nums text-foreground">
              {accountUsd === null ? EM_DASH : formatUsd(accountUsd)}
            </span>
            {accountEth !== null ? (
              <span className="font-mono text-sm tabular-nums text-[var(--vex-text-3)]">
                {formatEth(accountEth)} ETH
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-2 font-mono text-sm tabular-nums">
            <span className={pnlTone(rangedPnl)}>
              {usdText(rangedUsd, { signed: true })}
            </span>
            {rangedPct !== null ? (
              <span className={pnlTone(rangedPnl)}>
                ({formatPercentDelta(rangedPct)})
              </span>
            ) : null}
            <span className="text-[var(--vex-text-3)]">
              {formatEth(rangedPnl, { signed: true })} ETH
            </span>
            <span className="text-[var(--vex-text-3)]">· {RANGE_LABEL[range]}</span>
          </div>
        </div>

        {/* Range pills scope the delta + stats + table below. */}
        <div className="flex flex-wrap items-center gap-2">
          {RANGES.map((r) => (
            <Pill key={r} active={range === r} onClick={() => setRange(r)}>
              {r}
            </Pill>
          ))}
        </div>
      </section>

      {/* ── Stats ────────────────────────────────────────────────── */}
      <section className="flex flex-col gap-4 border-t border-[var(--vex-line)] pt-6">
        <h2 className="vex-eyebrow">Mission stats</h2>
        <div className="grid grid-cols-2 gap-x-10 gap-y-4 sm:grid-cols-3">
          <Stat
            label="Seed"
            value={usdText(seed !== null && latestPrice !== null ? seed * latestPrice : null)}
          />
          <Stat label="Missions" value={String(ranged.length)} />
          <Stat
            label="Win rate"
            value={winRate === null ? EM_DASH : `${winRate.toFixed(0)}%`}
          />
          <Stat
            label="Best"
            value={usdText(
              extremes !== null && latestPrice !== null ? extremes.best * latestPrice : null,
              { signed: true },
            )}
            tone={extremes === null ? undefined : pnlTone(extremes.best)}
          />
          <Stat
            label="Worst"
            value={usdText(
              extremes !== null && latestPrice !== null ? extremes.worst * latestPrice : null,
              { signed: true },
            )}
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

/**
 * Portfolio equity curve — total USD value over time, the Robinhood-shaped
 * headline. Defaults to the PRIMARY wallet (mirrors the BOOK Portfolio panel's
 * per-wallet filter): `null` override = Primary (first configured wallet),
 * `"__all__"` = every wallet, else a specific address. Both the live total and
 * the equity curve are scoped to the selection. Independent of the mission
 * range below — this is the money, not the missions.
 */
function PortfolioSection(): JSX.Element {
  const [range, setRange] = useState<PortfolioRange>("1D");

  // Per-wallet filter: build the option list from the configured inventory and
  // default to Primary (the first wallet). `selected` resolves the override.
  const availableWallets = useAvailableWallets();
  const walletOptions: readonly { readonly label: string; readonly address: string }[] =
    availableWallets.data?.ok
      ? [...availableWallets.data.data.evm, ...availableWallets.data.data.solana]
      : [];
  const primaryAddress = walletOptions[0]?.address ?? null;
  const [override, setOverride] = useState<string | null>(null);
  const selected = override ?? primaryAddress;
  const isAll = override === "__all__";

  // Live total: global when "All" (or no wallets configured), else wallet-scoped.
  const portfolio = usePortfolioScoped(
    isAll || selected === null
      ? { scope: "global" }
      : { scope: "wallet", walletAddress: selected },
  );
  // Curve: null wallet → global; else scoped to the selected wallet.
  const series = usePortfolioSeries(range, isAll ? null : selected);

  const live = portfolio.data?.ok ? portfolio.data.data : null;
  const points = series.data?.ok ? series.data.data.points : [];

  const totalUsd = live?.liveTotalUsd ?? null;
  const walletCount = live?.walletCount ?? null;

  const first = points.length > 0 ? points[0]!.totalUsd : null;
  const last = points.length > 0 ? points[points.length - 1]!.totalUsd : null;
  const change = first !== null && last !== null ? last - first : null;
  const changePct =
    change !== null && first !== null && first !== 0
      ? (change / first) * 100
      : null;

  const seriesFailed =
    series.isError || (series.data !== undefined && !series.data.ok);

  return (
    <section className="flex flex-col gap-5">
      <div>
        <h2 className="vex-eyebrow">Portfolio</h2>
        <p className="mt-1 text-xs text-[var(--vex-text-2)]">
          {isAll
            ? "Total value across all your wallets, live from on-chain balances."
            : "Live from on-chain balances for the selected wallet."}
        </p>
      </div>

      {walletOptions.length > 1 ? (
        <WalletFilter
          options={walletOptions}
          active={override}
          onSelect={setOverride}
        />
      ) : null}

      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline gap-3">
          <span className="font-mono text-[34px] font-medium leading-none tabular-nums text-foreground">
            {totalUsd === null ? EM_DASH : formatUsd(totalUsd)}
          </span>
          {walletCount !== null ? (
            <span className="font-mono text-sm text-[var(--vex-text-3)]">
              {walletCount} wallet{walletCount === 1 ? "" : "s"}
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-2 font-mono text-sm tabular-nums">
          {change === null ? (
            <span className="text-[var(--vex-text-3)]">No change yet</span>
          ) : (
            // Portfolio never shows red: green on a gain, neutral on a dip (so a
            // loss still isn't dressed up as green).
            <>
              <span className={pfDeltaTone(change)}>
                {change >= 0 ? "+" : "-"}
                {formatUsd(Math.abs(change))}
              </span>
              {changePct !== null ? (
                <span className={pfDeltaTone(change)}>
                  ({formatPercentDelta(changePct)})
                </span>
              ) : null}
            </>
          )}
          <span className="text-[var(--vex-text-3)]">
            · {PF_RANGE_LABEL[range]}
          </span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {PF_RANGES.map((r) => (
          <Pill key={r} active={range === r} onClick={() => setRange(r)}>
            {r}
          </Pill>
        ))}
      </div>

      {seriesFailed ? (
        <div className="flex h-[200px] items-center justify-center rounded-[6px] border border-dashed border-[var(--vex-line)] text-xs text-[var(--vex-text-3)]">
          Couldn&apos;t load the value history.
        </div>
      ) : (
        <PortfolioChart points={points} />
      )}
    </section>
  );
}

/**
 * Per-wallet pill row for the Portfolio section: "All" + one pill per configured
 * wallet. `active` is the raw override state — `null` means the default (Primary,
 * i.e. the first wallet), so the Primary pill carries `value: null` and matches.
 * Mirrors the BOOK Portfolio panel's `WalletFilter`.
 */
function WalletFilter({
  options,
  active,
  onSelect,
}: {
  readonly options: readonly { readonly label: string; readonly address: string }[];
  readonly active: string | null;
  readonly onSelect: (value: string | null) => void;
}): JSX.Element {
  const items: {
    readonly key: string;
    readonly label: string;
    readonly value: string | null;
  }[] = [
    { key: "__all__", label: "All", value: "__all__" },
    ...options.map((wallet, index) => ({
      key: wallet.address,
      label: wallet.label,
      value: index === 0 ? null : wallet.address,
    })),
  ];
  return (
    <div className="flex flex-wrap items-center gap-1">
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          onClick={() => onSelect(item.value)}
          className={cn(
            "rounded-[3px] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--vex-accent)]",
            item.value === active
              ? "bg-[var(--vex-accent-fill-12)] text-[var(--vex-accent-text)]"
              : "text-[var(--vex-text-3)] hover:bg-white/[0.04] hover:text-foreground",
          )}
        >
          {item.label}
        </button>
      ))}
    </div>
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
  // USD leads; the ETH figure moves to the hover title.
  const pnlTitle =
    result.pnlEth === null
      ? undefined
      : `${formatEth(result.pnlEth, { signed: true })} ETH at close`;

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
          {usd === null
            ? `${formatEth(result.pnlEth, { signed: true })} ETH`
            : usdText(usd, { signed: true })}
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

/**
 * Portfolio delta colour — never red. Green on a gain (or flat); a dip stays
 * neutral-muted rather than green, so a loss isn't mislabelled as a gain.
 */
function pfDeltaTone(change: number): string {
  return change >= 0 ? "text-[var(--color-success)]" : "text-[var(--vex-text-2)]";
}

/** USD display — the primary unit everywhere. `signed` prefixes +/- for deltas. */
function usdText(
  usd: number | null | undefined,
  opts: { readonly signed?: boolean } = {},
): string {
  if (usd === null || usd === undefined || !Number.isFinite(usd)) return EM_DASH;
  if (!opts.signed) return formatUsd(usd);
  return `${usd >= 0 ? "+" : "-"}${formatUsd(Math.abs(usd))}`;
}
