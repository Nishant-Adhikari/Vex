import { useEffect, useMemo, useState, type JSX } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowLeft01Icon } from "@hugeicons/core-free-icons";
import type { Result } from "@shared/ipc/result.js";
import type {
  MissionResultDto,
  SimulatorBatchHistoryItemDto,
  SimulatorStartBatchResult,
} from "@shared/schemas/mission.js";
import { useUiStore } from "../../stores/uiStore.js";
import { Button } from "../../components/ui/button.js";
import { SelectMenu } from "../../components/ui/select-menu.js";
import {
  usePaperMissionResults,
  useSimulatorBatchHistory,
  useSimulatorLatestBatch,
  useSimulatorStartBatch,
} from "../../lib/api/mission.js";
import { useSessionsList } from "../../lib/api/sessions.js";
import {
  formatModelLabel,
  formatModelStackLabel,
} from "../../lib/model-label.js";
import { cn } from "../../lib/utils.js";
import { Empty, ErrorState, Loading } from "./MemoryPanelShared.js";
import { OutcomeBadge } from "./OutcomeBadge.js";
import {
  deriveMissionHistoryTitle,
  extractStrategyTag,
  filterMissionResults,
  formatDurationS,
  formatPnl,
  missionDisplayOutcome,
} from "./missionHistoryModel.js";

function fmtScore(value: number | null): string {
  return value === null ? "—" : value.toFixed(1);
}

