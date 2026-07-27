/**
 * Mission History — a read-only AppShell sub-view (mission-results-ledger,
 * WP-J). Per-wallet ledger of finalized mission runs: a summary register
 * (total missions, win rate, cumulative ETH PnL) then one row per mission,
 * newest first. Mirrors the MemoryPanel shell grammar (h-12 register header
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

import { useMemo, useState, type JSX } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowLeft01Icon } from "@hugeicons/core-free-icons";
import type { Result } from "@shared/ipc/result.js";
import type {
  MissionListResultsResult,
  MissionResultDto,
  SimulatorBatchEntryDto,
  SimulatorBatchReadResult,
} from "@shared/schemas/mission.js";
import { useUiStore, type PnlCurrency } from "../../stores/uiStore.js";
import {
  usePaperMissionResults,
  useMissionResults,
  useSimulatorLatestBatch,
} from "../../lib/api/mission.js";
import { useSessionsList } from "../../lib/api/sessions.js";
import { useAvailableWallets } from "../../lib/api/wallet-inventory.js";
import { formatPercentDelta } from "../../lib/format.js";
import {
  formatModelLabel,
  formatModelStackLabel,
} from "../../lib/model-label.js";
import { cn } from "../../lib/utils.js";
import { Empty, ErrorState, Loading } from "./MemoryPanelShared.js";
import { OutcomeBadge } from "./OutcomeBadge.js";
import { Button } from "../../components/ui/button.js";
import {
  EM_DASH,
  computeWinRate,
  deriveMissionHistoryTitle,
  filterMissionResults,
  formatCumulativePnl,
  formatDurationS,
  formatPnl,
  isUsdFallback,
  extractStrategyTag,
  summarizeByStrategy,
  type MissionHistoryFilter,
  missionDisplayOutcome,
  sumPnlEth,
} from "./missionHistoryModel.js";

function isProviderBlockedStopSummary(summary: string | null): boolean {
  return (
    summary !== null &&
    /(?:status|code)=40[13]\b|unauthorized|forbidden|budget limit exceeded/i.test(
      summary,
    )
  );
}

function describeBatchEntryStatus(entry: SimulatorBatchReadResult["entries"][number]): string {
  if (isProviderBlockedStopSummary(entry.stopSummary)) return "provider blocked";
  return entry.status;
}

function formatInferenceStamp(input: {
  readonly inferenceModel: string | null;
  readonly inferenceFallbackModel: string | null;
}): { readonly inline: string; readonly title: string } | null {
  if (input.inferenceModel === null) return null;
  const inline = formatModelStackLabel({
    primaryModelId: input.inferenceModel,
    fallbackModelId: input.inferenceFallbackModel,
  });
  return {
    inline: `model · ${inline ?? formatModelLabel(input.inferenceModel)}`,
    title: `Primary model: ${input.inferenceModel}${
      input.inferenceFallbackModel ? `\nFallback model: ${input.inferenceFallbackModel}` : ""
    }`,
  };
}

export function MissionHistory(): JSX.Element {
  const setAppShellView = useUiStore((s) => s.setAppShellView);
  const pnlCurrency = useUiStore((s) => s.pnlCurrency);
  const setPnlCurrency = useUiStore((s) => s.setPnlCurrency);
  const [filter, setFilter] = useState<MissionHistoryFilter>("all");
  const walletsQuery = useAvailableWallets();
  const sessionsQuery = useSessionsList();
  const primaryWallet =
    walletsQuery.data && walletsQuery.data.ok ? (walletsQuery.data.data.evm[0] ?? null) : null;
  const resultsQuery = useMissionResults(primaryWallet?.address ?? null);
  const paperResultsQuery = usePaperMissionResults();
  const simulatorBatchQuery = useSimulatorLatestBatch();
  const headerInferenceBadge = useMemo(() => {
    const liveResults = resultsQuery.data?.ok ? resultsQuery.data.data : [];
    const liveSample =
      liveResults.find((row) => row.inferenceModel !== null) ?? null;
    if (liveSample !== null) {
      const inline = formatModelStackLabel({
        primaryModelId: liveSample.inferenceModel,
        fallbackModelId: liveSample.inferenceFallbackModel,
      });
      return {
        inline: inline ?? formatModelLabel(liveSample.inferenceModel),
        title: `Primary model: ${liveSample.inferenceModel}${
          liveSample.inferenceFallbackModel
            ? `\nFallback model: ${liveSample.inferenceFallbackModel}`
            : ""
        }`,
      };
    }
    const paperResults =
      paperResultsQuery.data?.ok ? paperResultsQuery.data.data : [];
    const paperSample =
      paperResults.find((row) => row.inferenceModel !== null) ?? null;
    if (paperSample !== null) {
      const inline = formatModelStackLabel({
        primaryModelId: paperSample.inferenceModel,
        fallbackModelId: paperSample.inferenceFallbackModel,
      });
      return {
        inline: inline ?? formatModelLabel(paperSample.inferenceModel),
        title: `Primary model: ${paperSample.inferenceModel}${
          paperSample.inferenceFallbackModel
            ? `\nFallback model: ${paperSample.inferenceFallbackModel}`
            : ""
        }`,
      };
    }
    const simulatorPayload =
      simulatorBatchQuery.data?.ok ? simulatorBatchQuery.data.data : null;
    const simulatorSample =
      simulatorPayload?.entries.find((entry) => entry.inferenceModel !== null) ??
      null;
    if (simulatorSample === null || simulatorSample.inferenceModel === null) {
      return null;
    }
    const inline = formatModelStackLabel({
      primaryModelId: simulatorSample.inferenceModel,
      fallbackModelId: simulatorSample.inferenceFallbackModel,
    });
    return {
      inline: inline ?? formatModelLabel(simulatorSample.inferenceModel),
      title: `Primary model: ${simulatorSample.inferenceModel}${
        simulatorSample.inferenceFallbackModel
          ? `\nFallback model: ${simulatorSample.inferenceFallbackModel}`
          : ""
      }`,
    };
  }, [resultsQuery.data, paperResultsQuery.data, simulatorBatchQuery.data]);
  const titleBySession = useMemo(() => {
    const map = new Map<string, string | null>();
    if (sessionsQuery.data?.ok) {
      for (const session of sessionsQuery.data.data) {
        map.set(session.id, session.title);
      }
    }
    return map;
  }, [sessionsQuery.data]);

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
        {headerInferenceBadge ? (
          <div
            data-vex-area="missions-model-badge"
            className="inline-flex items-center gap-2 rounded-[8px] border border-[var(--vex-line-strong)] px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--vex-text-2)]"
            title={headerInferenceBadge.title}
          >
            <span className="text-[var(--vex-text-3)]">Model</span>
            <span className="normal-case tracking-normal text-foreground">
              {headerInferenceBadge.inline}
            </span>
          </div>
        ) : null}
        <MissionTypeFilter value={filter} onChange={setFilter} />
        {/* Denomination toggle — a persisted display preference (uiStore),
         * surfaced right where the PnL figures live rather than buried in the
         * reconfigure wizard. Defaults to USD. */}
        <PnlCurrencyToggle value={pnlCurrency} onChange={setPnlCurrency} />
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto flex w-full max-w-[760px] flex-col gap-6">
          {primaryWallet === null ? (
            <Empty label="No wallet available — add a wallet to see mission history." />
          ) : (
            <Body
              liveQuery={resultsQuery}
              paperQuery={paperResultsQuery}
              simulatorBatchQuery={simulatorBatchQuery}
              currency={pnlCurrency}
              filter={filter}
              titleBySession={titleBySession}
            />
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
  liveQuery,
  paperQuery,
  simulatorBatchQuery,
  currency,
  filter,
  titleBySession,
}: {
  readonly liveQuery: UseQueryResult<Result<MissionListResultsResult>>;
  readonly paperQuery: UseQueryResult<Result<MissionListResultsResult>>;
  readonly simulatorBatchQuery: UseQueryResult<Result<SimulatorBatchReadResult>>;
  readonly currency: PnlCurrency;
  readonly filter: MissionHistoryFilter;
  readonly titleBySession: ReadonlyMap<string, string | null>;
}): JSX.Element {
  if (liveQuery.isPending || paperQuery.isPending) {
    return <Loading label="Loading missions…" />;
  }
  if (liveQuery.isError) return <ErrorState message={liveQuery.error.message} />;
  if (paperQuery.isError) return <ErrorState message={paperQuery.error.message} />;
  const liveRes = liveQuery.data;
  const paperRes = paperQuery.data;
  if (!liveRes.ok) return <ErrorState message={liveRes.error.message} />;
  if (!paperRes.ok) return <ErrorState message={paperRes.error.message} />;
  const filtered =
    filter === "paper"
      ? paperRes.data
      : filter === "live"
        ? filterMissionResults(liveRes.data, "live")
        : [...paperRes.data, ...filterMissionResults(liveRes.data, "live")];
  const activePaperEntries = deriveVisiblePaperEntries({
    results: paperRes.data,
    simulatorBatchQuery,
    filter,
  });
  const showPaperBatch = filter !== "live";
  if (filtered.length === 0 && activePaperEntries.length === 0) {
    return (
      <>
        {showPaperBatch ? (
          <PaperBatchStatus query={simulatorBatchQuery} />
        ) : null}
        <Empty label="No missions yet — finish a mission to see it here." />
      </>
    );
  }
  return (
    <>
      {showPaperBatch ? (
        <PaperBatchStatus query={simulatorBatchQuery} />
      ) : null}
      {activePaperEntries.length > 0 ? (
        <ActivePaperMissionTable
          entries={activePaperEntries}
          titleBySession={titleBySession}
        />
      ) : null}
      {filtered.length > 0 ? (
        <Ledger results={filtered} currency={currency} titleBySession={titleBySession} />
      ) : null}
    </>
  );
}

