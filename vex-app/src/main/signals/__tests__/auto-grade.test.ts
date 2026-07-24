/**
 * Auto-grade pass tests — the signals-ingest post-tick grader.
 *
 * All seams (DB list, the LLM-as-judge grade, the persist) are injected, so
 * these exercise the real orchestration: idempotency (only ungraded rows are
 * fed in, already-graded rows never appear), fail-soft (one bad grade/persist
 * doesn't sink the batch), and the per-cycle cap (truncation is bounded +
 * logged). No DB, no network, no real inference.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { ok, err, type Result, type VexError } from "@shared/ipc/result.js";
import type {
  SignalGradeResult,
  SignalListItemDto,
} from "@shared/schemas/signals.js";

const logInfo = vi.fn();
const logWarn = vi.fn();
vi.mock("../../logger/index.js", () => ({
  log: { info: logInfo, warn: logWarn, error: vi.fn(), debug: vi.fn() },
}));

const { autoGradeIngestedSignals } = await import("../auto-grade.js");

afterEach(() => {
  vi.clearAllMocks();
});

function makeSignal(id: number): SignalListItemDto {
  return {
    id,
    source: "trendradar",
    chain: "solana",
    contract: `contract-${id}`,
    symbol: `TKN${id}`,
    action: "watch",
    score: 80,
    todayMentions: 100,
    yesterdayMentions: 20,
    velocityPct: 400,
    liquidityUsd: 500_000,
    volume24hUsd: 2_000_000,
    priceUsd: 1.2,
    priceChange24hPct: 30,
    marketCapUsd: 3_000_000,
    dexscreenerUrl: null,
    narratives: ["dogs"],
    riskFlags: [],
    feedGeneratedAt: null,
    ingestedAt: new Date().toISOString(),
  };
}

function gradeFor(id: number): SignalGradeResult {
  return { id, grade: 70, verdict: "runner", rationale: "solid liquidity" };
}

function unavailable(): Result<never, VexError> {
  return err({
    code: "provider.unavailable",
    domain: "signals",
    message: "no",
    retryable: true,
    userActionable: true,
    redacted: true,
    correlationId: "test",
  });
}

describe("autoGradeIngestedSignals", () => {
  it("grades + persists every ungraded signal via the injected grade path", async () => {
    const signals = [makeSignal(1), makeSignal(2), makeSignal(3)];
    const gradeOne = vi.fn(async (s: SignalListItemDto) =>
      ok(gradeFor(s.id)),
    );
    const persisted: SignalGradeResult[] = [];
    const persist = vi.fn(async (g: SignalGradeResult) => {
      persisted.push(g);
      return ok(true);
    });

    const summary = await autoGradeIngestedSignals({
      deps: {
        listUngraded: async () => ok(signals),
        gradeOne,
        persist,
      },
    });

    expect(gradeOne).toHaveBeenCalledTimes(3);
    expect(persist).toHaveBeenCalledTimes(3);
    expect(persisted.map((g) => g.id).sort()).toEqual([1, 2, 3]);
    expect(summary.graded).toBe(3);
    expect(summary.skipped).toBe(0);
    expect(summary.truncated).toBe(false);
  });

  it("is idempotent: only the ungraded rows the list returns are graded", async () => {
    // The DB `WHERE grade IS NULL` predicate lives in `listUngradedSignals`; the
    // orchestrator grades exactly what it is handed. An already-graded row is
    // never in the list, so it is never re-graded — assert the grader touches
    // only the supplied (ungraded) ids and nothing else.
    const gradeOne = vi.fn(async (s: SignalListItemDto) => ok(gradeFor(s.id)));
    const persist = vi.fn(async () => ok(true));

    await autoGradeIngestedSignals({
      deps: {
        listUngraded: async () => ok([makeSignal(42)]),
        gradeOne,
        persist,
      },
    });

    expect(gradeOne).toHaveBeenCalledTimes(1);
    expect(gradeOne.mock.calls[0]?.[0]?.id).toBe(42);
  });

  it("treats a persist that writes no row (already graded by a race) as a skip", async () => {
    const persist = vi.fn(async () => ok(false)); // 0 rows: guard rejected the write
    const summary = await autoGradeIngestedSignals({
      deps: {
        listUngraded: async () => ok([makeSignal(1)]),
        gradeOne: async (s) => ok(gradeFor(s.id)),
        persist,
      },
    });
    expect(summary.graded).toBe(0);
    expect(summary.skipped).toBe(1);
  });

  it("fails soft: one grading error is swallowed and the others still grade", async () => {
    const signals = [makeSignal(1), makeSignal(2), makeSignal(3)];
    const gradeOne = vi.fn(async (s: SignalListItemDto) => {
      if (s.id === 2) throw new Error("provider exploded");
      return ok(gradeFor(s.id));
    });
    const persist = vi.fn(async () => ok(true));

    const summary = await autoGradeIngestedSignals({
      concurrency: 1, // deterministic ordering for the assertion
      deps: { listUngraded: async () => ok(signals), gradeOne, persist },
    });

    // signal 2 threw → swallowed; 1 and 3 still graded + persisted
    expect(summary.graded).toBe(2);
    expect(summary.skipped).toBe(1);
    expect(persist).toHaveBeenCalledTimes(2);
    expect(logWarn).toHaveBeenCalled();
  });

  it("fails soft: a grade-unavailable Result leaves the row ungraded, others grade", async () => {
    const signals = [makeSignal(1), makeSignal(2)];
    const gradeOne = vi.fn(async (s: SignalListItemDto) =>
      s.id === 1 ? unavailable() : ok(gradeFor(s.id)),
    );
    const persist = vi.fn(async () => ok(true));

    const summary = await autoGradeIngestedSignals({
      deps: { listUngraded: async () => ok(signals), gradeOne, persist },
    });

    expect(summary.graded).toBe(1);
    expect(summary.skipped).toBe(1);
    expect(persist).toHaveBeenCalledTimes(1); // never persisted the unavailable one
  });

  it("caps grades per cycle and logs the truncation", async () => {
    // 5 ungraded, cap 2 → grade 2, and the list is asked for cap+1 to detect the
    // backlog. The seam returns min(requested, available).
    const all = [1, 2, 3, 4, 5].map(makeSignal);
    const listUngraded = vi.fn(async (limit: number) =>
      ok(all.slice(0, limit)),
    );
    const gradeOne = vi.fn(async (s: SignalListItemDto) => ok(gradeFor(s.id)));
    const persist = vi.fn(async () => ok(true));

    const summary = await autoGradeIngestedSignals({
      maxPerCycle: 2,
      deps: { listUngraded, gradeOne, persist },
    });

    expect(listUngraded).toHaveBeenCalledWith(3, expect.any(String)); // cap + 1
    expect(gradeOne).toHaveBeenCalledTimes(2);
    expect(summary.considered).toBe(2);
    expect(summary.graded).toBe(2);
    expect(summary.truncated).toBe(true);
    expect(
      logInfo.mock.calls.some(([msg]) =>
        String(msg).includes("cap truncated backlog"),
      ),
    ).toBe(true);
  });

  it("returns a zeroed summary (no throw) when the DB list fails", async () => {
    const summary = await autoGradeIngestedSignals({
      deps: {
        listUngraded: async () => unavailable(),
        gradeOne: vi.fn(),
        persist: vi.fn(),
      },
    });
    expect(summary).toEqual({
      considered: 0,
      graded: 0,
      skipped: 0,
      truncated: false,
      aborted: false,
    });
    expect(logWarn).toHaveBeenCalled();
  });

  it("winds down mid-pass when its abort signal fires (bounds one chunk)", async () => {
    // 6 ungraded, concurrency 2 → 3 chunks. Abort after the first chunk's grades
    // resolve: the loop's between-chunk check must stop launching further chunks,
    // so at most the first chunk (2 grades) runs.
    const signals = [1, 2, 3, 4, 5, 6].map(makeSignal);
    const controller = new AbortController();
    let gradeCalls = 0;
    const gradeOne = vi.fn(async (s: SignalListItemDto) => {
      gradeCalls += 1;
      if (gradeCalls === 2) controller.abort(); // trip abort during chunk 1
      return ok(gradeFor(s.id));
    });
    const persist = vi.fn(async () => ok(true));

    const summary = await autoGradeIngestedSignals({
      concurrency: 2,
      signal: controller.signal,
      deps: { listUngraded: async () => ok(signals), gradeOne, persist },
    });

    expect(summary.aborted).toBe(true);
    expect(summary.considered).toBe(2); // only the first chunk was launched
    expect(gradeOne).toHaveBeenCalledTimes(2);
  });

  it("does nothing (no grade calls) when there are no ungraded signals", async () => {
    const gradeOne = vi.fn();
    const summary = await autoGradeIngestedSignals({
      deps: { listUngraded: async () => ok([]), gradeOne, persist: vi.fn() },
    });
    expect(gradeOne).not.toHaveBeenCalled();
    expect(summary.graded).toBe(0);
  });
});
