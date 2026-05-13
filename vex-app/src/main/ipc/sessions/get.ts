/**
 * vex.sessions.get — Phase 2 multi-session shell (M12).
 *
 * Returns a single session by id, or null if not found. Mission-mode
 * rows are enriched with active mission-run status (same as `.list`).
 *
 * Used when the renderer opens a session from the sidebar — TanStack
 * Query's per-id cache key keeps this independent from the list cache.
 */

import { CH } from "@shared/ipc/channels.js";
import type { Result } from "@shared/ipc/result.js";
import {
  sessionGetInputSchema,
  sessionListItemSchema,
  type SessionListItem,
} from "@shared/schemas/sessions.js";
import { getSessionById } from "../../database/sessions-db.js";
import { log } from "../../logger/index.js";
import { registerHandler } from "../register-handler.js";

const outputSchema = sessionListItemSchema.nullable();

export function registerSessionsGetHandler(): () => void {
  return registerHandler({
    channel: CH.sessions.get,
    domain: "internal",
    inputSchema: sessionGetInputSchema,
    outputSchema,
    handle: async (input, ctx): Promise<Result<SessionListItem | null>> => {
      const outcome = await getSessionById(input.id);
      if (outcome.ok) {
        log.info(
          `[ipc:vex:sessions:get] ok hit=${outcome.data !== null} ` +
            `correlationId=${ctx.requestId}`,
        );
      } else {
        log.info(
          `[ipc:vex:sessions:get] errCode=${outcome.error.code} ` +
            `correlationId=${ctx.requestId}`,
        );
      }
      return outcome;
    },
  });
}

