/**
 * `listMessages` — cursor-paginated page for a session (older-above
 * scroll). Re-parses the cursor before composing SQL: a malformed cursor
 * resolves to "treat as no cursor" rather than poisoning the query.
 */

import { ok, type Result, type VexError } from "@shared/ipc/result.js";
import {
  MESSAGES_TAIL_DEFAULT_LIMIT,
  messageCursorSchema,
  type MessageCursor,
  type MessagePage,
} from "@shared/schemas/messages.js";
import { withClient, dbError } from "./connection.js";
import {
  MESSAGE_ROW_COLUMNS,
  type MessageRow,
  nextCursorFor,
  toDto,
} from "./mappers.js";

export async function listMessages(
  sessionId: string,
  cursor: MessageCursor | null,
  limit: number = MESSAGES_TAIL_DEFAULT_LIMIT,
): Promise<Result<MessagePage, VexError>> {
  // Defense-in-depth: even though shared schema validated this already,
  // re-parse the cursor before composing SQL. A malformed cursor must
  // resolve to "treat as no cursor" rather than poisoning the query.
  let safeCursor: MessageCursor | null = null;
  if (cursor !== null) {
    const parsed = messageCursorSchema.safeParse(cursor);
    safeCursor = parsed.success ? parsed.data : null;
  }
  return withClient(async (client) => {
    try {
      const result = safeCursor === null
        ? await client.query<MessageRow>(
            `SELECT ${MESSAGE_ROW_COLUMNS}
               FROM messages
              WHERE session_id = $1
              ORDER BY created_at DESC, id DESC
              LIMIT $2`,
            [sessionId, limit + 1],
          )
        : await client.query<MessageRow>(
            `SELECT ${MESSAGE_ROW_COLUMNS}
               FROM messages
              WHERE session_id = $1
                AND (created_at, id) < ($2::timestamptz, $3::integer)
              ORDER BY created_at DESC, id DESC
              LIMIT $4`,
            [sessionId, safeCursor.createdAt, safeCursor.id, limit + 1],
          );
      const rows = result.rows.map(toDto);
      const overflow = rows.length > limit;
      const trimmed = overflow ? rows.slice(0, limit) : rows;
      const items = trimmed.slice().reverse();
      const nextCursor = overflow ? nextCursorFor(trimmed) : null;
      return ok({
        items,
        nextCursor,
        hasMore: overflow,
      });
    } catch (cause) {
      return dbError("listMessages query failed", cause);
    }
  });
}
