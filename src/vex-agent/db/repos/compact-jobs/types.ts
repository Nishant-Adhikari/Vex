/**
 * Compact-jobs repo — types + row mapper + column list.
 *
 * Track 2 outbox state machine: `pending → running → completed | failed →
 * permanently_failed`. Stale `running` rows are recovered by the worker
 * bootstrap based on `heartbeat_at` age.
 */

export type CompactJobStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "permanently_failed";

export const COMPACT_JOB_STATUSES: readonly CompactJobStatus[] = [
  "pending",
  "running",
  "completed",
  "failed",
  "permanently_failed",
] as const;

export interface CompactJob {
  id: number;
  sessionId: string;
  checkpointGeneration: number;
  status: CompactJobStatus;
  agentSummary: string;
  preserveMd: string | null;
  threadThemesHints: string[];
  sourceStartMessageId: number | null;
  sourceEndMessageId: number;
  attemptCount: number;
  maxAttempts: number;
  nextAttemptAt: string;
  lockedAt: string | null;
  lockedBy: string | null;
  heartbeatAt: string | null;
  lastError: string | null;
  chunksInserted: number;
  chunksRejectedByExclusion: number;
  chunksRejectedByRedaction: number;
  inferenceProvider: string | null;
  inferenceModel: string | null;
  inferenceCompletedAt: string | null;
  costUsd: number | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface NewCompactJob {
  sessionId: string;
  checkpointGeneration: number;
  agentSummary: string;
  preserveMd: string | null;
  threadThemesHints: string[];
  sourceStartMessageId: number | null;
  sourceEndMessageId: number;
}

export interface CompactJobRow {
  id: number;
  session_id: string;
  checkpoint_generation: number;
  status: string;
  agent_summary: string;
  preserve_md: string | null;
  thread_themes_hints: string[] | null;
  source_start_message_id: number | null;
  source_end_message_id: number;
  attempt_count: number;
  max_attempts: number;
  next_attempt_at: string;
  locked_at: string | null;
  locked_by: string | null;
  heartbeat_at: string | null;
  last_error: string | null;
  chunks_inserted: number;
  chunks_rejected_by_exclusion: number;
  chunks_rejected_by_redaction: number;
  inference_provider: string | null;
  inference_model: string | null;
  inference_completed_at: string | null;
  cost_usd: string | null; // pg numeric → string in driver
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export function mapRow(r: CompactJobRow): CompactJob {
  return {
    id: r.id,
    sessionId: r.session_id,
    checkpointGeneration: r.checkpoint_generation,
    status: r.status as CompactJobStatus,
    agentSummary: r.agent_summary,
    preserveMd: r.preserve_md,
    threadThemesHints: r.thread_themes_hints ?? [],
    sourceStartMessageId: r.source_start_message_id,
    sourceEndMessageId: r.source_end_message_id,
    attemptCount: r.attempt_count,
    maxAttempts: r.max_attempts,
    nextAttemptAt: r.next_attempt_at,
    lockedAt: r.locked_at,
    lockedBy: r.locked_by,
    heartbeatAt: r.heartbeat_at,
    lastError: r.last_error,
    chunksInserted: r.chunks_inserted,
    chunksRejectedByExclusion: r.chunks_rejected_by_exclusion,
    chunksRejectedByRedaction: r.chunks_rejected_by_redaction,
    inferenceProvider: r.inference_provider,
    inferenceModel: r.inference_model,
    inferenceCompletedAt: r.inference_completed_at,
    costUsd: r.cost_usd === null ? null : Number.parseFloat(r.cost_usd),
    createdAt: r.created_at,
    startedAt: r.started_at,
    completedAt: r.completed_at,
  };
}

export const JOB_COLUMNS = `
  id, session_id, checkpoint_generation, status,
  agent_summary, preserve_md, thread_themes_hints,
  source_start_message_id, source_end_message_id,
  attempt_count, max_attempts, next_attempt_at,
  locked_at, locked_by, heartbeat_at, last_error,
  chunks_inserted, chunks_rejected_by_exclusion, chunks_rejected_by_redaction,
  inference_provider, inference_model, inference_completed_at, cost_usd,
  created_at, started_at, completed_at
`;
