import { execute, query, queryOne, withTransaction } from "../client.js";

export type SimulatorBatchStatus = "active" | "completed" | "aborted";

export interface SimulatorBatch {
  id: string;
  status: SimulatorBatchStatus;
  goal: string;
  requestedParallel: number;
  launchedCount: number;
  completedCount: number;
  winnerRunId: string | null;
  winnerScore: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface SimulatorBatchEntry {
  id: string;
  batchId: string;
  ordinal: number;
  sessionId: string;
  missionId: string;
  missionRunId: string;
  status: string;
  score: number | null;
  createdAt: string;
  updatedAt: string;
}

function iso(v: string | Date): string {
  return v instanceof Date ? v.toISOString() : String(v);
}

function num(v: string | number | null): number | null {
  return v === null ? null : Number(v);
}

function mapBatch(r: Record<string, unknown>): SimulatorBatch {
  return {
    id: r.id as string,
    status: r.status as SimulatorBatchStatus,
    goal: r.goal as string,
    requestedParallel: Number(r.requested_parallel),
    launchedCount: Number(r.launched_count),
    completedCount: Number(r.completed_count),
    winnerRunId: (r.winner_run_id ?? null) as string | null,
    winnerScore: num((r.winner_score ?? null) as string | number | null),
    createdAt: iso(r.created_at as string | Date),
    updatedAt: iso(r.updated_at as string | Date),
  };
}

function mapEntry(r: Record<string, unknown>): SimulatorBatchEntry {
  return {
    id: r.id as string,
    batchId: r.batch_id as string,
    ordinal: Number(r.ordinal),
    sessionId: r.session_id as string,
    missionId: r.mission_id as string,
    missionRunId: r.mission_run_id as string,
    status: r.status as string,
    score: num((r.score ?? null) as string | number | null),
    createdAt: iso(r.created_at as string | Date),
    updatedAt: iso(r.updated_at as string | Date),
  };
}

export async function createSimulatorBatch(input: {
  id: string;
  goal: string;
  requestedParallel: number;
}): Promise<void> {
  await execute(
    `INSERT INTO simulator_batches (
      id, goal, requested_parallel
    ) VALUES ($1, $2, $3)`,
    [input.id, input.goal, input.requestedParallel],
  );
}

export async function addSimulatorBatchEntry(input: {
  id: string;
  batchId: string;
  ordinal: number;
  sessionId: string;
  missionId: string;
  missionRunId: string;
}): Promise<void> {
  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO simulator_batch_entries (
        id, batch_id, ordinal, session_id, mission_id, mission_run_id
      ) VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        input.id,
        input.batchId,
        input.ordinal,
        input.sessionId,
        input.missionId,
        input.missionRunId,
      ],
    );
    await client.query(
      `UPDATE simulator_batches
          SET launched_count = launched_count + 1,
              updated_at = NOW()
        WHERE id = $1`,
      [input.batchId],
    );
  });
}

export async function listActiveSimulatorBatches(
  limit = 10,
): Promise<readonly SimulatorBatch[]> {
  const rows = await query<Record<string, unknown>>(
    `SELECT * FROM simulator_batches
      WHERE status = 'active'
      ORDER BY created_at DESC
      LIMIT $1`,
    [limit],
  );
  return rows.map(mapBatch);
}

export async function listCompletedSimulatorBatches(
  limit = 100,
): Promise<readonly SimulatorBatch[]> {
  const rows = await query<Record<string, unknown>>(
    `SELECT * FROM simulator_batches
      WHERE status = 'completed'
      ORDER BY created_at ASC
      LIMIT $1`,
    [limit],
  );
  return rows.map(mapBatch);
}

export async function getLatestSimulatorBatch(): Promise<SimulatorBatch | null> {
  const row = await queryOne<Record<string, unknown>>(
    `SELECT * FROM simulator_batches
      ORDER BY created_at DESC
      LIMIT 1`,
  );
  return row ? mapBatch(row) : null;
}

export async function listEntriesForBatch(
  batchId: string,
): Promise<readonly SimulatorBatchEntry[]> {
  const rows = await query<Record<string, unknown>>(
    `SELECT * FROM simulator_batch_entries
      WHERE batch_id = $1
      ORDER BY ordinal ASC`,
    [batchId],
  );
  return rows.map(mapEntry);
}

export async function updateSimulatorBatchEntry(
  batchId: string,
  missionRunId: string,
  patch: { status: string; score: number | null },
): Promise<void> {
  await execute(
    `UPDATE simulator_batch_entries
        SET status = $3,
            score = $4,
            updated_at = NOW()
      WHERE batch_id = $1
        AND mission_run_id = $2`,
    [batchId, missionRunId, patch.status, patch.score],
  );
}

export async function finalizeSimulatorBatchState(input: {
  batchId: string;
  completedCount: number;
  winnerRunId: string | null;
  winnerScore: number | null;
  completed: boolean;
}): Promise<void> {
  await execute(
    `UPDATE simulator_batches
        SET completed_count = $2,
            winner_run_id = $3,
            winner_score = $4,
            status = $5,
            updated_at = NOW()
      WHERE id = $1`,
    [
      input.batchId,
      input.completedCount,
      input.winnerRunId,
      input.winnerScore,
      input.completed ? "completed" : "active",
    ],
  );
}
