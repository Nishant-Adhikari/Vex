/**
 * Outcome resolver (S5 §5). For a trade-family candidate, dereference its
 * IMMUTABLE evidence anchor (`executionId`) to the local ledger and compute the
 * REAL outcome from facts (realized PnL / position status / LP cashflow) — never
 * the agent's declaration (D-OUTCOME-SRC).
 *
 * Replay-stability (D-DEREF / FIX-1): the only stable id we trust is
 * `protocol_executions.id`. We deref it AT RESOLVE TIME through `proj_activity`
 * (execution_id), `proj_pnl_matches` (sell_activity_id), `proj_open_positions`
 * (position_key) and `proj_lp_events` (position_key) — and NEVER store a `proj_*`
 * SERIAL. After a TRUNCATE+regenerate of the projection tables the same anchor
 * re-derives an identical outcome.
 *
 * Venue dispatch (by the anchored execution's product_type via proj_activity):
 *   - spot                    → `resolveSpotOutcome`     (proj_pnl_matches realized PnL; open lots)
 *   - perps | prediction | order → `resolvePositionOutcome` (proj_open_positions status)
 *   - lp                      → `resolveLpOutcome`        (proj_lp_events fee/value)
 *   - other / thin / uncovered → honest thin fallback (neutral + weak + needsReconciliation)
 *
 * Honesty over false precision: a thin/uncovered venue returns
 * `evidenceQuality:'weak'`, `lessonSignal:'neutral'`, `pnlSource:'none'` and
 * `needsReconciliation:true` rather than a fabricated number.
 *
 * IO is injectable (`OutcomeResolverDeps`) so the dispatch + mapping is
 * unit-testable without a DB.
 */

import type { Activity } from "@vex-agent/db/repos/activity.js";
import type { ExecutionRecord } from "@vex-agent/db/repos/executions.js";
import type { Lot } from "@vex-agent/db/repos/pnl-lots.js";
import type { PnlMatch } from "@vex-agent/db/repos/pnl-matches.js";
import type { Position } from "@vex-agent/db/repos/open-positions.js";
import type { LpEvent } from "@vex-agent/db/repos/lp-events.js";
import type { MemoryCandidate } from "@vex-agent/db/repos/memory-candidates/index.js";
import type {
  MemoryOutcomeSummary,
  OutcomeLessonSignal,
  OutcomeProductType,
} from "@vex-agent/memory/schema/memory-outcome.js";

// ── Injectable ledger reads (all read-only) ─────────────────────────

export interface OutcomeResolverDeps {
  /** Anchor → immutable execution (namespace + existence). Null if the anchor is gone. */
  getExecutionById: (executionId: number) => Promise<ExecutionRecord | null>;
  /** Execution → its activity rows (product_type, instrument/position keys, wallet, side). */
  getActivitiesByExecution: (executionId: number) => Promise<Activity[]>;
  /** Realized PnL matches for a sell activity (canonical spot outcome). */
  getMatchesBySell: (sellActivityId: number) => Promise<PnlMatch[]>;
  /** Open spot lots for an instrument+wallet (open exposure). */
  getOpenLots: (instrumentKey: string, walletAddress: string) => Promise<Lot[]>;
  /** Position by position_key in ANY status (open OR closed — closed is the outcome). */
  getPositionByKey: (positionKey: string) => Promise<Position | null>;
  /** LP cashflow events for a position_key. */
  getLpEventsByPosition: (positionKey: string) => Promise<LpEvent[]>;
}

// ── Venue classification ────────────────────────────────────────────

type Venue = "spot" | "position" | "lp" | "thin";

/** Product types routed to the open-positions resolver. */
const POSITION_PRODUCTS = new Set(["perps", "prediction", "order"]);

/** Map a `proj_activity.product_type` to a resolver venue. */
function classifyVenue(productType: string): Venue {
  if (productType === "spot") return "spot";
  if (productType === "lp") return "lp";
  if (POSITION_PRODUCTS.has(productType)) return "position";
  return "thin";
}

/** The product_type, narrowed to the outcome schema vocabulary, or undefined. */
const OUTCOME_PRODUCT_TYPES = new Set<OutcomeProductType>([
  "spot",
  "perps",
  "prediction",
  "bridge",
  "order",
  "lp",
  "lend",
  "stake",
  "reward",
]);

function asOutcomeProductType(productType: string): OutcomeProductType | undefined {
  return OUTCOME_PRODUCT_TYPES.has(productType as OutcomeProductType)
    ? (productType as OutcomeProductType)
    : undefined;
}

// ── Numeric helpers (NUMERIC arrives as a decimal string) ───────────

