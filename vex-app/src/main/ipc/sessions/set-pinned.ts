/**
 * vex.sessions.setPinned — Phase 1 of vex-agent ↔ vex-app integration.
 *
 * Pins or unpins a session. Idempotent on both sides:
 *   - re-pinning preserves the existing `pinned_at` (so the sidebar order
 *     does not shuffle on double-clicks);
 *   - re-unpinning is a no-op;
 *   - acting on an unknown id returns `ok(null)` rather than an error,
 *     because a stale renderer cache is not a fault worth surfacing.
 *
 * The returned row carries `missionStatus`, so the renderer can safely
 * `setQueryData(detail, row)` after the mutation without wiping an
 * active mission status.
 */

import { CH } from "@shared/ipc/channels.js";
import type { Result } from "@shared/ipc/result.js";
import {
  sessionSetPinnedInputSchema,
  sessionSetPinnedResultSchema,
  type SessionSetPinnedResult,
} from "@shared/schemas/sessions.js";
import { setSessionPinned } from "../../database/sessions-db.js";
import { log } from "../../logger/index.js";
import { registerHandler } from "../register-handler.js";

export function registerSessionsSetPinnedHandler(): () => void {
  return registerHandler({
    channel: CH.sessions.setPinned,
    domain: "internal",
    inputSchema: sessionSetPinnedInputSchema,
    outputSchema: sessionSetPinnedResultSchema,
    handle: async (input, ctx): Promise<Result<SessionSetPinnedResult>> => {
      const outcome = await setSessionPinned(input.id, input.pinned);
      if (outcome.ok) {
        log.info(
          `[ipc:vex:sessions:setPinned] ok hit=${outcome.data !== null} ` +
            `pinned=${input.pinned} correlationId=${ctx.requestId}`,
        );
      } else {
        log.info(
          `[ipc:vex:sessions:setPinned] errCode=${outcome.error.code} ` +
            `correlationId=${ctx.requestId}`,
        );
      }
      return outcome;
    },
  });
}
