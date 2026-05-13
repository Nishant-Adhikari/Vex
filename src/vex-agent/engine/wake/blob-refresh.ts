/**
 * Blob TTL refresh — bumps the expiry on every tool_output blob referenced
 * by the last N live messages of a session. Called from resume paths (wake
 * executor, ingress preempt, mission resume) so a long
 * wait doesn't let blobs expire before the model can read them back.
 *
 * Scan is bounded (`RECENT_WINDOW`) so a very long session doesn't pay the
 * cost of re-reading every message. 50 is comfortably above the typical
 * turn-loop tail window (10-15 live messages after a checkpoint).
 */

import * as messagesRepo from "@vex-agent/db/repos/messages.js";
import * as toolOutputBlobsRepo from "@vex-agent/db/repos/tool-output-blobs.js";
import { TOOL_OUTPUT_TTL_MIN } from "@vex-agent/knowledge/policy.js";
import logger from "@utils/logger.js";

const RECENT_WINDOW = 50;

/**
 * Refresh blob TTLs for every overflow row in the last `RECENT_WINDOW`
 * live messages. Non-fatal on failure — the calling resume path proceeds
 * and `tool_output_read` will just report a clean expiry error if a blob
 * slipped past the refresh.
 */
export async function refreshBlobTtlForRecentMessages(
  sessionId: string,
): Promise<number> {
  try {
    const live = await messagesRepo.getLiveMessages(sessionId);
    const tail = live.slice(Math.max(0, live.length - RECENT_WINDOW));
    const blobKeys: string[] = [];
    for (const m of tail) {
      const payload = m.metadata?.payload as Record<string, unknown> | undefined;
      if (!payload || payload.overflow !== true) continue;
      const blobKey = typeof payload.blobKey === "string" ? payload.blobKey : null;
      if (blobKey) blobKeys.push(blobKey);
    }
    if (blobKeys.length === 0) return 0;
    const refreshed = await toolOutputBlobsRepo.refreshTtl(
      blobKeys,
      TOOL_OUTPUT_TTL_MIN * 60_000,
    );
    logger.info("wake.blob_refresh.applied", {
      sessionId,
      scanned: tail.length,
      refreshed,
      candidates: blobKeys.length,
    });
    return refreshed;
  } catch (err) {
    logger.warn("wake.blob_refresh.failed", {
      sessionId,
      error: err instanceof Error ? err.message : String(err),
    });
    return 0;
  }
}
