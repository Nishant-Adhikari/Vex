/**
 * Simulated-clock primitive for the time-simulated memory eval (S1).
 *
 * ── THE WALL-PROJECTION INVARIANT (why this exists) ─────────────────────────
 * Production has NO global clock seam. Two distinct read families observe time:
 *
 *   (A) REAL-CLOCK reads — compare a STORED row timestamp to wall-clock now():
 *       recall TTL `retrieval_until > now()` (memory-candidates/crud.ts),
 *       `valid_until` (knowledge/recall.ts, hot-context.ts), recency via
 *       `updated_at` (knowledge/ranking.ts).
 *   (B) INJECTED-now math — the decay engine takes an injected `now` and diffs it
 *       against row timestamps: `runDecaySweep(now, deps)` (decay-sweep.ts),
 *       `daysSince(reference, now)` / `decayEntry(entry, now, regime)`
 *       (maturity.ts / maturity-policy.ts), and `effectiveRegime(snapshots, now)`.
 *
 * To simulate elapsed time with NO production change, we project a logical
 * sim-day onto the WALL clock instead of inventing a fixed epoch:
 *
 *   - Maintain a logical `simNowDay` (a sim-day number; may be fractional).
 *   - At EACH checkpoint capture exactly ONE `wallNow = new Date()`.
 *   - A sim timestamp `T` (a sim-day number) is STORED as a wall timestamp:
 *         toWall(T) = wallNow + (T - simNowDay) * MS_PER_DAY
 *
 * The two families then reconcile EXACTLY:
 *   - (A) Real-clock reads see `wallNow`. A row whose sim T is in the sim-past
 *     (T < simNowDay) projects to `toWall(T) < wallNow`, so the row reads as
 *     "past/expired" — correct.
 *   - (B) Feed the decay sweep the SAME captured `wallNow` as its injected `now`.
 *     For a row stored at `toWall(T)`:
 *         daysSince(wallNow, toWall(T))
 *           = (wallNow - toWall(T)) / MS_PER_DAY
 *           = (simNowDay - T)
 *     i.e. passing the real `wallNow` against wall-projected row timestamps
 *     recovers EXACTLY the intended simulated elapsed days.
 *
 * ── WHY ONE wallNow PER CHECKPOINT (load-bearing) ───────────────────────────
 * The reconciliation above only holds if the SAME `wallNow` instant is used for
 * (a) projecting the row timestamps, (b) the decay sweep's injected `now`, AND
 * (c) `effectiveRegime`'s `now`. Calling `new Date()` more than once per
 * checkpoint introduces a few-millisecond skew between the projection basis and
 * the read basis; over a 90-sim-day run with intermediate sweeps that skew is
 * negligible per step but the discipline is what keeps the math an identity
 * rather than an approximation. Capture ONE `wallNow`, thread it everywhere.
 *
 * This module is pure-ish: `toWall` is pure; the `backdate*` helpers each do ONE
 * atomic UPDATE (the only way to set columns the production write path stamps via
 * NOW()); `simRegimeDeps` is a pure factory.
 */

import type { DecaySweepDeps } from "@vex-agent/engine/memory-manager/decay-sweep.js";
import {
  effectiveRegime,
  type EffectiveRegime,
} from "@vex-agent/memory/manager/maturity-policy.js";
import { getLatestTwoRegimeSnapshots } from "@vex-agent/db/repos/regime-snapshots.js";
import {
  listDecayableEntries,
  type MaturityEntryRow,
} from "@vex-agent/db/repos/knowledge/crud.js";
import { decayEntry } from "@vex-agent/memory/manager/maturity.js";
import { execute } from "@vex-agent/db/client.js";

/** Milliseconds in one day — the sim-day ↔ wall-clock conversion factor. */
export const MS_PER_DAY = 86_400_000;

/**
 * Project a sim-day number `simTs` to a wall-clock Date, anchored on a single
 * captured `wallNow` at logical day `simNowDay`. See the wall-projection
 * invariant in the module header. `simTs` and `simNowDay` are sim-day numbers
 * (possibly fractional); the result is `wallNow + (simTs - simNowDay) * day`.
 */
export function toWall(simTs: number, simNowDay: number, wallNow: Date): Date {
  return new Date(wallNow.getTime() + (simTs - simNowDay) * MS_PER_DAY);
}

/**
 * Sim-day anchors for `knowledge_entries`. Each supplied field is a SIM-DAY
 * NUMBER (not a Date); the helper projects it via `toWall` and writes the wall
 * timestamp. Only columns that EXIST on `knowledge_entries` are listed —
 * there is intentionally NO `recordedAt` here (that column lives on
 * `memory_candidates`, not on `knowledge_entries`).
 */
export interface KnowledgeEntryAnchors {
  createdAt?: number;
  updatedAt?: number;
  firstPromotedAt?: number;
  lastReinforcedAt?: number;
  lastDecayedAt?: number;
  validFrom?: number;
  validUntil?: number;
}

/** Column map for `knowledge_entries` anchors (TS field → SQL column). */
const KNOWLEDGE_ENTRY_COLUMN: Record<keyof KnowledgeEntryAnchors, string> = {
  createdAt: "created_at",
  updatedAt: "updated_at",
  firstPromotedAt: "first_promoted_at",
  lastReinforcedAt: "last_reinforced_at",
  lastDecayedAt: "last_decayed_at",
  validFrom: "valid_from",
  validUntil: "valid_until",
};

