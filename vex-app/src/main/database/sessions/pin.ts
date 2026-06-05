/**
 * Pin / unpin a session.
 */

import type { Client } from "pg";
import { ok, type Result, type VexError } from "@shared/ipc/result.js";
import {
  VEX_APP_SESSION_SCOPE,
  type MissionRunStatus,
  type SessionListItem,
} from "@shared/schemas/sessions.js";
import { dbError, withClient } from "./connection.js";
import {
  loadMissionStatus,
  normaliseMode,
  SESSION_ROW_COLUMNS,
  type SessionRow,
  toListItem,
} from "./mappers.js";

/**
 * Pin or unpin a session. Idempotent semantics on both sides:
 *   - re-pinning a pinned row keeps the existing `pinned_at` (via
 *     `COALESCE`) so the sidebar's "most recently pinned first" order
 *     does NOT shuffle on accidental double-clicks.
 *   - re-unpinning an already-unpinned row is a no-op.
 *
 * Returns the updated `SessionListItem` (enriched with `missionStatus`)
 * or `null` when the id is unknown — caller had a stale view, treating
 * it as an error would be hostile.
 */
export async function setSessionPinnedWithClient(
  client: Client,
  id: string,
  pinned: boolean,
): Promise<Result<SessionListItem | null, VexError>> {
  try {
    // `AND deleted_at IS NULL` keeps soft-deleted sessions unreachable from
    // the pin path — a stale star click or hostile renderer call can no
    // longer resurrect a row that delete already classified as terminal
    // hidden. Unknown id and soft-deleted id both collapse to `ok(null)`.
    const updateResult = await client.query<SessionRow>(
      `UPDATE sessions
          SET pinned_at = CASE
                WHEN $2::boolean THEN COALESCE(pinned_at, NOW())
                ELSE NULL
              END
        WHERE id = $1 AND scope = $3 AND deleted_at IS NULL
        RETURNING ${SESSION_ROW_COLUMNS}`,
      [id, pinned, VEX_APP_SESSION_SCOPE],
    );
    const row = updateResult.rows[0];
    if (!row) return ok(null);
    const missionStatus: MissionRunStatus | null =
      normaliseMode(row.mode) === "mission"
        ? await loadMissionStatus(client, id)
        : null;
    return ok(toListItem(row, missionStatus));
  } catch (cause) {
    return dbError("setSessionPinned failed", cause);
  }
}

export async function setSessionPinned(
  id: string,
  pinned: boolean,
): Promise<Result<SessionListItem | null, VexError>> {
  return withClient((client) => setSessionPinnedWithClient(client, id, pinned));
}
