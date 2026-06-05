/**
 * Session-memories — one-call stats summary used by `buildMemoryStateBanner`
 * to render the system prompt banner without N+1 queries.
 */

import { queryOne } from "../../client.js";

export interface SessionMemoryStats {
  activeCount: number;
  compactCount: number;
  unresolvedOutstandingCount: number;
  recentThemes: string[];
}

/**
 * One-call summary used by `buildMemoryStateBanner` to render the system
 * prompt banner without N+1 queries.
 *
 * - `activeCount` counts all active rows regardless of outstanding resolution.
 *   Resolved outstanding items do NOT remove the row from the count — the
 *   chunk continues to represent a piece of past narrative.
 * - `compactCount` reads `sessions.checkpoint_generation` directly. A compact
 *   can complete with zero inserted chunks (all rejected by exclusion /
 *   redaction, or Track 2 still in-flight), so deriving compactCount from
 *   MAX(session_memories.checkpoint_generation) would falsely report 0.
 * - `unresolvedOutstandingCount` sums elements where `resolved_at IS NULL`
 *   across all active rows for the session (snake_case JSONB keys per
 *   migration 016).
 * - `recentThemes` lists DISTINCT themes ordered by most recent created_at,
 *   capped by `recentLimit`.
 */
export async function getSessionMemoryStats(
  sessionId: string,
  recentLimit: number,
): Promise<SessionMemoryStats> {
  // Single round-trip CTE — banner is rebuilt every turn.
  const row = await queryOne<{
    active_count: string;
    compact_count: string;
    unresolved_outstanding: string;
    recent_themes: string[] | null;
  }>(
    `WITH active AS (
       SELECT id, theme, created_at, outstanding_items
       FROM session_memories
       WHERE session_id = $1 AND status = 'active'
     ),
     theme_recent AS (
       SELECT theme
       FROM (
         SELECT DISTINCT ON (theme) theme, MAX(created_at) AS last_at
         FROM active
         GROUP BY theme
       ) t
       ORDER BY last_at DESC
       LIMIT $2
     )
     SELECT
       (SELECT COUNT(*)::text FROM active)                                           AS active_count,
       (SELECT COALESCE(checkpoint_generation, 0)::text
          FROM sessions WHERE id = $1)                                               AS compact_count,
       (SELECT COALESCE(SUM(
          (SELECT COUNT(*) FROM jsonb_array_elements(outstanding_items) item
           WHERE item->>'resolved_at' IS NULL)
       ), 0)::text FROM active)                                                      AS unresolved_outstanding,
       (SELECT array_agg(theme) FROM theme_recent)                                   AS recent_themes`,
    [sessionId, recentLimit],
  );

  if (!row) {
    return { activeCount: 0, compactCount: 0, unresolvedOutstandingCount: 0, recentThemes: [] };
  }
  return {
    activeCount: Number.parseInt(row.active_count, 10),
    compactCount: Number.parseInt(row.compact_count, 10),
    unresolvedOutstandingCount: Number.parseInt(row.unresolved_outstanding, 10),
    recentThemes: row.recent_themes ?? [],
  };
}
