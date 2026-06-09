/**
 * Integration (real pgvector): regime snapshots + regime-aware decay end-to-end
 * (S6b) on a fresh DB.
 *
 * Covers the risk surface the non-DB unit tests cannot:
 *   - `insertRegimeSnapshot` / `getLatestRegimeSnapshot` /
 *     `getLatestTwoRegimeSnapshots` roundtrip with correct latest-first order;
 *   - every `rs_*` CHECK rejects an out-of-vocab value, and
 *     `ke_regime_tags_valid` (array containment) rejects a free-form lesson tag;
 *   - E2E decay: two agreeing snapshots make a MISMATCHING lesson decay faster
 *     than a neutral one, audited as `regime_decay` with the latest snapshot id
 *     in trigger_refs;
 *   - a decayed MATCHING lesson under a high-confidence dwell pair is
 *     REACTIVATED to `established` (and is hot-context-eligible again);
 *   - no snapshots → pure S6a time decay (regression);
 *   - the sweep is idempotent (an immediate re-run writes nothing).
 *
 * Seeds knowledge_entries + regime_snapshots via raw SQL (no embeddings
 * endpoint; explicit created_at for deterministic dwell windows).
 */

import { describe, it, expect, beforeEach } from "vitest";

import { query } from "@vex-agent/db/client.js";
import {
  insertRegimeSnapshot,
  getLatestRegimeSnapshot,
  getLatestTwoRegimeSnapshots,
} from "@vex-agent/db/repos/regime-snapshots.js";
import { getMaturityEventsForEntry } from "@vex-agent/db/repos/knowledge-maturity-events/index.js";
import { runDecaySweep } from "@vex-agent/engine/memory-manager/decay-sweep.js";
import {
  ACTIVATION_HALF_LIFE_DAYS,
  DECAY_FLOOR,
  REACTIVATION_ACTIVATION,
} from "@vex-agent/memory/manager/maturity-policy.js";
import { resetDb, randVector } from "../setup/fixtures.js";
import { hex64, EMBEDDING_DIM, EMBEDDING_MODEL } from "./_s1c-fixtures.js";

const MS_PER_HOUR = 60 * 60 * 1000;

/** ISO timestamp `hours` before now. */
function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * MS_PER_HOUR).toISOString();
}

/** Seed a regime snapshot with an explicit created_at (dwell-window control). */
async function seedSnapshot(args: {
  trend: string;
  vol: string;
  confidence: string;
  createdAt: string;
  source?: string;
}): Promise<number> {
  const rows = await query<{ id: number }>(
    `INSERT INTO regime_snapshots (trend_label, vol_label, confidence, source, rationale, created_at)
     VALUES ($1, $2, $3, $4, NULL, $5::timestamptz)
     RETURNING id`,
    [args.trend, args.vol, args.confidence, args.source ?? "hybrid", args.createdAt],
  );
  return rows[0]!.id;
}

/** Seed a knowledge_entries row with explicit maturity/activation/regime state. */
async function seedEntry(args: {
  seed: string;
  maturityState: string;
  activation: number;
  regimeTags: string[];
  lastReinforcedAt: string;
  decayPolicy?: string;
}): Promise<number> {
  const rows = await query<{ id: number }>(
    `INSERT INTO knowledge_entries
       (kind, title, summary, content_hash, embedding_model, embedding_dim, embedding,
        source, maturity_state, activation_strength, decay_policy, regime_tags,
        first_promoted_at, last_reinforced_at)
     VALUES ('strategy_lesson', 't', 's', $1, $2, $3, $4::vector,
        'observed', $5, $6, $7, $8::text[], $9::timestamptz, $9::timestamptz)
     RETURNING id`,
    [
      hex64(`rs-${args.seed}`),
      EMBEDDING_MODEL,
      EMBEDDING_DIM,
      `[${randVector(EMBEDDING_DIM, args.seed).join(",")}]`,
      args.maturityState,
      args.activation,
      args.decayPolicy ?? "regime_aware",
      args.regimeTags,
      args.lastReinforcedAt,
    ],
  );
  return rows[0]!.id;
}

async function readEntry(id: number): Promise<{
  maturity_state: string;
  activation_strength: number;
}> {
  const rows = await query<{ maturity_state: string; activation_strength: number }>(
    "SELECT maturity_state, activation_strength FROM knowledge_entries WHERE id = $1",
    [id],
  );
  return rows[0]!;
}

