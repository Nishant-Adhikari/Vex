/**
 * Auto-grade pass for the signals-ingest worker.
 *
 * After each ingest tick writes the latest TrendRadar signals, this grades any
 * that are still UNGRADED (grade IS NULL) via the EXACT SAME path the per-row
 * GRADE button uses — `gradeSignal` (the one-shot OpenRouter LLM-as-judge) — and
 * persists each verdict with `persistSignalGrade`. There is deliberately no
 * second grading implementation: the button and the auto-grader share
 * `signals/grade.ts` and the same feature DTO.
 *
 * Contract:
 *   - IDEMPOTENT — only rows with `grade IS NULL` are selected + written (the
 *     manual GRADE button stays the explicit re-grade path); an already-graded
 *     row is never touched.
 *   - FAIL-SOFT per signal — a grading or persist failure for one signal is
 *     logged and swallowed; it leaves that row ungraded (still GRADE-able by
 *     hand) and never blocks ingest or the other signals in the batch.
 *   - CAPPED per cycle — at most `maxPerCycle` grades run in one pass so a
 *     backlog/backfill can't fire hundreds of LLM calls at once; a truncated
 *     cycle is logged. Volume is ~3/hour, so the cap only bites on a backlog.
 *   - BOUNDED concurrency — grades run in small chunks (default 3) so the
 *     provider is never hammered.
 *
 * Grading is DISCOVERY only — nothing here places a trade or mutates wallet
 * state; it writes only the four grade columns on the `signals` row.
 */

import { randomUUID } from "node:crypto";
import type { Result, VexError } from "@shared/ipc/result.js";
import type {
  SignalGradeResult,
  SignalListItemDto,
} from "@shared/schemas/signals.js";
import {
  listUngradedSignals,
  persistSignalGrade,
} from "../database/signals-db.js";
import { gradeSignal } from "./grade.js";
import { log } from "../logger/index.js";

/** Generous default cap — ~3 signals/hour arrive, so this only trips on a backlog. */
export const DEFAULT_AUTOGRADE_MAX_PER_CYCLE = 25;
/** Small concurrency so we never hammer the provider. */
export const DEFAULT_AUTOGRADE_CONCURRENCY = 3;

/** Injectable seams (production wires the real DB + grading path). */
export interface AutoGradeDeps {
  readonly listUngraded: (
    limit: number,
    correlationId: string,
  ) => Promise<Result<readonly SignalListItemDto[], VexError>>;
  readonly gradeOne: (
    features: SignalListItemDto,
    options: { readonly correlationId: string },
  ) => Promise<Result<SignalGradeResult, VexError>>;
  readonly persist: (
    grade: SignalGradeResult,
    correlationId: string,
  ) => Promise<Result<boolean, VexError>>;
}

export interface AutoGradeOptions {
  /** Cap on grades per pass. Defaults to env or `DEFAULT_AUTOGRADE_MAX_PER_CYCLE`. */
  readonly maxPerCycle?: number;
  /** Concurrent grades. Defaults to env or `DEFAULT_AUTOGRADE_CONCURRENCY`. */
  readonly concurrency?: number;
  /** Correlation id prefix for log lines (a per-signal id is derived from it). */
  readonly correlationId?: string;
  /**
   * Aborts the pass when the ingest worker is stopping (app quit). Checked
   * between concurrency chunks so at most one in-flight chunk outlives the
   * abort — the pass never blocks quit cleanup for a whole backlog.
   */
  readonly signal?: AbortSignal;
  /** Test seams; production omits → real DB + grading path. */
  readonly deps?: Partial<AutoGradeDeps>;
}

export interface AutoGradeSummary {
  /** Rows selected for grading this pass (after the cap). */
  readonly considered: number;
  /** Rows newly graded + persisted. */
  readonly graded: number;
  /** Rows skipped (grade unavailable, already graded by a race, or an error). */
  readonly skipped: number;
  /** True when the cap truncated a larger backlog. */
  readonly truncated: boolean;
  /** True when the pass wound down early because its abort signal fired. */
  readonly aborted: boolean;
}

