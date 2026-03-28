/**
 * Subagents repo — lifecycle tracking.
 *
 * No parent_session_id/session_id fields — session_links is canonical.
 */

import { query, queryOne, execute } from "../client.js";

export type SubagentStatus = "running" | "completed" | "stopped" | "error" | "timeout" | "interrupted";

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

export async function updateStatus(
  id: string,
  status: SubagentStatus,
  extra?: { result?: string; error?: string; tokenCost?: number; iterations?: number },
): Promise<void> {
  const ended = status !== "running" ? "NOW()" : "ended_at";
  await execute(
    `UPDATE subagents SET status = $1, ended_at = ${ended},
     result = COALESCE($2, result), error = COALESCE($3, error),
     token_cost = COALESCE($4, token_cost), iterations = COALESCE($5, iterations)
     WHERE id = $6`,
    [status, extra?.result ?? null, extra?.error ?? null,
     extra?.tokenCost ?? null, extra?.iterations ?? null, id],
  );
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
