/**
 * Adaptive strategy versions repo (migration 047) — the versioned TACTICS layer
 * of the mission prompt and the immutable audit log of the self-improving loop.
 *
 * Append-only: a prior version is NEVER mutated or deleted. Activation is a
 * transaction that flips exactly one row `active` (the partial unique index
 * makes a double-active a hard error) and archives the outgoing one, so the
 * "which version do live missions run?" question always has one answer.
 *
 * Every proposal — accepted OR rejected — is stored, so the full trail of
 * "which mission + which lessons drove (or were refused for) each change" is a
 * read over this table. Rollback and reset-to-baseline are just re-activations.
 */

import { query, queryOne, execute, withTransaction, queryOneWith, executeWith } from "../client.js";
import { jsonb } from "../params.js";

export type StrategyVersionStatus =
  | "baseline"
  | "pending"
  | "active"
  | "archived"
  | "rejected";

export interface StrategyVersionRow {
  id: string;
  versionNo: number;
  content: string;
  status: StrategyVersionStatus;
  isBaseline: boolean;
  active: boolean;
  drivingMissionRunId: string | null;
  drivingLessons: string[];
  rejectionReason: string | null;
  audit: Record<string, unknown>;
  model: string | null;
  createdAt: string;
  activatedAt: string | null;
}

interface Raw {
  id: string;
  version_no: number;
  content: string;
  status: string;
  is_baseline: boolean;
  active: boolean;
  driving_mission_run_id: string | null;
  driving_lessons_json: unknown;
  rejection_reason: string | null;
  audit_json: unknown;
  model: string | null;
  created_at: Date | string;
  activated_at: Date | string | null;
}

function toStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

function toRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function toIso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

function toRow(r: Raw): StrategyVersionRow {
  return {
    id: r.id,
    versionNo: r.version_no,
    content: r.content,
    status: r.status as StrategyVersionStatus,
    isBaseline: r.is_baseline,
    active: r.active,
    drivingMissionRunId: r.driving_mission_run_id,
    drivingLessons: toStringList(r.driving_lessons_json),
    rejectionReason: r.rejection_reason,
    audit: toRecord(r.audit_json),
    model: r.model,
    createdAt: toIso(r.created_at) ?? "",
    activatedAt: toIso(r.activated_at),
  };
}

const COLS = `
  id, version_no, content, status, is_baseline, active,
  driving_mission_run_id, driving_lessons_json, rejection_reason,
  audit_json, model, created_at, activated_at`;

/** The single live version (`active = TRUE`), or null when none is active. */
export async function getActiveVersion(): Promise<StrategyVersionRow | null> {
  const row = await queryOne<Raw>(
    `SELECT ${COLS} FROM strategy_versions WHERE active = TRUE LIMIT 1`,
  );
  return row ? toRow(row) : null;
}

/** The immutable human baseline (version 0), or null before it is seeded. */
export async function getBaselineVersion(): Promise<StrategyVersionRow | null> {
  const row = await queryOne<Raw>(
    `SELECT ${COLS} FROM strategy_versions WHERE is_baseline = TRUE LIMIT 1`,
  );
  return row ? toRow(row) : null;
}

export async function getVersionById(
  id: string,
): Promise<StrategyVersionRow | null> {
  const row = await queryOne<Raw>(
    `SELECT ${COLS} FROM strategy_versions WHERE id = $1`,
    [id],
  );
  return row ? toRow(row) : null;
}

/** Recent versions for the audit view (newest first). */
export async function listVersions(limit = 50): Promise<StrategyVersionRow[]> {
  const rows = await query<Raw>(
    `SELECT ${COLS} FROM strategy_versions ORDER BY version_no DESC LIMIT $1`,
    [limit],
  );
  return rows.map(toRow);
}

/** Pending proposals awaiting human approval (newest first). */
export async function listPendingVersions(
  limit = 20,
): Promise<StrategyVersionRow[]> {
  const rows = await query<Raw>(
    `SELECT ${COLS} FROM strategy_versions
      WHERE status = 'pending' ORDER BY version_no DESC LIMIT $1`,
    [limit],
  );
  return rows.map(toRow);
}

/**
 * The last K contents that were ever ACTIVATED (active or archived), newest
 * first — the input to flip-flop / oscillation detection.
 */
export async function getRecentAdoptedContents(k: number): Promise<string[]> {
  const rows = await query<Raw>(
    `SELECT ${COLS} FROM strategy_versions
      WHERE activated_at IS NOT NULL
      ORDER BY activated_at DESC LIMIT $1`,
    [k],
  );
  return rows.map(toRow).map((r) => r.content);
}

async function nextVersionNo(): Promise<number> {
  const row = await queryOne<{ max: number | null }>(
    `SELECT MAX(version_no) AS max FROM strategy_versions`,
  );
  return (row?.max ?? -1) + 1;
}

/**
 * Seed the baseline (version 0) if absent, and guarantee something is active.
 * Idempotent. Returns the active version after the call.
 *
 * If a baseline row exists but nothing is active (a corrupted state), the
 * baseline is (re)activated so live missions always have a version to run.
 */
