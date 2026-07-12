/**
 * SIGNAL RADAR — turn-state prompt block for autonomous missions.
 *
 * Renders TrendRadar's rolling-window "overall alpha" (the `signals` table,
 * populated by the signals-ingest worker) into a compact ranked list the agent
 * reads when deciding what to buy. Mirrors `own-token-banner.ts`: volatile live
 * numbers kept OUT of the static KV-cache prefix, built async + fail-soft in
 * `buildTurnPromptStack` (any error → "" so a turn is never blocked).
 *
 * These are LEADS, not buy orders. The block says so explicitly: the agent must
 * still apply the mission contract's constraints (liquidity floor, allow-list,
 * no fee-on-transfer) and — enforced independently by the pre-buy exit-safety
 * veto in the Uniswap swap handler — confirm a live sell route before buying.
 */

import {
  listRecentSignals,
  type SignalRow,
} from "@vex-agent/db/repos/signals.js";
import logger from "@utils/logger.js";

/** Default rolling window: "overall alpha" over the last day, not just the last tick. */
const DEFAULT_WINDOW_HOURS = 24;
/** Cap rows so the block stays a lead-list, not a data dump. */
const DEFAULT_LIMIT = 12;

function compactUsd(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "?";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
  return `$${Math.round(n)}`;
}

function renderRow(s: SignalRow, rank: number): string {
  const parts: string[] = [
    `${rank}.`,
    s.symbol ?? "(unknown)",
    `· ${s.chain}`,
    `· score ${s.score ?? "?"}`,
    `· liq ${compactUsd(s.liquidityUsd)}`,
    `· vol24h ${compactUsd(s.volume24hUsd)}`,
  ];
  if (s.velocityPct !== null && Number.isFinite(s.velocityPct)) {
    const sign = s.velocityPct >= 0 ? "+" : "";
    parts.push(`· vel ${sign}${s.velocityPct}%`);
  }
  if (s.riskFlags.length > 0) parts.push(`· flags: ${s.riskFlags.join(", ")}`);
  parts.push(`· ${s.contract}`);
  return parts.join(" ");
}

/**
 * Pure formatter. Empty input → "" (section omitted). Rows are rendered in the
 * order given; `listRecentSignals` already sorts strongest-first (score DESC).
 */
export function renderSignalRadar(signals: readonly SignalRow[]): string {
  if (signals.length === 0) return "";
  const lines = signals.map((s, i) => renderRow(s, i + 1));
  return [
    `# SIGNAL RADAR — TrendRadar overall alpha (last ${DEFAULT_WINDOW_HOURS}h)`,
    "",
    "Candidate momentum tokens from off-chain mention/volume tracking. These are",
    "LEADS, not buy orders. You MUST still apply the mission contract's constraints",
    "(liquidity floor, allow-list, no fee-on-transfer) AND confirm a live sell route",
    "before buying — a lead with no exit is a honeypot. Score = signal strength",
    "(0–100), higher is stronger; rows are ranked strongest first.",
    "",
    ...lines,
  ].join("\n");
}

export interface SignalRadarDeps {
  listRecent: typeof listRecentSignals;
}

/**
 * Build the banner from the DB. Fail-soft: any DB error or empty window → "" so
 * the section is omitted and the turn is never blocked. `chain`/`minScore` let a
 * caller scope to the mission's chain / a quality floor.
 */
export async function buildSignalRadarBanner(
  opts: {
    chain?: string;
    minScore?: number;
    withinHours?: number;
    limit?: number;
    deps?: SignalRadarDeps;
  } = {},
): Promise<string> {
  try {
    const listRecent = opts.deps?.listRecent ?? listRecentSignals;
    const signals = await listRecent({
      withinHours: opts.withinHours ?? DEFAULT_WINDOW_HOURS,
      chain: opts.chain,
      minScore: opts.minScore,
      limit: opts.limit ?? DEFAULT_LIMIT,
    });
    return renderSignalRadar(signals);
  } catch (err) {
    logger.warn("signals.radar_banner.failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return "";
  }
}
