/**
 * Signals panel — a read-only AppShell sub-view (Signals section, minimal).
 *
 * Lists today's ingested TrendRadar signals (symbol / score / liquidity /
 * velocity / mentions / risk flags / price change + a DexScreener link) and
 * grades each with the LLM-as-judge on demand (per-row "Grade" + "Grade all").
 * Grades are EPHEMERAL — held in local component state, never persisted.
 *
 * Fully fail-soft: a DB error still renders the (empty) list with an error
 * banner; a per-row grade error shows inline and never blocks the list. This
 * surface is observability only — it never places a trade.
 *
 * Reuses the Memory panel's presentational primitives + tokens so the two
 * ledger sub-views read as one system.
 */

import { useCallback, useState, type JSX } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowLeft01Icon } from "@hugeicons/core-free-icons";
import type { Result } from "@shared/ipc/result.js";
import type {
  SignalGradeResult,
  SignalListItemDto,
} from "@shared/schemas/signals.js";
import { useUiStore } from "../../stores/uiStore.js";
import { Button } from "../../components/ui/button.js";
import { useGradeSignal, useSignalsToday } from "../../lib/api/signals.js";
import { Empty, ErrorState, Loading, PILL } from "./MemoryPanelShared.js";

/** Ephemeral per-row grade state (local only — no persistence). */
type GradeCell =
  | { readonly status: "loading" }
  | { readonly status: "done"; readonly data: SignalGradeResult }
  | { readonly status: "error"; readonly message: string };

function fmtUsd(value: number | null): string {
  if (value === null) return "—";
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}

function fmtPct(value: number | null): string {
  return value === null ? "—" : `${value > 0 ? "+" : ""}${value}%`;
}

function fmtNum(value: number | null): string {
  return value === null ? "—" : value.toLocaleString("en-US");
}

const VERDICT_LABEL: Record<SignalGradeResult["verdict"], string> = {
  runner: "Runner",
  trap: "Trap",
  neutral: "Neutral",
};

export function SignalsPanel(): JSX.Element {
  const setAppShellView = useUiStore((s) => s.setAppShellView);
  const query = useSignalsToday();
  const grade = useGradeSignal();
  const [grades, setGrades] = useState<ReadonlyMap<number, GradeCell>>(
    () => new Map(),
  );
  const [gradingAll, setGradingAll] = useState(false);

  const gradeOne = useCallback(
    async (id: number): Promise<void> => {
      setGrades((prev) => new Map(prev).set(id, { status: "loading" }));
      let cell: GradeCell;
      try {
        const result: Result<SignalGradeResult> = await grade.mutateAsync({ id });
        cell = result.ok
          ? { status: "done", data: result.data }
          : { status: "error", message: result.error.message };
      } catch {
        cell = { status: "error", message: "Grading failed. Try again." };
      }
      setGrades((prev) => new Map(prev).set(id, cell));
    },
    [grade],
  );

  const rows =
    query.data !== undefined && query.data.ok ? query.data.data : [];

  const gradeAll = useCallback(async (): Promise<void> => {
    // Guard against a second concurrent bulk pass double-spending completions.
    if (gradingAll) return;
    setGradingAll(true);
    try {
      // Sequential — one lightweight completion at a time. Skip rows already
      // graded OR currently in flight (an individual Grade click), so no row
      // is ever double-submitted.
      for (const row of rows) {
        const status = grades.get(row.id)?.status;
        if (status === "done" || status === "loading") continue;
        await gradeOne(row.id);
      }
    } finally {
      setGradingAll(false);
    }
  }, [gradingAll, rows, grades, gradeOne]);

  return (
    <div
      data-vex-screen="signals"
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
          Signals
        </h1>
        <div className="ml-auto">
          {rows.length > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void gradeAll()}
              disabled={gradingAll}
              className="h-8 rounded-[6px] border border-[var(--vex-line-strong)] px-3 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--vex-text-2)] hover:text-foreground"
            >
              {gradingAll ? "Grading…" : "Grade all"}
            </Button>
          ) : null}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto flex w-full max-w-[880px] flex-col">
          <p className="mb-4 text-xs text-[var(--vex-text-2)]">
            Today&apos;s ingested TrendRadar signals, highest score first. Each
            is graded on its own features by an LLM-as-judge — DISCOVERY only,
            never a trade instruction.
          </p>
          <SignalsList query={query} grades={grades} onGrade={gradeOne} />
        </div>
      </div>
    </div>
  );
}