describe("regime snapshots + regime-aware decay (integration)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  // ── Repo roundtrip + ordering ───────────────────────────────────

  it("insertRegimeSnapshot roundtrips; getLatest/getLatestTwo are latest-first", async () => {
    const older = await seedSnapshot({
      trend: "bear",
      vol: "low",
      confidence: "medium",
      createdAt: hoursAgo(26),
    });
    const inserted = await insertRegimeSnapshot({
      trendLabel: "bull",
      volLabel: "high",
      confidence: "high",
      source: "hybrid",
      rationale: "broad agreement",
    });
    expect(inserted.trendLabel).toBe("bull");
    expect(inserted.volLabel).toBe("high");
    expect(inserted.confidence).toBe("high");
    expect(inserted.source).toBe("hybrid");
    expect(inserted.rationale).toBe("broad agreement");

    const latest = await getLatestRegimeSnapshot();
    expect(latest?.id).toBe(inserted.id);

    const latestTwo = await getLatestTwoRegimeSnapshots();
    expect(latestTwo.map((s) => s.id)).toEqual([inserted.id, older]);
    expect(latestTwo[0]!.trendLabel).toBe("bull");
    expect(latestTwo[1]!.trendLabel).toBe("bear");
  });

  it("getLatestRegimeSnapshot is null and getLatestTwo empty on a fresh DB", async () => {
    expect(await getLatestRegimeSnapshot()).toBeNull();
    expect(await getLatestTwoRegimeSnapshots()).toEqual([]);
  });

  // ── CHECK constraints (closed vocabularies, DB-enforced) ────────

  it("every rs_* CHECK rejects an out-of-vocab value", async () => {
    await expect(
      seedSnapshot({ trend: "moon", vol: "high", confidence: "high", createdAt: hoursAgo(1) }),
    ).rejects.toThrow(/rs_trend_valid/);
    await expect(
      seedSnapshot({ trend: "bull", vol: "extreme", confidence: "high", createdAt: hoursAgo(1) }),
    ).rejects.toThrow(/rs_vol_valid/);
    await expect(
      seedSnapshot({ trend: "bull", vol: "high", confidence: "0.9", createdAt: hoursAgo(1) }),
    ).rejects.toThrow(/rs_confidence_valid/);
    await expect(
      seedSnapshot({
        trend: "bull",
        vol: "high",
        confidence: "high",
        createdAt: hoursAgo(1),
        source: "heuristic", // deliberately NOT in the vocabulary (fail-closed doctrine)
      }),
    ).rejects.toThrow(/rs_source_valid/);
  });

  it("ke_regime_tags_valid rejects an out-of-vocab lesson tag (array containment)", async () => {
    await expect(
      seedEntry({
        seed: "badtag",
        maturityState: "established",
        activation: 0.8,
        regimeTags: ["bull_microcap"],
        lastReinforcedAt: hoursAgo(24),
      }),
    ).rejects.toThrow(/ke_regime_tags_valid/);
    // The full closed vocabulary is accepted.
    await expect(
      seedEntry({
        seed: "goodtags",
        maturityState: "established",
        activation: 0.8,
        regimeTags: ["bull", "bear", "range", "high_vol", "low_vol"],
        lastReinforcedAt: hoursAgo(24),
      }),
    ).resolves.toBeGreaterThan(0);
  });

  // ── E2E: dwell pair + regime-modulated sweep ────────────────────

  /** Two agreeing bear/high snapshots, 24h apart, latest 2h old. */
  async function seedAgreeingBearPair(confidence = "high"): Promise<number> {
    await seedSnapshot({ trend: "bear", vol: "high", confidence, createdAt: hoursAgo(26) });
    return seedSnapshot({ trend: "bear", vol: "high", confidence, createdAt: hoursAgo(2) });
  }

  it("a MISMATCHING lesson decays faster than a neutral one, audited as regime_decay with the snapshot id", async () => {
    const latestSnapId = await seedAgreeingBearPair();

    const thirtyDaysAgo = hoursAgo(ACTIVATION_HALF_LIFE_DAYS * 24);
    const mismatching = await seedEntry({
      seed: "mismatch",
      maturityState: "established",
      activation: 0.8,
      regimeTags: ["bull"], // regime is bear → mismatch → 15d half-life
      lastReinforcedAt: thirtyDaysAgo,
    });
    const neutral = await seedEntry({
      seed: "neutral",
      maturityState: "established",
      activation: 0.8,
      regimeTags: [], // timeless → base 30d half-life
      lastReinforcedAt: thirtyDaysAgo,
    });

    const result = await runDecaySweep();
    expect(result.errored).toBe(0);

    const mismatchRow = await readEntry(mismatching);
    const neutralRow = await readEntry(neutral);
    // 30 days: neutral ≈ 0.8 × 0.5^1 = 0.4; mismatch ≈ 0.8 × 0.5^2 = 0.2.
    expect(neutralRow.activation_strength).toBeCloseTo(0.4, 2);
    expect(mismatchRow.activation_strength).toBeLessThan(neutralRow.activation_strength);
    expect(mismatchRow.activation_strength).toBeGreaterThanOrEqual(DECAY_FLOOR);

    const mismatchHistory = await getMaturityEventsForEntry(mismatching);
    expect(mismatchHistory[0]!.event).toBe("decayed");
    expect(mismatchHistory[0]!.reasonCode).toBe("regime_decay");
    expect(mismatchHistory[0]!.triggerRefs).toEqual({ regimeSnapshotId: latestSnapId });

    const neutralHistory = await getMaturityEventsForEntry(neutral);
    expect(neutralHistory[0]!.reasonCode).toBe("time_decay");
    expect(neutralHistory[0]!.triggerRefs).toEqual({});
  });

  it("REACTIVATES a decayed MATCHING lesson to established under a high-confidence pair (hot-context-eligible again)", async () => {
    const latestSnapId = await seedAgreeingBearPair("high");

    const decayedEntry = await seedEntry({
      seed: "react",
      maturityState: "decayed",
      activation: DECAY_FLOOR,
      regimeTags: ["bear", "high_vol"], // matches the bear/high regime
      lastReinforcedAt: hoursAgo(24 * 90),
    });

    await runDecaySweep();

    const row = await readEntry(decayedEntry);
    expect(row.maturity_state).toBe("established");
    expect(row.activation_strength).toBeCloseTo(REACTIVATION_ACTIVATION, 6);

    const history = await getMaturityEventsForEntry(decayedEntry);
    expect(history[0]!.event).toBe("reactivated");
    expect(history[0]!.reasonCode).toBe("regime_decay");
    expect(history[0]!.triggerRefs).toEqual({ regimeSnapshotId: latestSnapId });

    // Hot-context eligibility (S6a R1#6 exclusion list): no longer excluded.
    const eligible = await query<{ n: string }>(
      `SELECT count(*)::text AS n FROM knowledge_entries
        WHERE id = $1 AND maturity_state NOT IN ('probationary','decayed')`,
      [decayedEntry],
    );
    expect(eligible[0]!.n).toBe("1");
  });

  it("does NOT reactivate under a medium-confidence pair (F4: high required)", async () => {
    await seedAgreeingBearPair("medium");
    const decayedEntry = await seedEntry({
      seed: "no-react",
      maturityState: "decayed",
      activation: DECAY_FLOOR,
      regimeTags: ["bear"],
      lastReinforcedAt: hoursAgo(24 * 90),
    });

    await runDecaySweep();

    const row = await readEntry(decayedEntry);
    expect(row.maturity_state).toBe("decayed"); // stays down; influence only erodes
    const history = await getMaturityEventsForEntry(decayedEntry);
    expect(history.every((h) => h.event !== "reactivated")).toBe(true);
  });

  it("with NO snapshots the sweep is pure S6a time decay (regression)", async () => {
    const entry = await seedEntry({
      seed: "timeonly",
      maturityState: "established",
      activation: 0.8,
      regimeTags: ["bull"], // tags present, but no regime → no modulation
      lastReinforcedAt: hoursAgo(ACTIVATION_HALF_LIFE_DAYS * 24),
    });

    await runDecaySweep();

    const row = await readEntry(entry);
    expect(row.activation_strength).toBeCloseTo(0.4, 2); // base 30d half-life
    const history = await getMaturityEventsForEntry(entry);
    expect(history[0]!.reasonCode).toBe("time_decay");
    expect(history[0]!.triggerRefs).toEqual({});
  });

  it("the regime-aware sweep is idempotent (an immediate re-run writes nothing)", async () => {
    await seedAgreeingBearPair();
    const mismatching = await seedEntry({
      seed: "idem",
      maturityState: "established",
      activation: 0.8,
      regimeTags: ["bull"],
      lastReinforcedAt: hoursAgo(ACTIVATION_HALF_LIFE_DAYS * 24),
    });
    const reactivatable = await seedEntry({
      seed: "idem-react",
      maturityState: "decayed",
      activation: DECAY_FLOOR,
      regimeTags: ["bear"],
      lastReinforcedAt: hoursAgo(24 * 90),
    });

    const first = await runDecaySweep();
    expect(first.decayed).toBeGreaterThanOrEqual(2);
    const mismatchAfterFirst = await readEntry(mismatching);
    const auditCountAfterFirst =
      (await getMaturityEventsForEntry(mismatching)).length +
      (await getMaturityEventsForEntry(reactivatable)).length;

    const second = await runDecaySweep();
    expect(second.decayed).toBe(0); // below_delta no-ops; reactivated entry restarted its clock

    const mismatchAfterSecond = await readEntry(mismatching);
    expect(mismatchAfterSecond.activation_strength).toBe(mismatchAfterFirst.activation_strength);
    const auditCountAfterSecond =
      (await getMaturityEventsForEntry(mismatching)).length +
      (await getMaturityEventsForEntry(reactivatable)).length;
    expect(auditCountAfterSecond).toBe(auditCountAfterFirst); // no audit spam
  });
});
