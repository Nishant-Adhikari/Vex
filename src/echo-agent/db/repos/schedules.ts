/**
 * Schedules repo — cron tasks with new contract (no cli_execute).
 */

import { query, queryOne, execute } from "../client.js";

export interface Schedule {
  id: string;
  name: string;
  description: string | null;
  cronExpression: string;
  taskType: string;
  payload: Record<string, unknown>;
  enabled: boolean;
  loopMode: string;
  lastRunAt: string | null;
  runCount: number;
  lastResult: Record<string, unknown> | null;
  createdAt: string;
}

function mapRow(r: Record<string, unknown>): Schedule {
  return {
    id: r.id as string,
    name: r.name as string,
    description: r.description as string | null,
    cronExpression: r.cron_expression as string,
    taskType: r.task_type as string,
    payload: r.payload as Record<string, unknown>,
    enabled: r.enabled as boolean,
    loopMode: r.loop_mode as string,
    lastRunAt: r.last_run_at as string | null,
    runCount: r.run_count as number,
    lastResult: r.last_result as Record<string, unknown> | null,
    createdAt: r.created_at as string,
  };
}

export async function createSchedule(schedule: {
  id: string; name: string; description?: string; cronExpression: string;
  taskType: string; payload: Record<string, unknown>; loopMode?: string;
}): Promise<void> {
  await execute(
    `INSERT INTO schedules (id, name, description, cron_expression, task_type, payload, loop_mode)
     VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (id) DO NOTHING`,
    [schedule.id, schedule.name, schedule.description ?? null, schedule.cronExpression,
     schedule.taskType, JSON.stringify(schedule.payload), schedule.loopMode ?? "restricted"],
  );
}

export async function deleteSchedule(id: string): Promise<boolean> {
  const n = await execute("DELETE FROM schedules WHERE id = $1", [id]);
  return n > 0;
}

export async function listSchedules(): Promise<Schedule[]> {
  const rows = await query<Record<string, unknown>>("SELECT * FROM schedules ORDER BY created_at");
  return rows.map(mapRow);
}

export async function getEnabled(): Promise<Schedule[]> {
  const rows = await query<Record<string, unknown>>("SELECT * FROM schedules WHERE enabled = TRUE ORDER BY created_at");
  return rows.map(mapRow);
}

export async function toggleSchedule(id: string, enabled: boolean): Promise<boolean> {
  const n = await execute("UPDATE schedules SET enabled = $2 WHERE id = $1", [id, enabled]);
  return n > 0;
}

export async function recordRun(id: string, result: Record<string, unknown>): Promise<void> {
  await execute(
    "UPDATE schedules SET last_run_at = NOW(), run_count = run_count + 1, last_result = $2 WHERE id = $1",
    [id, JSON.stringify(result)],
  );
  // Also insert into schedule_runs for audit
  await execute(
    "INSERT INTO schedule_runs (schedule_id, ended_at, result) VALUES ($1, NOW(), $2)",
    [id, JSON.stringify(result)],
  );
}

export async function recordRunError(id: string, error: string): Promise<void> {
  await execute(
    "UPDATE schedules SET last_run_at = NOW(), run_count = run_count + 1, last_result = $2 WHERE id = $1",
    [id, JSON.stringify({ error })],
  );
  await execute(
    "INSERT INTO schedule_runs (schedule_id, ended_at, error) VALUES ($1, NOW(), $2)",
    [id, error],
  );
}
