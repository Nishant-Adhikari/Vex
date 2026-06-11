/**
 * `tool_output_read` handler — retrieves an overflowed tool payload.
 *
 * Contract:
 *   - Session-scoped: rejects `blob_key` whose `session_id` differs from
 *     `ctx.sessionId`. Subagents cannot read the parent's blobs (or vice
 *     versa) even if a blob key leaks across the boundary.
 *   - Returns a bounded byte slice, not the full payload. This prevents the
 *     turn-loop overflow layer from externalising the read result into a new
 *     blob and creating a blob-read recursion.
 *   - `primary_path` / `field_hints` from the producer's write come back
 *     verbatim.
 *   - Expired or missing blobs return a clean error — the stub in the
 *     transcript tells the agent when it was written, so the model can
 *     decide whether to retry the underlying tool.
 *   - Lazy cleanup — the handler fires a best-effort `cleanupExpired()`
 *     so the table doesn't grow unbounded even without a background job.
 */

import { z } from "zod";

import type { ToolResult } from "../types.js";
import type { InternalToolContext } from "./types.js";
import { fail } from "./types.js";
import * as toolOutputBlobsRepo from "@vex-agent/db/repos/tool-output-blobs.js";
import { TOOL_OUTPUT_OVERFLOW_BYTES } from "@vex-agent/engine/core/tool-output-policy.js";
import logger from "@utils/logger.js";

const DEFAULT_READ_BYTES = 8 * 1024;
const MAX_READ_BYTES = TOOL_OUTPUT_OVERFLOW_BYTES - 4 * 1024;

const ToolOutputReadArgs = z.object({
  blob_key: z
    .string({ error: "blob_key is required" })
    .min(1, { message: "blob_key is required (non-empty)" })
    .regex(/^tob-\d{8}-[0-9a-f]{16}$/, {
      message: "blob_key must match the format `tob-<yyyymmdd>-<16hex>`",
    }),
  offset: z
    .number()
    .int({ message: "offset must be an integer byte offset" })
    .min(0, { message: "offset must be >= 0" })
    .optional(),
  max_bytes: z
    .number()
    .int({ message: "max_bytes must be an integer byte count" })
    .min(1, { message: "max_bytes must be >= 1" })
    .optional(),
});

export async function handleToolOutputRead(
  params: Record<string, unknown>,
  context: InternalToolContext,
): Promise<ToolResult> {
  const parsed = ToolOutputReadArgs.safeParse(params);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    return fail(`tool_output_read: ${firstIssue?.message ?? "invalid arguments"}`);
  }
  const { blob_key } = parsed.data;
  const offset = parsed.data.offset ?? 0;
  const requestedBytes = parsed.data.max_bytes ?? DEFAULT_READ_BYTES;
  const maxBytes = Math.min(requestedBytes, MAX_READ_BYTES);

  const blob = await toolOutputBlobsRepo.readBlob(blob_key);
  if (!blob) {
    // Fire-and-forget cleanup so repeated reads of expired keys also
    // compact the table.
    toolOutputBlobsRepo.cleanupExpired().catch((err) => {
      logger.warn("tool_output_read.cleanup_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    });
    return fail(
      `tool_output_read: blob ${blob_key} not found or expired. If the wait was long, the TTL may have elapsed; retry the underlying tool.`,
    );
  }

  // Session scope — hard guard regardless of which session created the row.
  if (blob.sessionId !== context.sessionId) {
    logger.warn("tool_output_read.cross_session_denied", {
      requesterSessionId: context.sessionId,
      blobSessionId: blob.sessionId,
      blobKey: blob_key,
    });
    return fail(
      `tool_output_read: blob ${blob_key} is not readable from this session.`,
    );
  }

  const fullBuffer = Buffer.from(blob.payload.fullOutput, "utf8");
  const totalBytes = fullBuffer.byteLength;
  if (offset > totalBytes) {
    return fail(
      `tool_output_read: offset ${offset} is beyond payload size ${totalBytes}.`,
    );
  }

  const endOffset = Math.min(offset + maxBytes, totalBytes);
  const content = fullBuffer.subarray(offset, endOffset).toString("utf8");
  const bytesReturned = endOffset - offset;
  const nextOffset = endOffset < totalBytes ? endOffset : null;
  const truncated = nextOffset !== null;
  const continuation = truncated
    ? ` Continue with tool_output_read(blob_key="${blob.blobKey}", offset=${nextOffset}).`
    : "";
  const output =
    `[tool_output_read blob_key=${blob.blobKey} offset=${offset} ` +
    `bytes_returned=${bytesReturned} total_bytes=${totalBytes} ` +
    `shape=${blob.payload.shapeKind} truncated=${truncated} ` +
    `next_offset=${nextOffset ?? "null"}].${continuation}\n` +
    content;

  return {
    success: true,
    output,
    data: {
      blob_key: blob.blobKey,
      shape_kind: blob.payload.shapeKind,
      size_bytes: blob.payload.sizeBytes,
      offset,
      bytes_returned: bytesReturned,
      next_offset: nextOffset,
      truncated,
      primary_path: blob.payload.primaryPath ?? null,
      field_hints: blob.payload.fieldHints ?? [],
      expires_at: blob.expiresAt,
    },
  };
}