function fmtPct(value: number | null): string {
  return value === null ? "—" : `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function fmtEth(value: number | null): string {
  return value === null ? "—" : `${value > 0 ? "+" : ""}${value.toFixed(4)} ETH`;
}

type LaunchNotice =
  | { readonly tone: "info"; readonly message: string }
  | { readonly tone: "success"; readonly message: string }
  | { readonly tone: "error"; readonly message: string };

type SimulatorView = "strategy" | "prompts" | "batch" | "paperMissions";

function formatHeaderInferenceBadge(payload: NonNullable<NonNullable<ReturnType<typeof useSimulatorLatestBatch>["data"]>["data"]> | null): {
  readonly inline: string;
  readonly title: string;
} | null {
  const sample =
    payload?.entries.find((entry) => entry.inferenceModel !== null) ?? null;
  if (sample?.inferenceModel === null || sample === null) return null;
  const inline = formatModelStackLabel({
    primaryModelId: sample.inferenceModel,
    fallbackModelId: sample.inferenceFallbackModel,
  });
  return {
    inline: inline ?? formatModelLabel(sample.inferenceModel),
    title: `Primary model: ${sample.inferenceModel}${
      sample.inferenceFallbackModel
        ? `\nFallback model: ${sample.inferenceFallbackModel}`
        : ""
    }`,
  };
}

export function SimulatorPanel(): JSX.Element {
  const setAppShellView = useUiStore((s) => s.setAppShellView);
  const setActiveSessionId = useUiStore((s) => s.setActiveSessionId);
  const sessionsQuery = useSessionsList();
  const query = useSimulatorLatestBatch();
  const batchHistoryQuery = useSimulatorBatchHistory();
  const paperResultsQuery = usePaperMissionResults();
  const startBatch = useSimulatorStartBatch();
  const [leftVersion, setLeftVersion] = useState<string>("");
  const [rightVersion, setRightVersion] = useState<string>("");
  const [launchNotice, setLaunchNotice] = useState<LaunchNotice | null>(null);
  const [view, setView] = useState<SimulatorView>("batch");

  const payload = query.data?.ok ? query.data.data : null;
  const titleBySession = useMemo(() => {
    const map = new Map<string, string | null>();
    if (sessionsQuery.data?.ok) {
      for (const session of sessionsQuery.data.data) {
        map.set(session.id, session.title);
      }
    }
    return map;
  }, [sessionsQuery.data]);
  const paperResults = useMemo(() => {
    if (!paperResultsQuery.data?.ok) return [];
    return paperResultsQuery.data.data;
  }, [paperResultsQuery.data]);
  const winnerName = useMemo(() => {
    const winnerId = payload?.leaderStrategyId;
    if (!winnerId) return "Current baseline";
    return payload?.strategies.find((strategy) => strategy.id === winnerId)?.name ?? "Current baseline";
  }, [payload]);
  const recommendedName = useMemo(() => {
    const winnerId = payload?.promotedWinnerStrategyId;
    if (!winnerId) return "Current baseline";
    const winner =
      payload?.strategies.find((strategy) => strategy.id === winnerId)?.name ??
      "Current baseline";
    return payload?.promotedWinnerVersion
      ? `${winner} (${payload.promotedWinnerVersion})`
      : winner;
  }, [payload]);
  const promptVersionOptions = useMemo(
    () =>
      (payload?.promptVersions ?? []).map((version) => ({
        value: version.version,
        label: `${version.version} — ${version.strategyName}`,
      })),
    [payload],
  );
  const promptVersionMap = useMemo(
    () => new Map((payload?.promptVersions ?? []).map((version) => [version.version, version])),
    [payload],
  );
  const latestPromptVersion =
    payload?.promptVersions[payload.promptVersions.length - 1]?.version ?? "";
  const headerInferenceBadge = useMemo(
    () => formatHeaderInferenceBadge(payload),
    [payload],
  );

  useEffect(() => {
    if (payload === null) return;
    const baseline = payload.promptVersions[0]?.version ?? "";
    const latest = payload.promotedWinnerVersion ?? latestPromptVersion ?? baseline;
    setLeftVersion((current) =>
      current && promptVersionMap.has(current) ? current : baseline,
    );
    setRightVersion((current) =>
      current && promptVersionMap.has(current)
        ? current
        : latest || baseline,
    );
  }, [latestPromptVersion, payload, promptVersionMap]);

  const leftPromptVersion = leftVersion ? (promptVersionMap.get(leftVersion) ?? null) : null;
  const rightPromptVersion = rightVersion ? (promptVersionMap.get(rightVersion) ?? null) : null;

  const openSession = (sessionId: string): void => {
    setActiveSessionId(sessionId);
    setAppShellView("session");
  };

  const handleStartBatch = async (): Promise<void> => {
    setLaunchNotice({
      tone: "info",
      message: "Launching 5 paper strategies…",
    });
    try {
      const result: Result<SimulatorStartBatchResult> =
        await startBatch.mutateAsync({ durationMinutes: 120 });
      if (!result.ok) {
        setLaunchNotice({
          tone: "error",
          message: result.error.message,
        });
        return;
      }
      if (result.data.launched <= 0) {
        setLaunchNotice({
          tone: "error",
          message:
            "Batch request was accepted, but 0 strategies launched. Check local runtime/database readiness.",
        });
        return;
      }
      setLaunchNotice({
        tone: "success",
        message: `Launched ${result.data.launched}/${result.data.requested} paper strategies.`,
      });
    } catch (error) {
      setLaunchNotice({
        tone: "error",
        message: error instanceof Error ? error.message : "Failed to launch simulator batch.",
      });
    }
  };

  return (
    <div
      data-vex-screen="simulator"
      className="flex h-full min-h-0 flex-col text-foreground"
    >
      <header className="shrink-0 border-b border-[var(--vex-line)] px-6 py-3">
        <div className="mx-auto flex w-full max-w-[920px] flex-wrap items-center gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => setAppShellView("session")}
              aria-label="Back to chat"
              className="flex h-8 w-8 items-center justify-center rounded-[6px] text-[var(--vex-text-2)] transition-colors hover:bg-white/[0.04] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vex-accent)]"
            >
              <HugeiconsIcon icon={ArrowLeft01Icon} size={17} aria-hidden />
            </button>
            <h1 className="font-mono text-[13px] font-medium uppercase tracking-[0.3em] text-foreground">
              Simulator
            </h1>
          </div>

          <div className="flex min-w-0 flex-1 items-center justify-end gap-3">
            <SimulatorViewToggle value={view} onChange={setView} />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void handleStartBatch()}
              disabled={startBatch.isPending}
              className="h-8 shrink-0 rounded-[6px] border border-[var(--vex-line-strong)] px-3 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--vex-text-2)] hover:text-foreground"
            >
              {startBatch.isPending ? "Launching…" : "Run 5-strategy batch"}
            </Button>
          </div>
        </div>
      </header>

      <div className="vex-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-6">
        <div className="mx-auto flex w-full max-w-[920px] flex-col gap-6">
          <p className="text-xs text-[var(--vex-text-2)]">
            One click launches five paper missions in parallel. Same mission engine,
            same guardrails, same inference loop — only signing and broadcast are disabled.
          </p>
          {headerInferenceBadge ? (
            <div
              data-vex-area="simulator-model-badge"
              className="inline-flex w-fit items-center gap-2 rounded-[8px] border border-[var(--vex-line-strong)] px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--vex-text-2)]"
              title={headerInferenceBadge.title}
            >
              <span className="text-[var(--vex-text-3)]">Model</span>
              <span className="normal-case tracking-normal text-foreground">
                {headerInferenceBadge.inline}
              </span>
            </div>
          ) : null}

          {launchNotice !== null ? (
            <div
              role="status"
              aria-live="polite"
              className={cn(
                "rounded-[10px] border px-4 py-3 text-sm",
                launchNotice.tone === "error"
                  ? "border-red-500/30 bg-red-500/10 text-red-200"
                  : launchNotice.tone === "success"
                    ? "border-[var(--vex-accent)]/30 bg-[var(--vex-accent)]/10 text-foreground"
                    : "border-[var(--vex-line-strong)] bg-white/[0.03] text-[var(--vex-text-2)]",
              )}
            >
              {launchNotice.message}
            </div>
          ) : null}

          {view === "paperMissions" ? (
            <PaperMissionLedger
              query={paperResultsQuery}
              titleBySession={titleBySession}
              onOpenSession={openSession}
            />
          ) : view === "strategy" ? (
            <StrategyScoreboard paperResults={paperResults} />
          ) : view === "prompts" ? (
            <PromptsView
              payload={payload}
              leftVersion={leftVersion}
              rightVersion={rightVersion}
              setLeftVersion={setLeftVersion}
              setRightVersion={setRightVersion}
              promptVersionOptions={promptVersionOptions}
              leftPromptVersion={leftPromptVersion}
              rightPromptVersion={rightPromptVersion}
            />
          ) : query.isPending ? (
            <Loading label="Loading simulator batch…" />
          ) : query.isError ? (
            <ErrorState message={query.error.message} />
          ) : query.data && !query.data.ok ? (
            <ErrorState message={query.data.error.message} />
          ) : payload === null || payload.batch === null ? (
            <Empty label="No simulator batch yet — run the first 5-strategy paper batch." />
          ) : (
            <>
              <section className="grid gap-4 border-b border-[var(--vex-line)] pb-6 md:grid-cols-4">
                <Stat label="Batch" value={payload.batch.id} compact />
                <Stat
                  label="Status"
                  value={`${payload.batch.completedCount}/${payload.batch.launchedCount} complete`}
                />
                <Stat
                  label="Leader"
                  value={winnerName}
                />
                <Stat
                  label="Live default"
                  value={recommendedName}
                />
              </section>

              <RecentBatchRuns
                query={batchHistoryQuery}
                currentBatchId={payload.batch.id}
              />
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left text-xs">
                  <thead>
                    <tr className="border-b border-[var(--vex-line)] font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--vex-text-3)]">
                      <Th>Strategy</Th>
                      <Th>Status</Th>
                      <Th align="right">Score</Th>
                      <Th align="right">PnL</Th>
                      <Th align="right">PnL %</Th>
                      <Th align="right">Trades</Th>
                      <Th>Mission</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {payload.entries.map((entry) => (
                      (() => {
                        const stamp =
                          entry.inferenceModel === null
                            ? null
                            : {
                                inline: `model · ${
                                  formatModelStackLabel({
                                    primaryModelId: entry.inferenceModel,
                                    fallbackModelId: entry.inferenceFallbackModel,
                                  }) ?? formatModelLabel(entry.inferenceModel)
                                }`,
                                title: `Primary model: ${entry.inferenceModel}${
                                  entry.inferenceFallbackModel
                                    ? `\nFallback model: ${entry.inferenceFallbackModel}`
                                    : ""
                                }`,
                              };
                        return (
                      <tr
                        key={entry.missionRunId}
                        className="border-b border-[var(--vex-line)] last:border-b-0 hover:bg-white/[0.02]"
                      >
                        <td className="py-2.5 pr-3">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <div className="font-medium text-foreground">{entry.strategyName}</div>
                            {entry.strategyId === payload.leaderStrategyId ? (
                              <span className="rounded-[4px] border border-[var(--vex-line-strong)] px-1 py-0.5 font-mono text-[9px] uppercase tracking-[0.08em] text-[var(--vex-text-2)]">
                                Leader
                              </span>
                            ) : null}
                            {entry.strategyId === payload.promotedWinnerStrategyId ? (
                              <span className="rounded-[4px] border border-[var(--vex-accent)]/40 px-1 py-0.5 font-mono text-[9px] uppercase tracking-[0.08em] text-[var(--vex-accent)]">
                                Live default
                              </span>
                            ) : null}
                          </div>
                          <div className="text-[11px] text-[var(--vex-text-3)]">
                            {entry.shortRule}
                          </div>
                          {stamp ? (
                            <div
                              className="truncate font-mono text-[10px] text-[var(--vex-text-3)]"
                              title={stamp.title}
                            >
                              {stamp.inline}
                            </div>
                          ) : null}
                        </td>
                        <td className="py-2.5 pr-3 text-[var(--vex-text-2)]">{entry.status}</td>
                        <td className="py-2.5 pr-3 text-right font-mono tabular-nums">
                          {fmtScore(entry.score)}
                        </td>
                        <td className="py-2.5 pr-3 text-right font-mono tabular-nums">
                          {fmtEth(entry.pnlEth)}
                        </td>
                        <td className="py-2.5 pr-3 text-right font-mono tabular-nums">
                          {fmtPct(entry.pnlPct)}
                        </td>
                        <td className="py-2.5 pr-3 text-right font-mono tabular-nums">
                          {entry.trades ?? 0}
                        </td>
                        <td className="py-2.5">
                          <button
                            type="button"
                            onClick={() => openSession(entry.sessionId)}
                            className={cn(
                              "font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--vex-accent)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vex-accent)]",
                            )}
                          >
                            Paper Mission
                          </button>
                        </td>
                      </tr>
                        );
                      })()
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function SimulatorViewToggle({
  value,
  onChange,
}: {
  readonly value: SimulatorView;
  readonly onChange: (next: SimulatorView) => void;
}): JSX.Element {
  const options: readonly { value: SimulatorView; label: string }[] = [
    { value: "strategy", label: "Strategy" },
    { value: "prompts", label: "Prompts" },
    { value: "batch", label: "Batch" },
    { value: "paperMissions", label: "Paper Missions" },
  ];
  return (
    <div
      role="radiogroup"
      aria-label="Simulator view"
      className="ml-auto flex max-w-full flex-wrap items-center justify-end gap-1 rounded-[6px] border border-[var(--vex-line)] p-1"
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
              "min-h-8 whitespace-nowrap rounded-[4px] px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vex-accent)]",
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

function PromptsView({
  payload,
  leftVersion,
  rightVersion,
  setLeftVersion,
  setRightVersion,
  promptVersionOptions,
  leftPromptVersion,
  rightPromptVersion,
}: {
  readonly payload: NonNullable<NonNullable<ReturnType<typeof useSimulatorLatestBatch>["data"]>["data"]> | null;
  readonly leftVersion: string;
  readonly rightVersion: string;
  readonly setLeftVersion: (next: string) => void;
  readonly setRightVersion: (next: string) => void;
  readonly promptVersionOptions: readonly { value: string; label: string }[];
  readonly leftPromptVersion: {
    version: string;
    strategyId: string;
    strategyName: string;
    promptText: string;
    sourceBatchId: string;
    promotedAt: string;
  } | null;
  readonly rightPromptVersion: {
    version: string;
    strategyId: string;
    strategyName: string;
    promptText: string;
    sourceBatchId: string;
    promotedAt: string;
  } | null;
}): JSX.Element {
  if (payload === null) {
    return <Empty label="No prompt data yet — run the first 5-strategy paper batch." />;
  }
  return (
    <section className="border-b border-[var(--vex-line)] pb-6">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--vex-text-3)]">
          Prompt versions
        </div>
        {payload.promotedWinnerVersion ? (
          <span className="rounded-[4px] border border-[var(--vex-accent)]/40 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--vex-accent)]">
            Live default: {payload.promotedWinnerVersion}
          </span>
        ) : null}
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {payload.promptVersions.map((version) => (
          <span
            key={version.version}
            className={cn(
              "rounded-[4px] border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em]",
              version.version === payload.promotedWinnerVersion
                ? "border-[var(--vex-accent)]/40 text-[var(--vex-accent)]"
                : "border-[var(--vex-line-strong)] text-[var(--vex-text-2)]",
            )}
            title={`${version.strategyName} · source ${version.sourceBatchId}`}
          >
            {version.version} · {version.strategyName}
          </span>
        ))}
      </div>

      {promptVersionOptions.length >= 1 ? (
        <div className="grid gap-4 md:grid-cols-2">
          <PromptVersionCard
            title="Compare left"
            selectedVersion={leftVersion}
            options={promptVersionOptions}
            onChange={setLeftVersion}
            promptVersion={leftPromptVersion}
            liveDefaultVersion={payload.promotedWinnerVersion}
          />
          <PromptVersionCard
            title="Compare right"
            selectedVersion={rightVersion}
            options={promptVersionOptions}
            onChange={setRightVersion}
            promptVersion={rightPromptVersion}
            liveDefaultVersion={payload.promotedWinnerVersion}
          />
        </div>
      ) : null}
    </section>
  );
}

function StrategyScoreboard({
  paperResults,
}: {
  readonly paperResults: readonly MissionResultDto[];
}): JSX.Element {
  const strategySummary = summarizeStrategyPerformance(paperResults);
  return (
    <section>
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--vex-text-3)]">
            Strategy scoreboard
          </div>
          <div className="mt-1 text-sm text-[var(--vex-text-2)]">
            Compare paper outcomes by strategy across recorded simulator missions.
          </div>
        </div>
      </div>
      {strategySummary.length === 0 ? (
        <Empty label="No strategy outcomes yet — finish paper missions to score strategies." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-[var(--vex-line)] font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--vex-text-3)]">
                <Th>Strategy</Th>
                <Th align="right">Missions</Th>
                <Th align="right">Win rate</Th>
                <Th align="right">Avg PnL %</Th>
              </tr>
            </thead>
            <tbody>
              {strategySummary.map((row) => (
                <tr
                  key={row.tag}
                  className="border-b border-[var(--vex-line)] last:border-b-0"
                >
                  <td className="py-2.5 pr-3 font-medium text-foreground">{row.tag}</td>
                  <td className="py-2.5 pr-3 text-right font-mono tabular-nums">{row.count}</td>
                  <td className="py-2.5 pr-3 text-right font-mono tabular-nums">{row.winRate}</td>
                  <td className="py-2.5 pr-3 text-right font-mono tabular-nums">{row.avgPnlPct}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function summarizeStrategyPerformance(results: readonly MissionResultDto[]): readonly {
  tag: string;
  count: number;
  winRate: string;
  avgPnlPct: string;
}[] {
  const grouped = new Map<string, MissionResultDto[]>();
  for (const result of results) {
    const tag = extractStrategyTag(result.goalSnippet) ?? "untagged";
    const bucket = grouped.get(tag) ?? [];
    bucket.push(result);
    grouped.set(tag, bucket);
  }
  return [...grouped.entries()]
    .map(([tag, rows]) => {
      const wins = rows.filter((row) => (row.pnlPct ?? 0) > 0).length;
      const knownPnls = rows
        .map((row) => row.pnlPct)
        .filter((value): value is number => value !== null && Number.isFinite(value));
      const avg =
        knownPnls.length === 0
          ? "—"
          : `${knownPnls.reduce((sum, value) => sum + value, 0) / knownPnls.length > 0 ? "+" : ""}${(
              knownPnls.reduce((sum, value) => sum + value, 0) / knownPnls.length
            ).toFixed(1)}%`;
      return {
        tag,
        count: rows.length,
        winRate: `${Math.round((wins / rows.length) * 100)}%`,
        avgPnlPct: avg,
      };
    })
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

function RecentBatchRuns({
  query,
  currentBatchId,
}: {
  readonly query: ReturnType<typeof useSimulatorBatchHistory>;
  readonly currentBatchId: string;
}): JSX.Element | null {
  if (query.isPending || query.isError || !query.data?.ok) return null;
  if (query.data.data.length === 0) return null;
  return (
    <section className="border-b border-[var(--vex-line)] pb-6">
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--vex-text-3)]">
            Recent batch runs
          </div>
          <div className="mt-1 text-sm text-[var(--vex-text-2)]">
            Current live batch run plus previous tournament batches.
          </div>
        </div>
        <div className="font-mono text-[11px] text-[var(--vex-text-3)]">
          {query.data.data.length} batches
        </div>
      </div>

      <div className="grid gap-2">
        {query.data.data.map((batch) => (
          <BatchHistoryRow
            key={batch.id}
            batch={batch}
            current={batch.id === currentBatchId}
          />
        ))}
      </div>
    </section>
  );
}

function BatchHistoryRow({
  batch,
  current,
}: {
  readonly batch: SimulatorBatchHistoryItemDto;
  readonly current: boolean;
}): JSX.Element {
  const winner = batch.winnerStrategyName ?? "No winner yet";
  const status =
    batch.status === "active"
      ? `${batch.completedCount}/${batch.launchedCount} complete`
      : batch.status;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-[8px] border border-[var(--vex-line)] px-3 py-2">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <div className="truncate font-mono text-[11px] uppercase tracking-[0.12em] text-foreground">
            {batch.id}
          </div>
          {current ? (
            <span className="rounded-[4px] border border-[var(--vex-accent)]/40 px-1 py-0.5 font-mono text-[9px] uppercase tracking-[0.08em] text-[var(--vex-accent)]">
              Live batch run
            </span>
          ) : null}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-3 text-[11px] text-[var(--vex-text-3)]">
          <span>Status: {status}</span>
          <span>Winner: {winner}</span>
          <span>Score: {fmtScore(batch.winnerScore)}</span>
        </div>
      </div>
      <div className="text-right font-mono text-[11px] text-[var(--vex-text-3)]">
        <div>{batch.launchedCount}/{batch.requestedParallel} launched</div>
        <div>{batch.completedCount} finished</div>
      </div>
    </div>
  );
}

function PaperMissionLedger({
  query,
  titleBySession,
  onOpenSession,
}: {
  readonly query: ReturnType<typeof usePaperMissionResults>;
  readonly titleBySession: ReadonlyMap<string, string | null>;
  readonly onOpenSession: (sessionId: string) => void;
}): JSX.Element {
  if (query.isPending) return <Loading label="Loading paper missions…" />;
  if (query.isError) return <ErrorState message={query.error.message} />;
  if (!query.data?.ok) return <ErrorState message={query.data?.error.message ?? "Failed to load paper missions."} />;
  const results = query.data.data;
  if (results.length === 0) {
    return <Empty label="No paper missions yet — run the first paper mission batch." />;
  }
  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-end justify-between gap-3 border-b border-[var(--vex-line)] pb-4">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--vex-text-3)]">
            Paper mission history
          </div>
          <div className="mt-1 text-sm text-[var(--vex-text-2)]">
            Full paper ledger from the first recorded paper mission onward.
          </div>
        </div>
        <div className="font-mono text-sm text-foreground">
          {results.length} missions
        </div>
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
            {results.map((result) => (
              <PaperMissionRow
                key={result.missionRunId}
                result={result}
                sessionTitle={titleBySession.get(result.sessionId) ?? null}
                onOpenSession={onOpenSession}
              />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function PaperMissionRow({
  result,
  sessionTitle,
  onOpenSession,
}: {
  readonly result: MissionResultDto;
  readonly sessionTitle: string | null;
  readonly onOpenSession: (sessionId: string) => void;
}): JSX.Element {
  const missionTitle = deriveMissionHistoryTitle(result, sessionTitle);
  const strategyTag = extractStrategyTag(result.goalSnippet);
  const inferenceStamp =
    result.inferenceModel === null
      ? null
      : {
          inline: `model · ${
            formatModelStackLabel({
              primaryModelId: result.inferenceModel,
              fallbackModelId: result.inferenceFallbackModel,
            }) ?? formatModelLabel(result.inferenceModel)
          }`,
          title: `Primary model: ${result.inferenceModel}${
            result.inferenceFallbackModel
              ? `\nFallback model: ${result.inferenceFallbackModel}`
              : ""
          }`,
        };
  return (
    <tr
      role="button"
      tabIndex={0}
      aria-label={`Open ${missionTitle}`}
      onClick={() => onOpenSession(result.sessionId)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpenSession(result.sessionId);
        }
      }}
      className="cursor-pointer border-b border-[var(--vex-line)] last:border-b-0 hover:bg-white/[0.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vex-accent)] focus-visible:ring-inset"
    >
      <td className="py-2.5 pr-3 font-mono tabular-nums text-[var(--vex-text-2)]">
        #{result.seqNo}
      </td>
      <td className="max-w-[260px] truncate py-2.5 pr-3 text-foreground">
        <div className="min-w-0">
          <div className="truncate font-medium" title={missionTitle}>
            {missionTitle}
          </div>
          <div className="truncate text-[11px] text-[var(--vex-text-3)]" title={result.goalSnippet ?? undefined}>
            {result.goalSnippet ?? "—"}
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
        {strategyTag ? (
          <span className="rounded-[4px] border border-[var(--vex-line-strong)] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--vex-text-2)]">
            {strategyTag}
          </span>
        ) : (
          <span className="text-[var(--vex-text-3)]">—</span>
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
      <td className="py-2.5 text-right font-mono tabular-nums text-[var(--vex-text-2)]">
        {formatPnl(result.pnlEth, "usd", result.ethPriceUsdEnd)}
      </td>
    </tr>
  );
}

function PromptVersionCard({
  title,
  selectedVersion,
  options,
  onChange,
  promptVersion,
  liveDefaultVersion,
}: {
  readonly title: string;
  readonly selectedVersion: string;
  readonly options: ReadonlyArray<{ value: string; label: string }>;
  readonly onChange: (next: string) => void;
  readonly promptVersion: {
    readonly version: string;
    readonly strategyId: string;
    readonly strategyName: string;
    readonly promptText: string;
    readonly sourceBatchId: string;
    readonly promotedAt: string;
  } | null;
  readonly liveDefaultVersion: string | null;
}): JSX.Element {
  return (
    <div className="rounded-xl border border-[var(--vex-line)] bg-white/[0.02] p-3">
      <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--vex-text-3)]">
        {title}
      </div>
      <SelectMenu
        value={selectedVersion}
        options={options}
        onChange={onChange}
        ariaLabel={title}
      />
      {promptVersion ? (
        <div className="mt-3 flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-foreground">
              {promptVersion.version}
            </span>
            <span className="text-xs text-[var(--vex-text-2)]">
              {promptVersion.strategyName}
            </span>
            {promptVersion.version === liveDefaultVersion ? (
              <span className="rounded-[4px] border border-[var(--vex-accent)]/40 px-1 py-0.5 font-mono text-[9px] uppercase tracking-[0.08em] text-[var(--vex-accent)]">
                Live default
              </span>
            ) : null}
          </div>
          <div className="text-[11px] text-[var(--vex-text-3)]">
            Source: {promptVersion.sourceBatchId}
          </div>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg border border-[var(--vex-line)] bg-[var(--vex-surface-1)] p-3 text-[11px] leading-relaxed text-[var(--vex-text-2)]">
            {promptVersion.promptText}
          </pre>
        </div>
      ) : null}
    </div>
  );
}

function Stat({
  label,
  value,
  compact = false,
}: {
  readonly label: string;
  readonly value: string;
  readonly compact?: boolean;
}): JSX.Element {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--vex-text-3)]">
        {label}
      </span>
      <span
        className={cn(
          "font-mono tabular-nums text-foreground",
          compact ? "truncate text-[12px]" : "text-lg",
        )}
        title={value}
      >
        {value}
      </span>
    </div>
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