function deriveVisiblePaperEntries({
  results,
  simulatorBatchQuery,
  filter,
}: {
  readonly results: readonly MissionResultDto[];
  readonly simulatorBatchQuery: UseQueryResult<Result<SimulatorBatchReadResult>>;
  readonly filter: MissionHistoryFilter;
}): readonly SimulatorBatchEntryDto[] {
  if (filter === "live") return [];
  if (simulatorBatchQuery.isPending || simulatorBatchQuery.isError || !simulatorBatchQuery.data?.ok) {
    return [];
  }
  const finalizedRunIds = new Set(results.map((result) => result.missionRunId));
  return simulatorBatchQuery.data.data.entries.filter(
    (entry) => entry.simulated && !finalizedRunIds.has(entry.missionRunId),
  );
}

function PaperBatchStatus({
  query,
}: {
  readonly query: UseQueryResult<Result<SimulatorBatchReadResult>>;
}): JSX.Element | null {
  const setActiveSessionId = useUiStore((s) => s.setActiveSessionId);
  const setAppShellView = useUiStore((s) => s.setAppShellView);

  if (query.isPending || query.isError || !query.data?.ok) return null;
  const payload = query.data.data;
  if (payload.batch === null || payload.entries.length === 0) return null;
  const providerBlockedEntries = payload.entries.filter((entry) =>
    isProviderBlockedStopSummary(entry.stopSummary),
  );
  const batchWideProviderBlock =
    providerBlockedEntries.length > 0 &&
    providerBlockedEntries.length === payload.entries.length;
  const providerBlockSummary =
    batchWideProviderBlock
      ? providerBlockedEntries[0]?.stopSummary ?? null
      : null;

  const openSession = (sessionId: string): void => {
    setActiveSessionId(sessionId);
    setAppShellView("session");
  };

  return (
    <section className="rounded-[12px] border border-[var(--vex-line)] bg-white/[0.02] p-4">
      {batchWideProviderBlock ? (
        <div className="mb-3 rounded-[10px] border border-red-500/30 bg-red-500/10 px-3 py-2">
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-red-200">
            Provider blocked
          </div>
          <div className="mt-1 text-sm text-red-100">
            {providerBlockedEntries.length}/{payload.entries.length} paper runs halted before strategy evaluation.
          </div>
          <div className="mt-1 text-[11px] text-red-200/90">
            This batch should not be treated as strategy signal.
          </div>
          {providerBlockSummary ? (
            <div className="mt-1 break-words text-[11px] text-red-200/80">
              {providerBlockSummary}
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--vex-text-3)]">
            Latest paper batch
          </div>
          <div className="mt-1 text-sm text-foreground">
            {payload.batch.completedCount}/{payload.batch.launchedCount} complete
          </div>
        </div>
        <div className="text-right text-[11px] text-[var(--vex-text-2)]">
          <div>{payload.batch.id}</div>
          <div>
            Leader:{" "}
            {payload.leaderStrategyId
              ? (payload.strategies.find((strategy) => strategy.id === payload.leaderStrategyId)
                  ?.name ?? "Unknown")
              : "Current baseline"}
          </div>
        </div>
      </div>

      <div className="space-y-2">
        {payload.entries.map((entry) => (
          (() => {
            const stamp = formatInferenceStamp(entry);
            return (
          <div
            key={entry.missionRunId}
            className="flex items-center justify-between gap-3 rounded-[8px] border border-[var(--vex-line)] px-3 py-2"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-medium text-foreground">{entry.strategyName}</span>
                <span
                  className={cn(
                    "font-mono text-[10px] uppercase tracking-[0.12em]",
                    isProviderBlockedStopSummary(entry.stopSummary)
                      ? "text-red-200"
                      : "text-[var(--vex-text-3)]",
                  )}
                >
                  {describeBatchEntryStatus(entry)}
                </span>
              </div>
              <div className="text-[11px] text-[var(--vex-text-2)]">{entry.shortRule}</div>
              {stamp ? (
                <div
                  className="truncate font-mono text-[10px] text-[var(--vex-text-3)]"
                  title={stamp.title}
                >
                  {stamp.inline}
                </div>
              ) : null}
              {entry.stopSummary ? (
                <div className="mt-1 break-words text-[11px] text-[var(--vex-text-3)]">
                  {entry.stopSummary}
                </div>
              ) : null}
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => openSession(entry.sessionId)}
              className="h-8 shrink-0 rounded-[6px] border border-[var(--vex-line-strong)] px-3 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--vex-text-2)] hover:text-foreground"
            >
              Open
            </Button>
          </div>
            );
          })()
        ))}
      </div>
    </section>
  );
}

function Ledger({
  results,
  currency,
  titleBySession,
}: {
  readonly results: readonly MissionResultDto[];
  readonly currency: PnlCurrency;
  readonly titleBySession: ReadonlyMap<string, string | null>;
}): JSX.Element {
  const winRate = computeWinRate(results);

  return (
    <>
      <SummaryHeader total={results.length} winRate={winRate} results={results} currency={currency} />
      <StrategySummary results={results} />
      <ResultsTable results={results} currency={currency} titleBySession={titleBySession} />
    </>
  );
}

function ActivePaperMissionTable({
  entries,
  titleBySession,
}: {
  readonly entries: readonly SimulatorBatchEntryDto[];
  readonly titleBySession: ReadonlyMap<string, string | null>;
}): JSX.Element {
  return (
    <section className="border-b border-[var(--vex-line)] pb-6">
      <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--vex-text-3)]">
        Active paper missions
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-xs">
          <thead>
            <tr className="border-b border-[var(--vex-line)] font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--vex-text-3)]">
              <Th>#</Th>
              <Th>Mission</Th>
              <Th>Strategy</Th>
              <Th>Outcome</Th>
              <Th align="right">Duration</Th>
              <Th align="right">Trades</Th>
              <Th align="right">PnL (USD)</Th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <ActivePaperRow
                key={entry.missionRunId}
                entry={entry}
                sessionTitle={titleBySession.get(entry.sessionId) ?? null}
              />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ActivePaperRow({
  entry,
  sessionTitle,
}: {
  readonly entry: SimulatorBatchEntryDto;
  readonly sessionTitle: string | null;
}): JSX.Element {
  const setActiveSessionId = useUiStore((s) => s.setActiveSessionId);
  const setAppShellView = useUiStore((s) => s.setAppShellView);
  const open = (): void => {
    setActiveSessionId(entry.sessionId);
    setAppShellView("session");
  };
  const missionTitle = sessionTitle?.trim() || "Paper Mission";
  const inferenceStamp = formatInferenceStamp(entry);

  return (
    <tr
      role="button"
      tabIndex={0}
      aria-label={`Open paper mission — ${missionTitle}`}
      onClick={open}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          open();
        }
      }}
      className="cursor-pointer border-b border-[var(--vex-line)] last:border-b-0 hover:bg-white/[0.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vex-accent)] focus-visible:ring-inset"
    >
      <td className="py-2.5 pr-3 font-mono tabular-nums text-[var(--vex-text-3)]">{EM_DASH}</td>
      <td className="max-w-[220px] truncate py-2.5 pr-3 text-foreground">
        <span
          className="mr-1.5 rounded-[3px] border border-[var(--vex-accent)]/40 px-1 font-mono text-[9px] uppercase tracking-[0.08em] text-[var(--vex-accent)]"
          title="Simulator run — paper-traded, no real transactions"
        >
          SIM
        </span>
        <div className="min-w-0">
          <div className="truncate font-medium" title={missionTitle}>
            {missionTitle}
          </div>
          <div className="truncate text-[11px] text-[var(--vex-text-3)]" title={entry.shortRule}>
            {entry.shortRule}
          </div>
          {inferenceStamp ? (
            <div
              className="truncate font-mono text-[10px] text-[var(--vex-text-3)]"
              title={inferenceStamp.title}
            >
              {inferenceStamp.inline}
            </div>
          ) : null}
        </div>
      </td>
      <td className="py-2.5 pr-3">
        <span className="rounded-[4px] border border-[var(--vex-line-strong)] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--vex-text-2)]">
          {entry.strategyName}
        </span>
      </td>
      <td className="py-2.5 pr-3">
        <OutcomeBadge outcome="running" />
      </td>
      <td className="py-2.5 pr-3 text-right font-mono tabular-nums text-[var(--vex-text-3)]">
        {EM_DASH}
      </td>
      <td className="py-2.5 pr-3 text-right font-mono tabular-nums text-[var(--vex-text-2)]">
        {entry.trades ?? 0}
      </td>
      <td className="py-2.5 text-right font-mono tabular-nums text-[var(--vex-text-3)]">
        {EM_DASH}
      </td>
    </tr>
  );
}