export async function ensureBaseline(
  baselineContent: string,
): Promise<StrategyVersionRow> {
  return withTransaction(async (tx) => {
    const existing = await queryOneWith<Raw>(
      tx,
      `SELECT ${COLS} FROM strategy_versions WHERE is_baseline = TRUE LIMIT 1`,
    );
    if (!existing) {
      await executeWith(
        tx,
        `INSERT INTO strategy_versions
           (id, version_no, content, status, is_baseline, active, activated_at)
         VALUES ($1, 0, $2, 'baseline', TRUE, TRUE, NOW())`,
        [`strat-baseline`, baselineContent],
      );
      const seeded = await queryOneWith<Raw>(
        tx,
        `SELECT ${COLS} FROM strategy_versions WHERE is_baseline = TRUE LIMIT 1`,
      );
      return toRow(seeded!);
    }
    const anyActive = await queryOneWith<Raw>(
      tx,
      `SELECT ${COLS} FROM strategy_versions WHERE active = TRUE LIMIT 1`,
    );
    if (!anyActive) {
      await executeWith(
        tx,
        `UPDATE strategy_versions SET active = TRUE, status = 'active', activated_at = NOW()
          WHERE id = $1`,
        [existing.id],
      );
    }
    const active = await queryOneWith<Raw>(
      tx,
      `SELECT ${COLS} FROM strategy_versions WHERE active = TRUE LIMIT 1`,
    );
    return toRow((active ?? existing));
  });
}

export interface InsertProposalInput {
  id: string;
  content: string;
  /** 'pending' (awaiting approval) or 'rejected' (a guardrail refused it). */
  status: Extract<StrategyVersionStatus, "pending" | "rejected">;
  drivingMissionRunId: string | null;
  drivingLessons: string[];
  rejectionReason: string | null;
  audit: Record<string, unknown>;
  model: string | null;
}

/**
 * Persist a freshly proposed revision (never active). A 'pending' row awaits
 * approval; a 'rejected' row is audit-only. Consumes the next version number so
 * the log stays a clean monotonic history. Returns the stored row.
 */
export async function insertProposal(
  input: InsertProposalInput,
): Promise<StrategyVersionRow> {
  return withTransaction(async (tx) => {
    const maxRow = await queryOneWith<{ max: number | null }>(
      tx,
      `SELECT MAX(version_no) AS max FROM strategy_versions`,
    );
    const versionNo = (maxRow?.max ?? -1) + 1;
    await executeWith(
      tx,
      `INSERT INTO strategy_versions
         (id, version_no, content, status, is_baseline, active,
          driving_mission_run_id, driving_lessons_json, rejection_reason,
          audit_json, model)
       VALUES ($1, $2, $3, $4, FALSE, FALSE, $5, $6::jsonb, $7, $8::jsonb, $9)`,
      [
        input.id,
        versionNo,
        input.content,
        input.status,
        input.drivingMissionRunId,
        jsonb(input.drivingLessons),
        input.rejectionReason,
        jsonb(input.audit),
        input.model,
      ],
    );
    const row = await queryOneWith<Raw>(
      tx,
      `SELECT ${COLS} FROM strategy_versions WHERE id = $1`,
      [input.id],
    );
    return toRow(row!);
  });
}

/**
 * Activate a version (approve a pending, roll back to an archived, or re-adopt
 * the baseline). Transaction: archive the outgoing active, then flip the target
 * to active. The target must exist and not be 'rejected'. Returns the new active
 * row, or null when the id is unknown / rejected.
 */
export async function activateVersion(
  id: string,
): Promise<StrategyVersionRow | null> {
  return withTransaction(async (tx) => {
    const target = await queryOneWith<Raw>(
      tx,
      `SELECT ${COLS} FROM strategy_versions WHERE id = $1`,
      [id],
    );
    if (!target || target.status === "rejected") return null;
    // Archive whatever is currently active (baseline rows keep is_baseline).
    await executeWith(
      tx,
      `UPDATE strategy_versions
          SET active = FALSE,
              status = CASE WHEN is_baseline THEN 'baseline' ELSE 'archived' END
        WHERE active = TRUE AND id <> $1`,
      [id],
    );
    await executeWith(
      tx,
      `UPDATE strategy_versions
          SET active = TRUE,
              status = CASE WHEN is_baseline THEN 'baseline' ELSE 'active' END,
              activated_at = NOW()
        WHERE id = $1`,
      [id],
    );
    const row = await queryOneWith<Raw>(
      tx,
      `SELECT ${COLS} FROM strategy_versions WHERE id = $1`,
      [id],
    );
    return toRow(row!);
  });
}

/**
 * Reset the live strategy to the human baseline. Re-syncs the baseline row's
 * content to the current source constant (so seed edits propagate) and activates
 * it. Returns the now-active baseline row.
 */
export async function resetToBaseline(
  baselineContent: string,
): Promise<StrategyVersionRow> {
  await ensureBaseline(baselineContent);
  const baseline = await getBaselineVersion();
  if (baseline === null) {
    // ensureBaseline guarantees a row; this is defensive.
    throw new Error("strategy baseline missing after ensureBaseline");
  }
  await execute(
    `UPDATE strategy_versions SET content = $2 WHERE id = $1`,
    [baseline.id, baselineContent],
  );
  const activated = await activateVersion(baseline.id);
  return activated ?? baseline;
}
