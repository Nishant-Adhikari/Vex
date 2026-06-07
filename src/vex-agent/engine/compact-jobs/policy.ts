/**
 * Compact-jobs worker policy — Track 2 chunking worker constants
 * (heartbeat / stale recovery / retry / per-call timeout).
 *
 * No DB, no embeddings, no I/O. Tested as plain unit tests.
 */

// ── Outbox worker ───────────────────────────────────────────────

/** Worker heartbeat interval (must be < stale threshold). */
export const WORKER_HEARTBEAT_INTERVAL_MS = 20_000;

/** Stale threshold for `running` jobs whose heartbeat has not been updated. */
export const WORKER_STALE_THRESHOLD_MS = 2 * 60_000;

/** Max attempts before a job is marked `permanently_failed`. */
export const WORKER_MAX_ATTEMPTS = 3;

/** Per-LLM-call timeout for Track 2 chunking. */
export const TRACK2_TIMEOUT_MS = 30_000;

/** Initial retry backoff (multiplied by attempt_count for exponential schedule). */
export const TRACK2_RETRY_BACKOFF_BASE_MS = 30_000;
