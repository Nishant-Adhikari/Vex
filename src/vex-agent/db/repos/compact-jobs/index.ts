/**
 * Compact-jobs repo — public re-exports.
 */

export type {
  CompactJobStatus,
  CompactJob,
  NewCompactJob,
  CompactJobRow,
} from "./types.js";

export { COMPACT_JOB_STATUSES, mapRow, JOB_COLUMNS } from "./types.js";

export {
  enqueueJob,
  claimNextDueJob,
  heartbeat,
  markCompleted,
  markFailed,
  recoverStaleRunning,
  getById,
  getBySessionAndGeneration,
  listPendingForSession,
  type CompletionAudit,
} from "./crud.js";
