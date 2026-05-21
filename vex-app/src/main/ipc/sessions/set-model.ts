/**
 * `vex.sessions.setModel` — fail-closed until puzzle 06.
 *
 * The `sessions.model_id` column does not exist in the local Postgres
 * schema yet; puzzle 06 introduces the migration + engine session
 * context loader. Until then we return `sessions.feature_unavailable`
 * with a clear "lands in puzzle 06" message so the renderer model
 * picker can render the chip and disable the save button.
 */

import { CH } from "@shared/ipc/channels.js";
import { err, type Result } from "@shared/ipc/result.js";
import {
  sessionSetModelInputSchema,
  sessionSetModelResultSchema,
  type SessionSetModelResult,
} from "@shared/schemas/sessions.js";
import { log } from "../../logger/index.js";
import { featureUnavailable } from "../_feature-unavailable.js";
import { registerHandler } from "../register-handler.js";

export function registerSessionsSetModelHandler(): () => void {
  return registerHandler({
    channel: CH.sessions.setModel,
    domain: "sessions",
    inputSchema: sessionSetModelInputSchema,
    outputSchema: sessionSetModelResultSchema,
    handle: async (input, ctx): Promise<Result<SessionSetModelResult>> => {
      log.info(
        `[ipc:vex:sessions:setModel] fail-closed feature_unavailable ` +
          `sessionId=${input.sessionId} correlationId=${ctx.requestId}`,
      );
      return err(
        featureUnavailable({
          domain: "sessions",
          correlationId: ctx.requestId,
          message:
            "Per-session model lands in puzzle 06 (sessions.model_id migration + engine context loader).",
        }),
      );
    },
  });
}