/**
 * Backdate one `knowledge_entries` row's time columns in ONE atomic UPDATE, so a
 * concurrent read never sees a mixed real/sim timeline (atomicity discipline).
 * Each supplied anchor (a sim-day number) is projected via `toWall(value,
 * simNowDay, wallNow)`. Supplying no anchors is a no-op.
 */
export async function backdateKnowledgeEntry(
  entryId: number,
  anchors: KnowledgeEntryAnchors,
  simNowDay: number,
  wallNow: Date,
): Promise<void> {
  await backdateRow("knowledge_entries", entryId, anchors, KNOWLEDGE_ENTRY_COLUMN, simNowDay, wallNow);
}

/**
 * Sim-day anchors for `memory_candidates`. Each field is a SIM-DAY NUMBER.
 * Columns verified present on `memory_candidates` (001_initial.sql).
 */
export interface CandidateAnchors {
  recordedAt?: number;
  eventTime?: number;
  observedAt?: number;
  retrievalUntil?: number;
  retainUntil?: number;
  availableAtDecisionTime?: number;
}

/** Column map for `memory_candidates` anchors (TS field → SQL column). */
const CANDIDATE_COLUMN: Record<keyof CandidateAnchors, string> = {
  recordedAt: "recorded_at",
  eventTime: "event_time",
  observedAt: "observed_at",
  retrievalUntil: "retrieval_until",
  retainUntil: "retain_until",
  availableAtDecisionTime: "available_at_decision_time",
};

/**
 * Backdate one `memory_candidates` row's time columns in ONE atomic UPDATE. The
 * candidate id is a UUID (cast to ::uuid). Each supplied anchor is projected via
 * `toWall`. No-op when no anchors are supplied.
 */
export async function backdateCandidate(
  candidateId: string,
  anchors: CandidateAnchors,
  simNowDay: number,
  wallNow: Date,
): Promise<void> {
  await backdateRow(
    "memory_candidates",
    candidateId,
    anchors,
    CANDIDATE_COLUMN,
    simNowDay,
    wallNow,
    "::uuid",
  );
}

/**
 * Backdate a `regime_snapshots` row's `created_at` (the only time column on that
 * table — it is always stamped NOW() at insert, so an UPDATE is the only seam to
 * place it on a sim-day). The id is a SERIAL integer.
 */
export async function backdateRegimeSnapshot(
  snapshotId: number,
  anchors: { createdAt: number },
  simNowDay: number,
  wallNow: Date,
): Promise<void> {
  await backdateRow(
    "regime_snapshots",
    snapshotId,
    anchors,
    { createdAt: "created_at" },
    simNowDay,
    wallNow,
  );
}

/**
 * Shared single-UPDATE backdate. Builds `SET col = $n` for each supplied anchor
 * (skipping `undefined`), projecting each sim-day value to a wall Date via
 * `toWall`. Internal — callers use the per-table wrappers above (different
 * tables have different id types/columns, so they are NOT collapsed into one
 * public overloaded helper). Table/column names come ONLY from the closed
 * per-table maps above (never from caller input), so this builds no injectable
 * SQL — values are always bound parameters.
 */
async function backdateRow<K extends string>(
  table: string,
  id: number | string,
  anchors: Partial<Record<K, number>>,
  columnMap: Record<K, string>,
  simNowDay: number,
  wallNow: Date,
  idCast = "",
): Promise<void> {
  const setClauses: string[] = [];
  const values: unknown[] = [];
  for (const key of Object.keys(anchors) as K[]) {
    const simTs = anchors[key];
    if (simTs === undefined) continue;
    const column = columnMap[key];
    values.push(toWall(simTs, simNowDay, wallNow).toISOString());
    setClauses.push(`${column} = $${values.length}::timestamptz`);
  }
  if (setClauses.length === 0) return; // nothing to backdate
  values.push(id);
  const sql = `UPDATE ${table} SET ${setClauses.join(", ")} WHERE id = $${values.length}${idCast}`;
  await execute(sql, values);
}

/**
 * A `DecaySweepDeps` override whose `getEffectiveRegime` closes over the SAME
 * captured `wallNow` the sweep is called with — the regime view must be resolved
 * against the sim clock, NOT `new Date()` (the default deps at decay-sweep.ts:72
 * use `new Date()`, which would read the regime snapshots' freshness against the
 * REAL wall, breaking the dwell/age guards in `effectiveRegime`).
 *
 * `listDecayableEntries` and `decayEntry` are the production bindings — only the
 * regime `now` is swapped. The factory is built correctly for later slices that
 * exercise regime-aware decay; S1's canary uses time-only decay (regime resolves
 * to whatever the snapshots say, or `null` when none are seeded), so the regime
 * path is neutral for the canary.
 */
export function simRegimeDeps(wallNow: Date): DecaySweepDeps {
  return {
    listDecayableEntries: (args: { afterId: number; limit: number }): Promise<MaturityEntryRow[]> =>
      listDecayableEntries(args),
    decayEntry: (entry: MaturityEntryRow, now: Date, regime: EffectiveRegime | null) =>
      decayEntry(entry, now, regime),
    getEffectiveRegime: async (): Promise<EffectiveRegime | null> =>
      effectiveRegime(await getLatestTwoRegimeSnapshots(), wallNow),
  };
}
