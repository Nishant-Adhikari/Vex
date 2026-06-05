/**
 * First-mission-chat goal snapshot.
 *
 * Persist the first mission chat message as the session-level initial goal
 * and seed the current draft's `goal` if it is still empty.
 */

import { ok, type Result, type VexError } from "@shared/ipc/result.js";
import { VEX_APP_SESSION_SCOPE } from "@shared/schemas/sessions.js";
import { log } from "../../logger/index.js";
import { dbError, withClient } from "./connection.js";

/**
 * Persist the first mission chat message as the session-level initial goal
 * snapshot and seed the current draft's `goal` if it is still empty.
 *
 * This is deliberately separate from `createSession`: the modal captures only
 * immutable axes, while chat owns the mission intent text. The guarded UPDATE
 * makes repeat submits/races idempotent — only the first non-empty goal wins.
 */
export async function setInitialMissionGoalIfUnset(
  id: string,
  goal: string,
): Promise<Result<boolean, VexError>> {
  return withClient(async (client) => {
    try {
      await client.query("BEGIN");
      const sessionUpdate = await client.query<{ id: string }>(
        `UPDATE sessions
            SET initial_goal = $3
          WHERE id = $1
            AND scope = $2
            AND mode = 'mission'
            AND deleted_at IS NULL
            AND (initial_goal IS NULL OR btrim(initial_goal) = '')
          RETURNING id`,
        [id, VEX_APP_SESSION_SCOPE, goal],
      );

      const changed = (sessionUpdate.rowCount ?? 0) > 0;
      if (changed) {
        await client.query(
          `UPDATE missions
              SET goal = $2, updated_at = NOW()
            WHERE id = (
              SELECT id
                FROM missions
               WHERE root_session_id = $1
                 AND status NOT IN ('completed', 'failed', 'cancelled')
               ORDER BY created_at DESC
               LIMIT 1
            )
              AND (goal IS NULL OR btrim(goal) = '')`,
          [id, goal],
        );
      }

      await client.query("COMMIT");
      return ok(changed);
    } catch (cause) {
      try {
        await client.query("ROLLBACK");
      } catch (rbCause) {
        log.warn("[sessions-db] ROLLBACK after setInitialMissionGoalIfUnset failure failed", rbCause);
      }
      return dbError("setInitialMissionGoalIfUnset failed", cause);
    }
  });
}