function MissionTypeFilter({
  value,
  onChange,
}: {
  readonly value: MissionHistoryFilter;
  readonly onChange: (next: MissionHistoryFilter) => void;
}): JSX.Element {
  const options: readonly { value: MissionHistoryFilter; label: string }[] = [
    { value: "all", label: "All" },
    { value: "live", label: "Live" },
    { value: "paper", label: "Paper" },
  ];
  return (
    <div
      role="radiogroup"
      aria-label="Mission type"
      className="ml-auto flex items-center gap-0.5 rounded-[6px] border border-[var(--vex-line)] p-0.5"
    >
      {options.map((option) => {
        const active = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.value)}
            className={cn(
              "rounded-[4px] px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.16em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vex-accent)]",
              active
                ? "bg-[var(--vex-accent-fill-12)] text-foreground"
                : "text-[var(--vex-text-3)] hover:text-foreground",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function SummaryHeader({
  total,
  winRate,
  results,
  currency,
}: {
  readonly total: number;
  readonly winRate: number | null;
  readonly results: readonly MissionResultDto[];
  readonly currency: PnlCurrency;
}): JSX.Element {
  // Sign (and therefore colour) is denomination-independent — a positive ETH
  // PnL is a positive USD PnL — so tone tracks the ETH total either way.
  const cumulativeEth = sumPnlEth(results);
  return (
    <section className="flex flex-wrap items-end gap-x-10 gap-y-4 border-b border-[var(--vex-line)] pb-6">
      <Stat label="Missions" value={String(total)} />
      <Stat label="Win rate" value={winRate === null ? EM_DASH : `${winRate.toFixed(0)}%`} />
      <Stat
        label="Cumulative PnL"
        value={formatCumulativePnl(results, currency)}
        tone={pnlTone(cumulativeEth)}
      />
    </section>
  );
}

/**
 * ETH | USD segmented control — a two-button `radiogroup`. Persisted preference
 * (uiStore); flipping it re-denominates the cumulative + per-row PnL in place.
 */
function PnlCurrencyToggle({
  value,
  onChange,
}: {
  readonly value: PnlCurrency;
  readonly onChange: (next: PnlCurrency) => void;
}): JSX.Element {
  return (
    <div
      role="radiogroup"
      aria-label="PnL denomination"
      className="ml-auto flex items-center gap-0.5 rounded-[6px] border border-[var(--vex-line)] p-0.5"
    >
      {(["usd", "eth"] as const).map((option) => {
        const active = value === option;
        return (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option)}
            className={cn(
              "rounded-[4px] px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.16em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vex-accent)]",
              active
                ? "bg-[var(--vex-accent-fill-12)] text-foreground"
                : "text-[var(--vex-text-3)] hover:text-foreground",
            )}
          >
            {option === "usd" ? "USD" : "ETH"}
          </button>
        );
      })}
    </div>
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
  currency,
  titleBySession,
}: {
  readonly results: readonly MissionResultDto[];
  readonly currency: PnlCurrency;
  readonly titleBySession: ReadonlyMap<string, string | null>;
}): JSX.Element {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left text-xs">
        <thead>
          <tr className="border-b border-[var(--vex-line)] font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--vex-text-3)]">
            <Th>#</Th>
            <Th>Mission</Th>
            <Th>Strategy</Th>
            <Th>Outcome</Th>
            <Th align="right">Duration</Th>
            <Th align="right">Trades</Th>
            <Th align="right">{currency === "usd" ? "PnL (USD)" : "PnL (ETH)"}</Th>
          </tr>
        </thead>
        <tbody>
          {results.map((r) => (
            <ResultRow
              key={r.missionRunId}
              result={r}
              currency={currency}
              sessionTitle={titleBySession.get(r.sessionId) ?? null}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ResultRow({
  result,
  currency,
  sessionTitle,
}: {
  readonly result: MissionResultDto;
  readonly currency: PnlCurrency;
  readonly sessionTitle: string | null;
}): JSX.Element {
  // FAIL-SOFT: USD selected but this run has no captured close price -> the
  // cell shows ETH; a title explains why so the mixed unit isn't a surprise.
  const fellBack = isUsdFallback(currency, result.pnlEth, result.ethPriceUsdEnd);
  const pnlTitle = fellBack ? "No close price recorded — showing ETH" : undefined;

  // The row is a link into its mission's session: opening the session mounts
  // MissionControls, whose finalized-result branch renders MissionSummaryCard
  // (the retrospective/lessons + trade rationale generate lazily on mount).
  // Mirrors the sidebar (SessionsList.handleSelect) and the Active Missions bar:
  // set the active session, then force the panel back to the session view.
  const setActiveSessionId = useUiStore((s) => s.setActiveSessionId);
  const setAppShellView = useUiStore((s) => s.setAppShellView);
  const open = (): void => {
    setActiveSessionId(result.sessionId);
    setAppShellView("session");
  };
  const missionTitle = deriveMissionHistoryTitle(result, sessionTitle);
  const strategyTag = extractStrategyTag(result.goalSnippet);
  const inferenceTitle =
    result.inferenceModel === null
      ? undefined
      : `Primary model: ${result.inferenceModel}${
          result.inferenceFallbackModel
            ? `\nFallback model: ${result.inferenceFallbackModel}`
            : ""
        }`;

  return (
    <tr
      role="button"
      tabIndex={0}
      aria-label={`Open mission #${result.seqNo}${
        result.goalSnippet ? ` — ${result.goalSnippet}` : ""
      }`}
      onClick={open}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          open();
        }
      }}
      className="cursor-pointer border-b border-[var(--vex-line)] last:border-b-0 hover:bg-white/[0.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vex-accent)] focus-visible:ring-inset"
    >
      <td className="py-2.5 pr-3 font-mono tabular-nums text-[var(--vex-text-2)]">
        #{result.seqNo}
      </td>
      <td className="max-w-[220px] truncate py-2.5 pr-3 text-foreground">
        {result.simulated ? (
          <span
            className="mr-1.5 rounded-[3px] border border-[var(--vex-accent)]/40 px-1 font-mono text-[9px] uppercase tracking-[0.08em] text-[var(--vex-accent)]"
            title="Simulator run — paper-traded, no real transactions"
          >
            SIM
          </span>
        ) : null}
        <div className="min-w-0">
          <div className="truncate font-medium" title={missionTitle}>
            {missionTitle}
          </div>
          <div
            className="truncate text-[11px] text-[var(--vex-text-3)]"
            title={result.goalSnippet ?? undefined}
          >
            {result.goalSnippet ?? EM_DASH}
          </div>
          {result.inferenceModel ? (
            <div
              className="truncate font-mono text-[10px] text-[var(--vex-text-3)]"
              title={inferenceTitle}
            >
              {formatInferenceStamp({
                inferenceModel: result.inferenceModel,
                inferenceFallbackModel: result.inferenceFallbackModel,
              })?.inline ?? `model · ${formatModelLabel(result.inferenceModel)}`}
            </div>
          ) : null}
        </div>
      </td>
      <td className="py-2.5 pr-3">
        {strategyTag ? (
          <span className="rounded-[4px] border border-[var(--vex-line-strong)] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--vex-text-2)]">
            {strategyTag}
          </span>
        ) : (
          <span className="text-[var(--vex-text-3)]">{EM_DASH}</span>
        )}
      </td>
      <td className="py-2.5 pr-3">
        <OutcomeBadge outcome={missionDisplayOutcome(result)} />
      </td>
      <td className="py-2.5 pr-3 text-right font-mono tabular-nums text-[var(--vex-text-2)]">
        {formatDurationS(result.durationS)}
      </td>
      <td className="py-2.5 pr-3 text-right font-mono tabular-nums text-[var(--vex-text-2)]">
        {result.trades}
      </td>
      <td className="py-2.5 text-right">
        <span title={pnlTitle} className={cn("font-mono tabular-nums", pnlTone(result.pnlEth))}>
          {formatPnl(result.pnlEth, currency, result.ethPriceUsdEnd)}
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

function Th({
  children,
  align,
}: {
  readonly children: string;
  readonly align?: "right";
}): JSX.Element {
  return (
    <th className={cn("py-2 pr-3 font-normal", align === "right" ? "text-right" : "text-left")}>
      {children}
    </th>
  );
}

/** Sign -> PnL colour class: positive success, negative destructive, flat/unknown muted. */
function pnlTone(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "text-[var(--vex-text-3)]";
  if (value > 0) return "text-[var(--color-success)]";
  if (value < 0) return "text-destructive";
  return "text-[var(--vex-text-2)]";
}

function StrategySummary({
  results,
}: {
  readonly results: readonly MissionResultDto[];
}): JSX.Element | null {
  const stats = summarizeByStrategy(results);
  if (stats.length === 0) return null;
  return (
    <section className="border-b border-[var(--vex-line)] pb-6">
      <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--vex-text-3)]">
        By strategy
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-xs">
          <thead>
            <tr className="border-b border-[var(--vex-line)] font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--vex-text-3)]">
              <Th>Strategy</Th>
              <Th align="right">Runs</Th>
              <Th align="right">Win rate</Th>
              <Th align="right">Avg PnL (ETH)</Th>
              <Th align="right">Flat close</Th>
              <Th align="right">Deadline flatten</Th>
            </tr>
          </thead>
          <tbody>
            {stats.map((stat) => (
              <tr key={stat.tag} className="border-b border-[var(--vex-line)] last:border-b-0">
                <td className="py-2.5 pr-3 font-mono text-[11px] uppercase tracking-[0.08em] text-foreground">
                  {stat.tag}
                </td>
                <td className="py-2.5 pr-3 text-right font-mono tabular-nums text-[var(--vex-text-2)]">
                  {stat.runs}
                </td>
                <td className="py-2.5 pr-3 text-right font-mono tabular-nums text-[var(--vex-text-2)]">
                  {stat.winRate === null ? EM_DASH : `${stat.winRate.toFixed(0)}%`}
                </td>
                <td className={cn("py-2.5 text-right font-mono tabular-nums", pnlTone(stat.avgPnlEth))}>
                  {stat.avgPnlEth === null ? EM_DASH : `${stat.avgPnlEth > 0 ? "+" : ""}${stat.avgPnlEth.toFixed(4)} ETH`}
                </td>
                <td className="py-2.5 pr-3 text-right font-mono tabular-nums text-[var(--vex-text-2)]">
                  {stat.flatCloseRate === null ? EM_DASH : `${stat.flatCloseRate.toFixed(0)}%`}
                </td>
                <td className="py-2.5 text-right font-mono tabular-nums text-[var(--vex-text-2)]">
                  {stat.deadlineFlattenRate === null
                    ? EM_DASH
                    : `${stat.deadlineFlattenRate.toFixed(0)}%`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[11px] text-[var(--vex-text-3)]">
        Clean-exit rate and initials-at-2x are not shown yet because the mission ledger does not persist those events explicitly. Flat close and deadline flatten are factual end-state metrics from stored mission data.
      </p>
    </section>
  );
}