function SignalsList({
  query,
  grades,
  onGrade,
}: {
  readonly query: ReturnType<typeof useSignalsToday>;
  readonly grades: ReadonlyMap<number, GradeCell>;
  readonly onGrade: (id: number) => void | Promise<void>;
}): JSX.Element {
  if (query.isLoading) return <Loading label="Loading signals…" />;
  const res = query.data;
  if (res === undefined || !res.ok) {
    return (
      <ErrorState
        message={
          res && !res.ok ? res.error.message : "Unable to load signals."
        }
      />
    );
  }
  if (res.data.length === 0) {
    return <Empty label="No signals ingested today." />;
  }
  return (
    <ul className="flex flex-col">
      {res.data.map((signal) => (
        <SignalRow
          key={signal.id}
          signal={signal}
          cell={grades.get(signal.id)}
          onGrade={onGrade}
        />
      ))}
    </ul>
  );
}

function GradePill({ cell }: { readonly cell: GradeCell }): JSX.Element {
  if (cell.status === "loading") {
    return <span className={PILL}>grading…</span>;
  }
  if (cell.status === "error") {
    return (
      <span
        className="inline-flex items-center rounded-[3px] border border-destructive/35 px-1.5 py-0.5 font-mono text-[10px] text-destructive"
        title={cell.message}
      >
        grade failed
      </span>
    );
  }
  const { grade: score, verdict } = cell.data;
  return (
    <span
      className="inline-flex items-center gap-1 rounded-[3px] border border-[var(--vex-accent)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--vex-accent-text)]"
      data-vex-signal-verdict={verdict}
    >
      {VERDICT_LABEL[verdict]} · {score}
    </span>
  );
}

function SignalRow({
  signal,
  cell,
  onGrade,
}: {
  readonly signal: SignalListItemDto;
  readonly cell: GradeCell | undefined;
  readonly onGrade: (id: number) => void | Promise<void>;
}): JSX.Element {
  return (
    <li
      data-vex-signal-id={signal.id}
      className="border-b border-[var(--vex-line)] px-1 py-2 last:border-b-0"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="truncate text-xs font-medium text-foreground">
          {signal.symbol ?? signal.contract.slice(0, 10)}
        </span>
        <span className={PILL}>{signal.chain}</span>
        {signal.score !== null ? (
          <span className={PILL}>score {signal.score}</span>
        ) : null}
        {signal.riskFlags.map((flag) => (
          <span
            key={flag}
            className="inline-flex items-center rounded-[3px] border border-destructive/35 px-1.5 py-0.5 font-mono text-[10px] text-destructive"
          >
            {flag}
          </span>
        ))}
        <div className="ml-auto flex items-center gap-2">
          {cell !== undefined ? <GradePill cell={cell} /> : null}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void onGrade(signal.id)}
            disabled={cell?.status === "loading"}
            aria-label={`Grade ${signal.symbol ?? signal.contract}`}
            className="h-7 rounded-[6px] border border-[var(--vex-line-strong)] px-2 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--vex-text-2)] hover:text-foreground"
          >
            Grade
          </Button>
        </div>
      </div>

      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[10px] tabular-nums text-[var(--vex-text-3)]">
        <span>liq {fmtUsd(signal.liquidityUsd)}</span>
        <span>vol {fmtUsd(signal.volume24hUsd)}</span>
        <span>mcap {fmtUsd(signal.marketCapUsd)}</span>
        <span>24h {fmtPct(signal.priceChange24hPct)}</span>
        <span>vel {fmtPct(signal.velocityPct)}</span>
        <span>
          mentions {fmtNum(signal.todayMentions)} /{" "}
          {fmtNum(signal.yesterdayMentions)}
        </span>
        {signal.dexscreenerUrl !== null ? (
          <a
            href={signal.dexscreenerUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="text-[var(--vex-accent-text)] underline decoration-dotted underline-offset-2 hover:text-foreground"
          >
            DexScreener
          </a>
        ) : null}
      </div>

      {cell?.status === "done" && cell.data.rationale.length > 0 ? (
        <p className="mt-1 line-clamp-2 text-xs text-[var(--vex-text-2)]">
          {cell.data.rationale}
        </p>
      ) : null}
    </li>
  );
}
