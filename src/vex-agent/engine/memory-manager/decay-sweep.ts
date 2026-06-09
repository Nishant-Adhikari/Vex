/**
 * Activation decay sweep (S6a/S6b) — the periodic batch that erodes
 * `activation_strength` on decayable knowledge entries (D-DECAY). Runs off the
 * memory_manager maintenance cron-tick (alongside the consolidate-enqueue sweep).
 *
 * For each active, non-`none`-policy entry it applies ONE `decayEntry` step
 * (exp half-life, floored > 0, never deletes; audited only when the change is
 * significant — anti audit-spam). The sweep is:
 *   - IDEMPOTENT: re-running the same day produces a sub-`DECAY_AUDIT_MIN_DELTA`
 *     change → `decayEntry` no-ops (no write, no audit).
 *   - RESUMABLE / BOUNDED: pages through entries by id in batches and caps the
 *     total entries touched per run (`DECAY_SWEEP_MAX_ENTRIES`) so one tick cannot
 *     scan an unbounded table.
 *   - NON-FATAL per entry: a single entry's failure is logged and skipped; the
 *     sweep continues (one bad row never aborts the batch).
 *
 * S6b: the effective regime (dwell-confirmed snapshot pair) is resolved ONCE per
 * run and passed to every `decayEntry` — one consistent regime view per sweep
 * (no mid-sweep flip), one snapshot read per run (not per entry). A failed or
 * empty regime read degrades to `null` = pure S6a time decay (fail-closed; the
 * sweep itself never aborts over the regime).
 *
 * IO is injectable so the loop is unit-testable without a DB; the production
 * wiring binds `listDecayableEntries` + `decayEntry` + the snapshot-pair read.
 */

import {
  listDecayableEntries,
  type MaturityEntryRow,
} from "@vex-agent/db/repos/knowledge/crud.js";
import { getLatestTwoRegimeSnapshots } from "@vex-agent/db/repos/regime-snapshots.js";
import { decayEntry, type DecayResult } from "@vex-agent/memory/manager/maturity.js";
import {
  effectiveRegime,
  type EffectiveRegime,
} from "@vex-agent/memory/manager/maturity-policy.js";
import { memLog } from "@vex-agent/memory/observability/logger.js";

// ── Cadence / batch sizing (tune empirically, do not freeze) ────────

/** Entries fetched per page in one sweep run. */
export const DECAY_SWEEP_BATCH_SIZE = 200;

/**
 * Hard cap on entries TOUCHED in one sweep run, so a single maintenance tick can
 * never scan an unbounded table. The remainder is picked up on the next tick
 * (the scan resumes from id 0 each run; decay is idempotent so re-visiting an
 * already-decayed-today row is a cheap no-op).
 */
export const DECAY_SWEEP_MAX_ENTRIES = 2_000;

// ── Injectable IO ────────────────────────────────────────────────────

export interface DecaySweepDeps {
  listDecayableEntries: (args: { afterId: number; limit: number }) => Promise<MaturityEntryRow[]>;
  decayEntry: (
    entry: MaturityEntryRow,
    now: Date,
    regime: EffectiveRegime | null,
  ) => Promise<DecayResult>;
  /**
   * The dwell-confirmed effective regime, resolved ONCE per sweep run. `null`
   * (no/stale/disagreeing snapshots) → every entry decays as pure time decay.
   */
  getEffectiveRegime: () => Promise<EffectiveRegime | null>;
}

export function defaultDecaySweepDeps(): DecaySweepDeps {
  return {
    listDecayableEntries: (args) => listDecayableEntries(args),
    decayEntry: (entry, now, regime) => decayEntry(entry, now, regime),
    getEffectiveRegime: async () => effectiveRegime(await getLatestTwoRegimeSnapshots(), new Date()),
  };
}

export interface DecaySweepResult {
  /** Entries scanned (read). */
  scanned: number;
  /** Entries whose activation/tier actually changed (written + audited). */
  decayed: number;
  /** Entries that errored and were skipped (sweep continued). */
  errored: number;
}

/**
 * Run one decay sweep pass. Pages decayable entries by id, applies one
 * `decayEntry` step each (each does its OWN guarded transaction), and returns the
 * aggregate counts. `now` is injectable for deterministic tests.
 */
export async function runDecaySweep(
  now: Date = new Date(),
  deps: DecaySweepDeps = defaultDecaySweepDeps(),
): Promise<DecaySweepResult> {
  let afterId = 0;
  let scanned = 0;
  let decayed = 0;
  let errored = 0;

  // S6b: ONE regime resolution per run. A failed read degrades to null (pure
  // time decay) and never aborts the sweep — decay must keep running even when
  // the regime substrate is unreachable (fail-closed, advisory-only).
  let regime: EffectiveRegime | null = null;
  try {
    regime = await deps.getEffectiveRegime();
  } catch (err: unknown) {
    memLog.warn("decay_sweep", "regime_unavailable", {
      errorCode: err instanceof Error ? "regime_read_error" : "regime_read_unknown",
    });
  }

  while (scanned < DECAY_SWEEP_MAX_ENTRIES) {
    const remaining = DECAY_SWEEP_MAX_ENTRIES - scanned;
    const limit = Math.min(DECAY_SWEEP_BATCH_SIZE, remaining);
    const batch = await deps.listDecayableEntries({ afterId, limit });
    if (batch.length === 0) break;

    for (const entry of batch) {
      scanned += 1;
      afterId = entry.id;
      try {
        const result = await deps.decayEntry(entry, now, regime);
        if (result.ok && result.applied) decayed += 1;
      } catch {
        // Non-fatal: one bad row never aborts the sweep.
        errored += 1;
        memLog.warn("decay_sweep", "entry_failed", { entryId: entry.id });
      }
    }

    if (batch.length < limit) break; // last page
  }

  memLog("decay_sweep", "completed", { count: decayed, queueDepth: scanned });
  if (errored > 0) memLog.warn("decay_sweep", "errors", { count: errored });

  return { scanned, decayed, errored };
}
