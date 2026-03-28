/**
 * Session links repo — canonical parent-child session relationships.
 *
 * Replaces parent_session_id on sessions/subagents.
 * Covers: subagent, scheduler, loop, handoff relationships.
 */

import { query, queryOne, execute } from "../client.js";

export interface SessionLink {
  id: number;
  parentSessionId: string;
  childSessionId: string;
  relationType: string;
  subagentId: string | null;
  createdAt: string;
  endedAt: string | null;
}

function mapRow(r: Record<string, unknown>): SessionLink {
  return {
    id: r.id as number,
    parentSessionId: r.parent_session_id as string,
    childSessionId: r.child_session_id as string,
    relationType: r.relation_type as string,
    subagentId: r.subagent_id as string | null,
    createdAt: r.created_at as string,
    endedAt: r.ended_at as string | null,
  };
}

export async function linkSessions(
  parentSessionId: string,
  childSessionId: string,
  relationType: string,
  subagentId?: string,
): Promise<SessionLink> {
  const row = await queryOne<Record<string, unknown>>(
    `INSERT INTO session_links (parent_session_id, child_session_id, relation_type, subagent_id)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [parentSessionId, childSessionId, relationType, subagentId ?? null],
  );
  return mapRow(row!);
}

export async function getChildSessions(parentSessionId: string, relationType?: string): Promise<SessionLink[]> {
  const rows = relationType
    ? await query<Record<string, unknown>>(
        "SELECT * FROM session_links WHERE parent_session_id = $1 AND relation_type = $2 AND ended_at IS NULL ORDER BY created_at",
        [parentSessionId, relationType],
      )
    : await query<Record<string, unknown>>(
        "SELECT * FROM session_links WHERE parent_session_id = $1 AND ended_at IS NULL ORDER BY created_at",
        [parentSessionId],
      );
  return rows.map(mapRow);
}

export async function getParentSession(childSessionId: string): Promise<SessionLink | null> {
  const row = await queryOne<Record<string, unknown>>(
    "SELECT * FROM session_links WHERE child_session_id = $1 AND ended_at IS NULL ORDER BY created_at DESC LIMIT 1",
    [childSessionId],
  );
  return row ? mapRow(row) : null;
}

export async function getSubagentSession(subagentId: string): Promise<SessionLink | null> {
  const row = await queryOne<Record<string, unknown>>(
    "SELECT * FROM session_links WHERE subagent_id = $1 AND ended_at IS NULL LIMIT 1",
    [subagentId],
  );
  return row ? mapRow(row) : null;
}

export async function endLink(id: number): Promise<boolean> {
  const rowCount = await execute(
    "UPDATE session_links SET ended_at = NOW() WHERE id = $1 AND ended_at IS NULL",
    [id],
  );
  return rowCount === 1;
}