/** Parse a ledger NUMERIC string to a number, or null when absent/unparseable. */
function toNum(s: string | null): number | null {
  if (s === null) return null;
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

/** Lesson signal from a signed realized total: >0 positive, <0 negative, 0 neutral. */
function signalFromPnl(total: number): OutcomeLessonSignal {
  if (total > 0) return "positive";
  if (total < 0) return "negative";
  return "neutral";
}

// ── Spot resolver (canonical realized PnL via proj_pnl_matches) ─────

/**
 * Spot outcome: the candidate's anchor execution → its activities → for the SELL
 * activities, the realized PnL matches (`proj_pnl_matches.realized_pnl_usd`).
 * A clean realized total (≥1 matched row with a non-null realized PnL) →
 * closed + strong. A buy with no matching sell but an open lot → open + weak
 * (open exposure, not yet realized). Neither → thin fallback.
 */
async function resolveSpotOutcome(
  activities: readonly Activity[],
  deps: OutcomeResolverDeps,
): Promise<{
  status: MemoryOutcomeSummary["status"];
  lessonSignal: OutcomeLessonSignal;
  evidenceQuality: MemoryOutcomeSummary["evidenceQuality"];
  pnlSource: MemoryOutcomeSummary["pnlSource"];
  needsReconciliation: boolean;
}> {
  const sells = activities.filter((a) => a.tradeSide === "sell");

  let realizedTotal = 0;
  let matchedRows = 0;
  for (const sell of sells) {
    const matches = await deps.getMatchesBySell(sell.id);
    for (const m of matches) {
      const pnl = toNum(m.realizedPnlUsd);
      if (m.matchKind === "matched" && pnl !== null) {
        realizedTotal += pnl;
        matchedRows += 1;
      }
    }
  }

  if (matchedRows > 0) {
    // Closed + clean realized PnL → the strongest spot evidence.
    return {
      status: "closed",
      lessonSignal: signalFromPnl(realizedTotal),
      evidenceQuality: "strong",
      pnlSource: "pnl_matches",
      needsReconciliation: false,
    };
  }

  // No realized match — check for an OPEN lot (open exposure, not yet realized).
  const buys = activities.filter((a) => a.tradeSide === "buy");
  for (const buy of buys) {
    if (!buy.instrumentKey || !buy.walletAddress) continue;
    const openLots = await deps.getOpenLots(buy.instrumentKey, buy.walletAddress);
    if (openLots.length > 0) {
      return {
        status: "open",
        lessonSignal: "neutral",
        evidenceQuality: "weak",
        pnlSource: "open_position",
        needsReconciliation: true,
      };
    }
  }

  // Spot execution but no realized match and no open lot → thin (e.g. shortfall
  // sell with null realized PnL, or projections not yet populated).
  return {
    status: "open",
    lessonSignal: "neutral",
    evidenceQuality: "weak",
    pnlSource: "none",
    needsReconciliation: true,
  };
}

// ── Position resolver (perps / prediction / order) ──────────────────

/**
 * Position outcome from `proj_open_positions`. A CLOSED position is the resolved
 * outcome; we read its realized signal from `unrealized_pnl_usd` at close when
 * present (perps/predictions carry MTM there) — but a position's PnL is NOT a
 * clean FIFO realized ledger like spot, so the ceiling is `medium` + a
 * reconciliation flag (s5-plan §15.4: no false precision; S7 reconciles when the
 * realized perps PnL lands). An OPEN position → open + weak (unrealized,
 * current state). No position row → thin.
 */
async function resolvePositionOutcome(
  activities: readonly Activity[],
  deps: OutcomeResolverDeps,
): Promise<{
  status: MemoryOutcomeSummary["status"];
  lessonSignal: OutcomeLessonSignal;
  evidenceQuality: MemoryOutcomeSummary["evidenceQuality"];
  pnlSource: MemoryOutcomeSummary["pnlSource"];
  needsReconciliation: boolean;
}> {
  const positionKey = activities.find((a) => a.positionKey)?.positionKey ?? null;
  const position = positionKey ? await deps.getPositionByKey(positionKey) : null;

  if (!position) {
    return {
      status: "open",
      lessonSignal: "neutral",
      evidenceQuality: "weak",
      pnlSource: "none",
      needsReconciliation: true,
    };
  }

  if (position.status === "closed") {
    // PnL at close is MTM, not a clean FIFO realized ledger — medium, not strong.
    const pnl = toNum(position.unrealizedPnlUsd);
    return {
      status: "closed",
      lessonSignal: pnl === null ? "neutral" : signalFromPnl(pnl),
      evidenceQuality: "medium",
      pnlSource: "open_position",
      needsReconciliation: true,
    };
  }

  // Open position → unrealized current state.
  return {
    status: "open",
    lessonSignal: "neutral",
    evidenceQuality: "weak",
    pnlSource: "open_position",
    needsReconciliation: true,
  };
}

// ── LP resolver (proj_lp_events cashflow) ───────────────────────────

/**
 * LP outcome from `proj_lp_events`. Net cashflow signal = fees collected minus
 * net withdrawn-vs-deposited value is NOT cleanly recoverable from the event
 * headers alone (legs live in `proj_lp_event_legs`), so S5 stays conservative:
 * a `withdraw` event present → closed; fee-collected sign drives the lesson
 * signal when available; `medium` quality + reconciliation flag (S7 settles the
 * full LP PnL). No events → thin.
 */
async function resolveLpOutcome(
  activities: readonly Activity[],
  deps: OutcomeResolverDeps,
): Promise<{
  status: MemoryOutcomeSummary["status"];
  lessonSignal: OutcomeLessonSignal;
  evidenceQuality: MemoryOutcomeSummary["evidenceQuality"];
  pnlSource: MemoryOutcomeSummary["pnlSource"];
  needsReconciliation: boolean;
}> {
  const positionKey = activities.find((a) => a.positionKey)?.positionKey ?? null;
  const events = positionKey ? await deps.getLpEventsByPosition(positionKey) : [];

  if (events.length === 0) {
    return {
      status: "open",
      lessonSignal: "neutral",
      evidenceQuality: "weak",
      pnlSource: "none",
      needsReconciliation: true,
    };
  }

  const closed = events.some((e) => e.action === "withdraw");
  let feeTotal = 0;
  let feeSeen = false;
  for (const e of events) {
    const fee = toNum(e.feeCollectedUsd);
    if (fee !== null) {
      feeTotal += fee;
      feeSeen = true;
    }
  }

  return {
    status: closed ? "closed" : "open",
    lessonSignal: feeSeen ? signalFromPnl(feeTotal) : "neutral",
    evidenceQuality: "medium",
    pnlSource: "lp_events",
    needsReconciliation: true,
  };
}

// ── resolveOutcome (deref → venue dispatch → MemoryOutcomeSummary) ──

/**
 * Resolve the ledger-grounded outcome for a candidate's FIRST surviving anchor.
 * `pointInTimeChecked` is supplied by the caller (S5 §6) — the resolver only owns
 * the venue facts, not the point-in-time gate. Returns null only when NO anchor
 * survives (the candidate has no execution to deref — S4 already handles anchor
 * existence). `outcomeComputedBy:'memory_manager'`, `outcomeVersion:0` (S5 init;
 * S7 bumps). The status enum is normalized through the schema vocabulary; raw
 * monetary values never appear in the summary.
 */
export async function resolveOutcome(
  candidate: MemoryCandidate,
  pointInTimeChecked: boolean,
  deps: OutcomeResolverDeps,
): Promise<MemoryOutcomeSummary | null> {
  // Find the first surviving anchor execution (deref the immutable id).
  let exec: ExecutionRecord | null = null;
  for (const anchor of candidate.evidenceRefs) {
    exec = await deps.getExecutionById(anchor.executionId);
    if (exec) break;
  }
  if (!exec) return null; // no anchor → S4 existence path already terminal

  const activities = await deps.getActivitiesByExecution(exec.id);
  const productType = activities[0]?.productType ?? null;
  const venue = productType ? classifyVenue(productType) : "thin";
  const outcomeProductType = productType ? asOutcomeProductType(productType) : undefined;

  const facts =
    venue === "spot"
      ? await resolveSpotOutcome(activities, deps)
      : venue === "position"
        ? await resolvePositionOutcome(activities, deps)
        : venue === "lp"
          ? await resolveLpOutcome(activities, deps)
          : // thin / uncovered venue → honest fallback (no false precision).
            ({
              status: "open" as const,
              lessonSignal: "neutral" as const,
              evidenceQuality: "weak" as const,
              pnlSource: "none" as const,
              needsReconciliation: true,
            });

  return {
    status: facts.status,
    ...(outcomeProductType ? { productType: outcomeProductType } : {}),
    lessonSignal: facts.lessonSignal,
    evidenceQuality: facts.evidenceQuality,
    pointInTimeChecked,
    outcomeComputedBy: "memory_manager",
    outcomeVersion: 0,
    needsReconciliation: facts.needsReconciliation,
    pnlSource: facts.pnlSource,
  };
}
