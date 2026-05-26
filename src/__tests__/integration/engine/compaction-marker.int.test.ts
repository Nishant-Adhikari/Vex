/**
 * Integration: the Track-1 post-compact bookkeeping writes a display-only
 * `compaction_committed` transcript marker (stage 8-4).
 *
 * Proofs requiring a live DB + the engine event bus:
 *   - after `applyPostCompactBookkeeping`, exactly one `compaction_committed`
 *     row exists for the session (role 'system');
 *   - a `TranscriptAppendEvent` with that `messageType` is emitted on the
 *     singleton bus (the spine the vex-app main-process bridge subscribes to);
 *   - the marker is NOT pushed into the caller's in-memory `liveMessages`, so
 *     it never enters the current turn's model context.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { applyPostCompactBookkeeping } from "@vex-agent/engine/core/turn-loop-post-compact.js";
import {
  transcriptEventBus,
  type TranscriptAppendEvent,
} from "@vex-agent/engine/events/transcript-bus.js";
import type { Message } from "@vex-agent/db/repos/messages.js";
import { query } from "@vex-agent/db/client.js";
import { makeSession, resetDb } from "../setup/fixtures.js";

describe("compaction marker (integration, 8-4)", () => {
  let unsubscribe: (() => void) | null = null;

  beforeEach(async () => {
    await resetDb();
  });

  afterEach(() => {
    if (unsubscribe) unsubscribe();
    unsubscribe = null;
  });

  it("writes a compaction_committed marker + emits the event, without polluting liveMessages", async () => {
    const sessionId = await makeSession();
    const events: TranscriptAppendEvent[] = [];
    unsubscribe = transcriptEventBus.subscribe((e) => events.push(e));

    const liveMessages: Message[] = [];
    await applyPostCompactBookkeeping({
      sessionId,
      missionRunId: null,
      liveMessages,
      lastSeenOperatorMessageId: 0,
    });

    const rows = await query<{ role: string; content: string }>(
      `SELECT role, content FROM messages
        WHERE session_id = $1 AND message_type = 'compaction_committed'`,
      [sessionId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.role).toBe("system");
    expect(rows[0]!.content).toContain("compacted");

    const markerEvents = events.filter(
      (e) =>
        e.sessionId === sessionId && e.messageType === "compaction_committed",
    );
    expect(markerEvents).toHaveLength(1);

    // Display-only: the marker must not enter the loop's in-memory context.
    expect(liveMessages).toHaveLength(0);
  });
});
