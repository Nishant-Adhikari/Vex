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

import type { JSX } from "react";
import type { MissionResultDto } from "@shared/schemas/mission.js";
import { cn } from "../../lib/utils.js";
import { EM_DASH, formatDurationS } from "./missionHistoryModel.js";
import {
  formatBankrollRangeUsd,
  formatMetaLine,
  formatPnlEth,
  formatPnlPct,
  formatPnlUsd,
  pnlToneClass,
} from "./missionSummaryModel.js";

export interface MissionSummaryCardProps {
  readonly result: MissionResultDto;
}

export function MissionSummaryCard({
  result,
}: MissionSummaryCardProps): JSX.Element {
  const pct = formatPnlPct(result.pnlPct);
  const pnlEthText = formatPnlEth(result.pnlEth);
  // USD leads the headline; ETH moves to a secondary aside + the hover title.
  const pnlUsdText =
    result.ethPriceUsdEnd !== null
      ? formatPnlUsd(result.pnlEth, result.ethPriceUsdEnd)
      : null;
  const pnlTitle = pnlEthText === EM_DASH ? undefined : `${pnlEthText} at close`;

  return (
    <section
      data-vex-area="mission-summary"
      aria-label="Mission summary"
      className="mb-3 flex flex-col gap-2 rounded-[10px] border border-[var(--vex-line)] bg-white/[0.02] px-4 py-3"
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
            "font-mono text-lg tabular-nums",
            pnlToneClass(result.pnlEth),
          )}
        >
          {pnlUsdText ?? pnlEthText}
          {pct.length > 0 ? (
            <span className="ml-2 text-[11px]">{pct}</span>
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

      {/* Line 4 — trades + settlement. */}
      <p className="font-mono text-[11px] tabular-nums text-[var(--vex-text-2)]">
        {formatMetaLine(result.trades, result.openPositionsCount)}
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
    </section>
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
