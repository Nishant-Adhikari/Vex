/**
 * regime_snapshots repo — daily market-regime classification rows (S6b).
 *
 * One row per day, written ONLY by the regime worker. Advisory-only by
 * doctrine (OD-1): consumers are the regime-aware decay/reactivation path and
 * nothing else — never sizing / approval / wallet-intent / execution.
 *
 * `insertRegimeSnapshot` validates at this internal boundary (defense-in-depth
 * for the worker's one write path; the closed enums + rationale bound are
 * enforced here so a malformed call throws a clear error rather than tripping a
 * DB CHECK). `rationale` MUST already be redact()-ed by the caller — the repo
 * never logs it. Reads are latest-first: the worker's cadence gate needs the
 * latest row; the dwell pair (`effectiveRegime`, F3) needs the latest two.
 * `id DESC` tiebreaks same-timestamp rows so ordering stays deterministic.
 */

import { z } from "zod";

import { query, queryOne } from "../client.js";
import {
  regimeConfidenceSchema,
  regimeSourceSchema,
  regimeTrendLabelSchema,
  regimeVolLabelSchema,
  type RegimeConfidence,
  type RegimeSource,
  type RegimeTrendLabel,
  type RegimeVolLabel,
} from "@vex-agent/memory/schema/regime-enums.js";

// ── Insert input boundary ────────────────────────────────────────

/**
 * Hard rationale bound at the repo boundary. The LLM verdict already caps
 * rationale at 500 chars; redaction placeholders may shift the length slightly,
 * so the repo accepts up to this defense-in-depth bound and never more.
 */
export const REGIME_SNAPSHOT_RATIONALE_MAX = 1_000;

export const insertRegimeSnapshotInputSchema = z
  .object({
    trendLabel: regimeTrendLabelSchema,
    volLabel: regimeVolLabelSchema,
    confidence: regimeConfidenceSchema,
    source: regimeSourceSchema,
    /** Short structural "why" — redact()-ed BY THE CALLER; never raw evidence. */
    rationale: z.string().max(REGIME_SNAPSHOT_RATIONALE_MAX).nullable().default(null),
  })
  .strict();

/** Caller-facing input (PRE-parse: `rationale` defaulted to null). */
export type InsertRegimeSnapshotInput = z.input<typeof insertRegimeSnapshotInputSchema>;

// ── Row / domain shapes ──────────────────────────────────────────

interface RegimeSnapshotRow {
  id: number; // SERIAL (deliberately not BIGSERIAL — see 001_initial.sql)
  trend_label: string;
  vol_label: string;
  confidence: string;
  source: string;
  rationale: string | null;
  created_at: string;
}

export interface RegimeSnapshot {
  id: number;
  trendLabel: RegimeTrendLabel;
  volLabel: RegimeVolLabel;
  confidence: RegimeConfidence;
  source: RegimeSource;
  rationale: string | null;
  createdAt: string;
}

const SNAPSHOT_COLUMNS = "id, trend_label, vol_label, confidence, source, rationale, created_at";

export function mapRow(r: RegimeSnapshotRow): RegimeSnapshot {
  return {
    id: r.id,
    trendLabel: r.trend_label as RegimeTrendLabel,
    volLabel: r.vol_label as RegimeVolLabel,
    confidence: r.confidence as RegimeConfidence,
    source: r.source as RegimeSource,
    rationale: r.rationale,
    createdAt: r.created_at,
  };
}

// ── Writes ───────────────────────────────────────────────────────

/**
 * Append one regime snapshot (plain INSERT — every classification is a distinct
 * historical fact; there is no upsert/merge). Returns the persisted record.
 */
export async function insertRegimeSnapshot(
  rawInput: InsertRegimeSnapshotInput,
): Promise<RegimeSnapshot> {
  const input = insertRegimeSnapshotInputSchema.parse(rawInput);
  const row = await queryOne<RegimeSnapshotRow>(
    `INSERT INTO regime_snapshots (trend_label, vol_label, confidence, source, rationale)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING ${SNAPSHOT_COLUMNS}`,
    [input.trendLabel, input.volLabel, input.confidence, input.source, input.rationale],
  );
  if (!row) {
    throw new Error("regime_snapshots insert returned no row");
  }
  return mapRow(row);
}

// ── Reads (latest-first) ─────────────────────────────────────────

/** The newest snapshot (the worker's cadence gate), or null on an empty table. */
export async function getLatestRegimeSnapshot(): Promise<RegimeSnapshot | null> {
  const row = await queryOne<RegimeSnapshotRow>(
    `SELECT ${SNAPSHOT_COLUMNS} FROM regime_snapshots
      ORDER BY created_at DESC, id DESC
      LIMIT 1`,
  );
  return row ? mapRow(row) : null;
}

/**
 * The newest TWO snapshots, newest first — the dwell pair for
 * `effectiveRegime` (F3: a regime only takes effect when two consecutive days
 * agree). Returns 0/1/2 rows; the caller treats < 2 as "no effective regime".
 */
export async function getLatestTwoRegimeSnapshots(): Promise<RegimeSnapshot[]> {
  const rows = await query<RegimeSnapshotRow>(
    `SELECT ${SNAPSHOT_COLUMNS} FROM regime_snapshots
      ORDER BY created_at DESC, id DESC
      LIMIT 2`,
  );
  return rows.map(mapRow);
}
