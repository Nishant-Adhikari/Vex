/**
 * Subagents repo — lifecycle tracking.
 *
 * No parent_session_id/session_id fields — session_links is canonical.
 */

import { query, queryOne, execute } from "../client.js";

// ── Status transition matrix ───────────────────────────────────
// CAS-style guard: atomically enforce valid transitions.

const NON_TERMINAL_STATUSES = new Set<string>(["running", "waiting_for_parent"]);

const VALID_TRANSITIONS: Record<string, Set<string>> = {
  running: new Set(["completed", "stopped", "error", "timeout", "waiting_for_parent"]),
  waiting_for_parent: new Set(["running", "stopped", "error", "timeout"]),
  completed: new Set(),
  stopped: new Set(),
  error: new Set(),
  timeout: new Set(),
  interrupted: new Set(),
};

export type SubagentStatus = "running" | "completed" | "stopped" | "error" | "timeout" | "interrupted" | "waiting_for_parent";

export interface SubagentState {
  id: string;
  name: string;
  task: string;
  status: SubagentStatus;
  allowTrades: boolean;
  startedAt: string;
  endedAt: string | null;
  result: string | null;
  error: string | null;
  tokenCost: number;
  iterations: number;
  maxIterations: number;
}

function mapRow(row: Record<string, unknown>): SubagentState {
  return {
    id: row.id as string,
    name: row.name as string,
    task: row.task as string,
    status: row.status as SubagentStatus,
    allowTrades: row.allow_trades as boolean,
    startedAt: (row.started_at as Date).toISOString(),
    endedAt: row.ended_at ? (row.ended_at as Date).toISOString() : null,
    result: row.result as string | null,
    error: row.error as string | null,
    tokenCost: Number(row.token_cost ?? 0),
    iterations: row.iterations as number,
    maxIterations: row.max_iterations as number,
  };
}

export async function insert(subagent: {
  id: string; name: string; task: string; allowTrades: boolean; maxIterations: number;
}): Promise<void> {
  await execute(
    `INSERT INTO subagents (id, name, task, allow_trades, max_iterations) VALUES ($1, $2, $3, $4, $5)`,
    [subagent.id, subagent.name, subagent.task, subagent.allowTrades, subagent.maxIterations],
  );
}

/**
 * Atomically update subagent status with CAS-style transition guard.
 * Uses WHERE status = ANY(allowedSources) — two parallel calls with
 * the same target status will not both succeed.
 */
export async function updateStatus(
  id: string,
  newStatus: SubagentStatus,
  extra?: { result?: string; error?: string; tokenCost?: number; iterations?: number },
): Promise<void> {
  // Compute allowed source statuses for this transition
  const allowedFrom = Object.entries(VALID_TRANSITIONS)
    .filter(([, targets]) => targets.has(newStatus))
    .map(([source]) => source);

  if (allowedFrom.length === 0) {
    throw new Error(`No valid source status for transition to "${newStatus}"`);
  }

  const ended = NON_TERMINAL_STATUSES.has(newStatus) ? "ended_at" : "NOW()";

  const result = await queryOne<{ id: string }>(
    `UPDATE subagents SET status = $1, ended_at = ${ended},
     result = COALESCE($2, result), error = COALESCE($3, error),
     token_cost = COALESCE($4, token_cost), iterations = COALESCE($5, iterations)
     WHERE id = $6 AND status = ANY($7)
     RETURNING id`,
    [newStatus, extra?.result ?? null, extra?.error ?? null,
     extra?.tokenCost ?? null, extra?.iterations ?? null,
     id, allowedFrom],
  );

  if (!result) {
    const current = await getById(id);
    throw new Error(
      `Invalid status transition: ${current?.status ?? "unknown"} → ${newStatus} for subagent ${id}`,
    );
  }
}

export async function getById(id: string): Promise<SubagentState | null> {
  const row = await queryOne<Record<string, unknown>>("SELECT * FROM subagents WHERE id = $1", [id]);
  return row ? mapRow(row) : null;
}

export async function getActive(): Promise<SubagentState[]> {
  const rows = await query<Record<string, unknown>>(
    "SELECT * FROM subagents WHERE status = 'running' ORDER BY started_at ASC",
  );
  return rows.map(mapRow);
}

export async function getRecent(limit = 10): Promise<SubagentState[]> {
  const rows = await query<Record<string, unknown>>(
    "SELECT * FROM subagents ORDER BY started_at DESC LIMIT $1",
    [limit],
  );
  return rows.map(mapRow);
}

/** Startup recovery: mark orphaned running subagents as interrupted. */
export async function markOrphans(): Promise<number> {
  const result = await query<Record<string, unknown>>(
    "UPDATE subagents SET status = 'interrupted', ended_at = NOW() WHERE status = 'running' RETURNING id",
  );
  return result.length;
}
