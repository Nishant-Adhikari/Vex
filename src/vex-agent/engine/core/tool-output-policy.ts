/**
 * Tool output overflow policy — pure TS constants, engine-owned.
 *
 * Generic tool-output externalisation knobs (PR-11). Not memory-specific:
 * every tool result that exceeds the overflow cap is stored in
 * `tool_output_blobs` regardless of which tool produced it.
 */

/**
 * Tool outputs larger than this are externalised into `tool_output_blobs`;
 * a short stub goes into the transcript with `metadata.payload.blob_key`
 * pointing at the full payload. 16 KiB is deliberately larger than the
 * post-hoc checkpoint `GIANT_TOOL_THRESHOLD` (8 KB) — overflow fires inline
 * on every turn, so the cap can be looser than the compaction heuristic.
 */
export const TOOL_OUTPUT_OVERFLOW_BYTES = 16 * 1024;

/**
 * TTL for tool output blobs (minutes). 15 minutes keeps resume paths able
 * to refresh TTLs in one unified window; shorter would risk losing the
 * blob before the wake fires, longer would bloat the table.
 */
export const TOOL_OUTPUT_TTL_MIN = 15;
