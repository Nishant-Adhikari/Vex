/**
 * vex.sessions.list — Phase 2 multi-session shell (M12).
 *
 * Returns the sidebar's session list, most-recent first. Each row is
 * enriched with the active `mission_runs.status` for mission-mode
 * sessions so badges can render without a per-row roundtrip.
 *
 * Input is empty by Zod design — `.list` is unparameterised in M12; the
 * `100`-row LIMIT lives in the DB helper. Pagination arrives if/when
 * the user accumulates more than that.
 */

import { z } from "zod";
import { CH } from "@shared/ipc/channels.js";
import type { Result } from "@shared/ipc/result.js";
import {
  sessionListSchema,
  type SessionList,
} from "@shared/schemas/sessions.js";
import { listSessions } from "../../database/sessions-db.js";
import { log } from "../../logger/index.js";
import { registerHandler } from "../register-handler.js";

const inputSchema = z.object({}).strict();

export function registerSessionsListHandler(): () => void {
  return registerHandler({
    channel: CH.sessions.list,
    domain: "internal",
    inputSchema,
    outputSchema: sessionListSchema,
    handle: async (_input, ctx): Promise<Result<SessionList>> => {
      const outcome = await listSessions();
      if (outcome.ok) {
        log.info(
          `[ipc:vex:sessions:list] ok count=${outcome.data.length} ` +
            `correlationId=${ctx.requestId}`,
        );
        return { ok: true, data: [...outcome.data] };
      }
      log.info(
        `[ipc:vex:sessions:list] errCode=${outcome.error.code} ` +
          `correlationId=${ctx.requestId}`,
      );
      return outcome;
    },
  });
}
