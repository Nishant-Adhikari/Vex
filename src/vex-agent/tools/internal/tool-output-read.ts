/**
 * `tool_output_read` handler — retrieves an overflowed tool payload.
 *
 * Contract:
 *   - Session-scoped: rejects `blob_key` whose `session_id` differs from
 *     `ctx.sessionId`. Subagents cannot read the parent's blobs (or vice
 *     versa) even if a blob key leaks across the boundary.
 *   - Returns the full payload for the LLM to reason about. `primary_path`
 *     / `field_hints` from the producer's write come back verbatim.
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
import logger from "@utils/logger.js";

const ToolOutputReadArgs = z.object({
  blob_key: z
    .string({ error: "blob_key is required" })
    .min(1, { message: "blob_key is required (non-empty)" })
    .regex(/^tob-\d{8}-[0-9a-f]{16}$/, {
      message: "blob_key must match the format `tob-<yyyymmdd>-<16hex>`",
    }),
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

  return {
    success: true,
    output: blob.payload.fullOutput,
    data: {
      blob_key: blob.blobKey,
      shape_kind: blob.payload.shapeKind,
      size_bytes: blob.payload.sizeBytes,
      primary_path: blob.payload.primaryPath ?? null,
      field_hints: blob.payload.fieldHints ?? [],
      expires_at: blob.expiresAt,
    },
  };
}
