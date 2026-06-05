/**
 * Race-safe soft delete for the GUI sidebar.
 */

import type { Client } from "pg";
import { ok, type Result, type VexError } from "@shared/ipc/result.js";
import {
  VEX_APP_SESSION_SCOPE,
  type SessionDeleteResult,
} from "@shared/schemas/sessions.js";
import { dbError, withClient } from "./connection.js";
import { ACTIVE_OR_PAUSED_MISSION_RUN_STATUSES } from "./mappers.js";

/**
 * Race-safe soft delete for the GUI sidebar. The "remove" semantics:
 *
 *   - Atomic guarded UPDATE flips `deleted_at` only when no active mission
 *     run and no pending approval reference the session. PG evaluates both
 *     NOT EXISTS clauses inside the same statement, so the success path
 *     cannot lose a race to a freshly-started mission run.
 *   - When the UPDATE returns 0 rows, classification queries figure out
 *     why and surface a discriminated `SessionDeleteOutcome` so the
 *     renderer can show actionable copy.
 *
 * Hard delete is intentionally NOT implemented — `mission_runs`, `missions`,
 * `approval_queue`, `usage_log`, and `loop_wake_requests` all reference
 * `sessions(id)` without `ON DELETE CASCADE`, so a hard DELETE would
 * either error on FK constraints or require coordinated cleanup that
 * races with in-flight engine cycles.
 *
 * The function is split into `*WithClient` + thin wrapper so the
 * outcome-classification branching can be unit-tested with a fake
 * `pg.Client` (see `__tests__/sessions-db.test.ts`).
 */
export async function softDeleteSessionWithClient(
  client: Client,
  id: string,
): Promise<Result<SessionDeleteResult, VexError>> {
  try {
    // 1. Atomic guarded UPDATE — single statement; PG evaluates the
    //    NOT EXISTS clauses against the same snapshot as the UPDATE.
    const updateResult = await client.query<{ id: string }>(
      `UPDATE sessions
          SET deleted_at = NOW()
        WHERE id = $1
          AND scope = $2
          AND deleted_at IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM mission_runs
             WHERE session_id = $1
               AND status = ANY($3::text[])
          )
          AND NOT EXISTS (
            SELECT 1 FROM approval_queue
             WHERE session_id = $1 AND status = 'pending'
          )
        RETURNING id`,
      [id, VEX_APP_SESSION_SCOPE, ACTIVE_OR_PAUSED_MISSION_RUN_STATUSES],
    );
    if ((updateResult.rowCount ?? 0) > 0) return ok({ outcome: "removed" });

    // 2. Classification — explicit per branch, no default tail.
    const rowResult = await client.query<{ deleted_at: Date | null }>(
      "SELECT deleted_at FROM sessions WHERE id = $1 AND scope = $2",
      [id, VEX_APP_SESSION_SCOPE],
    );
    if (rowResult.rows.length === 0) return ok({ outcome: "not_found" });
    if (rowResult.rows[0].deleted_at !== null) {
      return ok({ outcome: "already_removed" });
    }

    const activeMission = await client.query(
      `SELECT 1 FROM mission_runs
         WHERE session_id = $1
           AND status = ANY($2::text[])
         LIMIT 1`,
      [id, ACTIVE_OR_PAUSED_MISSION_RUN_STATUSES],
    );
    if (activeMission.rows.length > 0) {
      return ok({ outcome: "blocked_active_mission" });
    }

    const pendingApproval = await client.query(
      "SELECT 1 FROM approval_queue WHERE session_id = $1 AND status = 'pending' LIMIT 1",
      [id],
    );
    if (pendingApproval.rows.length > 0) {
      return ok({ outcome: "blocked_pending_approval" });
    }

    // Atomic UPDATE saw a blocker that disappeared by classification time
    // (engine completed a mission_run / approval got resolved). Neutral
    // retry: re-clicking Remove will succeed on the next atomic UPDATE.
    return ok({ outcome: "state_changed" });
  } catch (cause) {
    return dbError("softDeleteSession failed", cause);
  }
}

export async function softDeleteSession(
  id: string,
): Promise<Result<SessionDeleteResult, VexError>> {
  return withClient((client) => softDeleteSessionWithClient(client, id));
}
