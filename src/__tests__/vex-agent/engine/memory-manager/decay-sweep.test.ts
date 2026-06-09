/**
 * Unit tests for the activation decay sweep loop (S6a + S6b). IO is stubbed
 * (no DB) — these prove the batching/paging/cap/idempotency-error-handling:
 *  - pages through entries by id and applies decayEntry to each;
 *  - aggregates decayed vs scanned counts;
 *  - respects the per-run entry cap (bounded scan);
 *  - a per-entry failure is non-fatal (sweep continues, errored counted);
 *  - an empty store is a clean no-op;
 *  - S6b: the effective regime is resolved ONCE per run and passed to every
 *    decayEntry; a regime-read failure degrades to null (sweep still runs).
 */

import { describe, it, expect, vi } from "vitest";

import {
  runDecaySweep,
  DECAY_SWEEP_BATCH_SIZE,
  DECAY_SWEEP_MAX_ENTRIES,
  type DecaySweepDeps,
} from "@vex-agent/engine/memory-manager/decay-sweep.js";
import type { MaturityEntryRow } from "@vex-agent/db/repos/knowledge/crud.js";
import type { DecayResult } from "@vex-agent/memory/manager/maturity.js";
import type { EffectiveRegime } from "@vex-agent/memory/manager/maturity-policy.js";

function entry(id: number): MaturityEntryRow {
  return {
    id,
    maturityState: "established",
    activationStrength: 0.5,
    decayPolicy: "regime_aware",
    regimeTags: [],
    firstPromotedAt: "2026-01-01T00:00:00Z",
    lastReinforcedAt: "2026-01-01T00:00:00Z",
    lastDecayedAt: null,
  };
}

const APPLIED: DecayResult = { ok: true, applied: true, activationBefore: 0.5, activationAfter: 0.4, tierChanged: false };
const NOOP: DecayResult = { ok: true, applied: false, reason: "below_delta" };

/** A paging stub backed by an in-memory list, honoring afterId + limit. */
function pagingList(all: MaturityEntryRow[]): DecaySweepDeps["listDecayableEntries"] {
  return vi.fn(async ({ afterId, limit }) =>
    all.filter((e) => e.id > afterId).slice(0, limit),
  );
}

describe("runDecaySweep", () => {
  it("pages through all entries and decays each", async () => {
    const all = Array.from({ length: DECAY_SWEEP_BATCH_SIZE + 5 }, (_, i) => entry(i + 1));
    const decay = vi.fn(async () => APPLIED);
    const deps: DecaySweepDeps = { listDecayableEntries: pagingList(all), decayEntry: decay, getEffectiveRegime: async () => null };

    const result = await runDecaySweep(new Date(), deps);

    expect(result.scanned).toBe(all.length);
    expect(result.decayed).toBe(all.length);
    expect(result.errored).toBe(0);
    expect(decay).toHaveBeenCalledTimes(all.length);
  });

  it("counts only entries that actually changed as decayed", async () => {
    const all = [entry(1), entry(2), entry(3)];
    const decay = vi
      .fn<DecaySweepDeps["decayEntry"]>()
      .mockResolvedValueOnce(APPLIED)
      .mockResolvedValueOnce(NOOP)
      .mockResolvedValueOnce(APPLIED);
    const deps: DecaySweepDeps = { listDecayableEntries: pagingList(all), decayEntry: decay, getEffectiveRegime: async () => null };

    const result = await runDecaySweep(new Date(), deps);
    expect(result.scanned).toBe(3);
    expect(result.decayed).toBe(2);
  });

  it("respects the per-run entry cap (bounded scan)", async () => {
    const all = Array.from({ length: DECAY_SWEEP_MAX_ENTRIES + 100 }, (_, i) => entry(i + 1));
    const decay = vi.fn(async () => APPLIED);
    const deps: DecaySweepDeps = { listDecayableEntries: pagingList(all), decayEntry: decay, getEffectiveRegime: async () => null };

    const result = await runDecaySweep(new Date(), deps);
    expect(result.scanned).toBe(DECAY_SWEEP_MAX_ENTRIES);
  });

  it("continues past a per-entry failure (non-fatal)", async () => {
    const all = [entry(1), entry(2), entry(3)];
    const decay = vi
      .fn<DecaySweepDeps["decayEntry"]>()
      .mockResolvedValueOnce(APPLIED)
      .mockRejectedValueOnce(new Error("db hiccup"))
      .mockResolvedValueOnce(APPLIED);
    const deps: DecaySweepDeps = { listDecayableEntries: pagingList(all), decayEntry: decay, getEffectiveRegime: async () => null };

    const result = await runDecaySweep(new Date(), deps);
    expect(result.scanned).toBe(3);
    expect(result.decayed).toBe(2);
    expect(result.errored).toBe(1);
  });

  it("is a clean no-op on an empty store", async () => {
    const decay = vi.fn(async () => APPLIED);
    const deps: DecaySweepDeps = { listDecayableEntries: pagingList([]), decayEntry: decay, getEffectiveRegime: async () => null };
    const result = await runDecaySweep(new Date(), deps);
    expect(result).toEqual({ scanned: 0, decayed: 0, errored: 0 });
    expect(decay).not.toHaveBeenCalled();
  });

  // ── S6b: one regime resolution per run, threaded to every entry ──

  it("resolves the effective regime ONCE per run and passes it to every decayEntry", async () => {
    const regime: EffectiveRegime = { trend: "bull", vol: "high", confidence: "high", snapshotId: 7 };
    const getRegime = vi.fn(async () => regime);
    const all = [entry(1), entry(2), entry(3)];
    const decay = vi.fn<DecaySweepDeps["decayEntry"]>(async () => APPLIED);
    const deps: DecaySweepDeps = {
      listDecayableEntries: pagingList(all),
      decayEntry: decay,
      getEffectiveRegime: getRegime,
    };

    const now = new Date();
    await runDecaySweep(now, deps);

    expect(getRegime).toHaveBeenCalledTimes(1); // once per RUN, never per entry
    expect(decay).toHaveBeenCalledTimes(3);
    for (const call of decay.mock.calls) {
      expect(call[1]).toBe(now);
      expect(call[2]).toBe(regime); // the SAME view for every entry in the run
    }
  });

  it("degrades to regime null when the regime read throws (sweep still runs, fail-closed)", async () => {
    const getRegime = vi.fn(async () => {
      throw new Error("snapshots unreachable");
    });
    const all = [entry(1), entry(2)];
    const decay = vi.fn<DecaySweepDeps["decayEntry"]>(async () => APPLIED);
    const deps: DecaySweepDeps = {
      listDecayableEntries: pagingList(all),
      decayEntry: decay,
      getEffectiveRegime: getRegime,
    };

    const result = await runDecaySweep(new Date(), deps);
    expect(result.scanned).toBe(2);
    expect(result.decayed).toBe(2); // the sweep itself never aborts over the regime
    for (const call of decay.mock.calls) {
      expect(call[2]).toBeNull(); // pure S6a time decay
    }
  });
});
