/**
 * Post-compact bookkeeping — applied after ANY committed compact
 * (agent-driven `compact_committed` engine signal OR runtime-driven
 * forced fallback). Extracted from `turn-loop.ts` for scaling.
 *
 * The helper mutates `liveMessages` (clears + reloads from DB), then
 * returns the new values for every counter / flag the loop tracks.
 * Caller threads the returned values back into its closure state
 * vars. This makes every state mutation explicit at the call site —
 * fixing one in the future fails compile if the helper return type
 * grows a new field.
 *
 * Order matches codex contract:
 *   1. Reload live messages from DB (archive prefix is now committed).
 *   2. Merge any operator-interrupt messages that landed during compact.
 *   3. Update `mission_runs.last_checkpoint_at` (active runs only).
 *   4. Refresh rolling summary from `sessions.summary` (set by compact).
 *   5. Reset `currentTokenCount` to 0 so the NEXT iteration's tool-projection
 *      / pressure-banner / forced-fallback check uses a normal-band view.
 *      Stale token-count would otherwise keep tools restricted and the
 *      banner stuck on the pressure copy until the next provider response.
 *   6. Arm bridge counter; reset critical-band noop counter; arm skip flag.
 */

import type { Message } from "@vex-agent/db/repos/messages.js";
import * as messagesRepo from "@vex-agent/db/repos/messages.js";
import * as sessionsRepo from "@vex-agent/db/repos/sessions.js";
import * as missionRunsRepo from "@vex-agent/db/repos/mission-runs.js";
import { appendEngineMessage } from "../events/append-transcript.js";
import { appendPendingOperatorInstructions } from "./operator-instructions.js";
import { POST_COMPACT_BRIDGE_CYCLES } from "@vex-agent/memory/policy.js";
import logger from "@utils/logger.js";

export interface PostCompactStateUpdates {
  readonly nextLastSeenOperatorMessageId: number;
  readonly nextCurrentSummary: string | null;
  readonly nextCurrentTokenCount: 0;
  readonly nextPostCompactBridgeRemaining: number;
  readonly nextCriticalNoopCounter: 0;
  readonly nextSkipCriticalCheckNextIter: true;
}

export async function applyPostCompactBookkeeping(args: {
  readonly sessionId: string;
  readonly missionRunId: string | null;
  /** MUTATED: cleared and refilled with the freshly-loaded live messages. */
  readonly liveMessages: Message[];
  readonly lastSeenOperatorMessageId: number;
}): Promise<PostCompactStateUpdates> {
  args.liveMessages.length = 0;
  const freshMessages = await messagesRepo.getLiveMessages(args.sessionId);
  args.liveMessages.push(...freshMessages);

  const nextLastSeenOperatorMessageId = await appendPendingOperatorInstructions({
    sessionId: args.sessionId,
    afterId: args.lastSeenOperatorMessageId,
    liveMessages: args.liveMessages,
  });

  if (args.missionRunId) {
    await missionRunsRepo.setLastCheckpoint(args.missionRunId);
  }

  const freshSession = await sessionsRepo.getSession(args.sessionId);

  // Stage 8-4: best-effort, display-only compaction marker. Written AFTER the
  // live-message reload and deliberately NOT pushed into `args.liveMessages`,
  // so it never enters the current turn's model context (it re-enters on the
  // next reload like any tail row, matching existing engine-marker behavior).
  // The compaction already committed before this point, so a marker failure
  // must never break the loop.
  await writeCompactionMarker(
    args.sessionId,
    freshSession?.checkpointGeneration ?? null,
  );

  return {
    nextLastSeenOperatorMessageId,
    nextCurrentSummary: freshSession?.summary ?? null,
    nextCurrentTokenCount: 0,
    nextPostCompactBridgeRemaining: POST_COMPACT_BRIDGE_CYCLES,
    nextCriticalNoopCounter: 0,
    nextSkipCriticalCheckNextIter: true,
  };
}

/**
 * Write the display-only Track-1 compaction marker via the event-emitting
 * append path so the chat transcript shows where a compaction landed and the
 * live `TranscriptAppendEvent` reaches the renderer. `visibility:"internal"`
 * matches sibling engine markers (`continue`, `runtime_yield`).
 *
 * Never throws — a marker hiccup must not break the turn loop.
 */
async function writeCompactionMarker(
  sessionId: string,
  generation: number | null,
): Promise<void> {
  const label =
    generation !== null && generation > 0
      ? `Conversation compacted into memory · checkpoint ${generation}`
      : "Conversation compacted into memory";
  try {
    await appendEngineMessage(sessionId, label, {
      source: "engine",
      messageType: "compaction_committed",
      visibility: "internal",
    });
  } catch (err) {
    logger.warn("compact.marker.write_failed", {
      sessionId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
