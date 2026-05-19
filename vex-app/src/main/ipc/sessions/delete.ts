/**
 * vex.sessions.delete — soft delete with main-enforced fail-closed guards.
 *
 * The renderer asks; main decides. The DB helper's atomic guarded UPDATE
 * fails closed when a mission_run is active/paused or an approval is
 * pending, returning a discriminated outcome instead of flipping
 * `deleted_at`. The renderer hook switches on the outcome:
 *
 *   - `removed | not_found | already_removed` → terminal hidden; clean
 *     detail cache, invalidate list, clear activeSessionId if matching.
 *   - `blocked_active_mission | blocked_pending_approval | state_changed`
 *     → dialog stays open with actionable copy so the user can resolve
 *     the blocker and retry (no cache mutation).
 */

import { CH } from "@shared/ipc/channels.js";
import type { Result } from "@shared/ipc/result.js";
import {
  sessionDeleteInputSchema,
  sessionDeleteResultSchema,
  type SessionDeleteResult,
} from "@shared/schemas/sessions.js";
import { softDeleteSession } from "../../database/sessions-db.js";
import { log } from "../../logger/index.js";
import { registerHandler } from "../register-handler.js";

export function registerSessionsDeleteHandler(): () => void {
  return registerHandler({
    channel: CH.sessions.delete,
    domain: "internal",
    inputSchema: sessionDeleteInputSchema,
    outputSchema: sessionDeleteResultSchema,
    handle: async (input, ctx): Promise<Result<SessionDeleteResult>> => {
      const outcome = await softDeleteSession(input.id);
      if (outcome.ok) {
        log.info(
          `[ipc:vex:sessions:delete] ok outcome=${outcome.data.outcome} ` +
            `correlationId=${ctx.requestId}`,
        );
      } else {
        log.info(
          `[ipc:vex:sessions:delete] errCode=${outcome.error.code} ` +
            `correlationId=${ctx.requestId}`,
        );
      }
      return outcome;
    },
  });
}