function positiveIntFromEnv(name: string): number | null {
  const raw = process.env[name];
  if (typeof raw !== "string" || raw.trim().length === 0) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function resolveMaxPerCycle(explicit: number | undefined): number {
  if (explicit !== undefined && explicit > 0) return Math.floor(explicit);
  return (
    positiveIntFromEnv("SIGNALS_AUTOGRADE_MAX_PER_CYCLE") ??
    DEFAULT_AUTOGRADE_MAX_PER_CYCLE
  );
}

function resolveConcurrency(explicit: number | undefined): number {
  if (explicit !== undefined && explicit > 0) return Math.floor(explicit);
  return (
    positiveIntFromEnv("SIGNALS_AUTOGRADE_CONCURRENCY") ??
    DEFAULT_AUTOGRADE_CONCURRENCY
  );
}

/**
 * Grade + persist every ungraded signal (up to the cap). Never throws — every
 * failure mode (DB list error, per-signal grade/persist error) is logged and
 * folded into the returned summary, so the caller (the ingest executor's
 * post-tick hook) can stay a thin fire-and-forget.
 */
export async function autoGradeIngestedSignals(
  options: AutoGradeOptions = {},
): Promise<AutoGradeSummary> {
  const maxPerCycle = resolveMaxPerCycle(options.maxPerCycle);
  const concurrency = resolveConcurrency(options.concurrency);
  const correlationId =
    options.correlationId ?? `signals-autograde-${randomUUID()}`;

  const listUngraded = options.deps?.listUngraded ?? listUngradedSignals;
  const gradeOne = options.deps?.gradeOne ?? gradeSignal;
  const persist = options.deps?.persist ?? persistSignalGrade;
  const abortSignal = options.signal;

  // Fetch one MORE than the cap: if the DB has more ungraded rows than we will
  // grade this pass, the extra row tells us the cap truncated a backlog.
  const listed = await listUngraded(maxPerCycle + 1, correlationId);
  if (!listed.ok) {
    log.warn(
      `[signals:autograde] list ungraded failed errCode=${listed.error.code} ` +
        `correlationId=${correlationId}`,
    );
    return { considered: 0, graded: 0, skipped: 0, truncated: false, aborted: false };
  }

  const truncated = listed.data.length > maxPerCycle;
  const batch = listed.data.slice(0, maxPerCycle);
  if (truncated) {
    log.info(
      `[signals:autograde] cap truncated backlog: grading ${maxPerCycle} of ` +
        `>${maxPerCycle} ungraded this pass correlationId=${correlationId}`,
    );
  }
  if (batch.length === 0) {
    return { considered: 0, graded: 0, skipped: 0, truncated, aborted: false };
  }

  let graded = 0;
  let skipped = 0;

  const gradeAndPersist = async (
    signal: SignalListItemDto,
  ): Promise<void> => {
    // Per-signal fail-soft: a throw here must not sink the batch or ingest.
    try {
      const verdict = await gradeOne(signal, { correlationId });
      if (!verdict.ok) {
        skipped += 1;
        log.info(
          `[signals:autograde] skip id=${signal.id} grade unavailable ` +
            `errCode=${verdict.error.code} correlationId=${correlationId}`,
        );
        return;
      }
      const written = await persist(verdict.data, correlationId);
      if (!written.ok) {
        skipped += 1;
        log.warn(
          `[signals:autograde] persist failed id=${signal.id} ` +
            `errCode=${written.error.code} correlationId=${correlationId}`,
        );
        return;
      }
      if (written.data) {
        graded += 1;
      } else {
        // Row was graded by a concurrent path between list + persist — benign.
        skipped += 1;
      }
    } catch (cause) {
      skipped += 1;
      const className =
        cause instanceof Error ? cause.constructor.name : typeof cause;
      log.warn(
        `[signals:autograde] unexpected error id=${signal.id} ` +
          `class=${className} correlationId=${correlationId}`,
      );
    }
  };

  // Bounded concurrency: fixed-size chunks keep at most `concurrency` grades in
  // flight without pulling in a pool dependency. The abort check between chunks
  // means a stop() during the pass leaves at most one chunk in flight — so app
  // quit is never held for a whole backlog of grading.
  let considered = 0;
  let aborted = false;
  for (let i = 0; i < batch.length; i += concurrency) {
    if (abortSignal?.aborted === true) {
      aborted = true;
      log.info(
        `[signals:autograde] aborted mid-pass (worker stopping) after ` +
          `${considered}/${batch.length} correlationId=${correlationId}`,
      );
      break;
    }
    const chunk = batch.slice(i, i + concurrency);
    considered += chunk.length;
    await Promise.all(chunk.map(gradeAndPersist));
  }

  log.info(
    `[signals:autograde] pass complete considered=${considered} ` +
      `graded=${graded} skipped=${skipped} truncated=${truncated} ` +
      `aborted=${aborted} correlationId=${correlationId}`,
  );

  return { considered, graded, skipped, truncated, aborted };
}
