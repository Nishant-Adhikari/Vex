/**
 * Giant-tool placeholder — stub left in `messages` table when a single
 * oversized tool result is forked into `messages_archive` via the
 * giant-tool compact mode. References the `compact_job` that owns Track 2
 * chunking (NOT a session episode — episode extraction was removed when
 * PR2 cut over to the per-session memory layer).
 *
 * The placeholder mentions `session_memory_search` as the recovery path because
 * Track 2 will emit a narrative chunk that summarises the archived tool
 * output; the agent can fetch it semantically once Track 2 lands.
 */

export function buildGiantToolPlaceholder(
  bloatedMessageId: number,
  compactJobId: number,
): string {
  return (
    `[oversized tool output — full payload archived at message_id=${bloatedMessageId}, ` +
    `compact_job_id=${compactJobId}. The narrative chunk for this material is ` +
    `produced asynchronously by Track 2; query via session_memory_search once it lands.]`
  );
}
