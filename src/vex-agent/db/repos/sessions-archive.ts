/**
 * Session message archiving helpers.
 *
 * Kept separate from `sessions.ts` so the lifecycle repo stays focused while
 * preserving the public `sessionsRepo.archivePrefix/archiveSuffix` surface via
 * re-exports.
 */

import type { PoolClient } from "pg";
import { getPool } from "../client.js";

/**
 * Partial archive — move messages with `id <= cutoffMessageId` into
 * `messages_archive` and set the live `message_count` to `remainingCount`.
 *
 * Column parity between `messages` and `messages_archive` is required by
 * migration 002; this helper relies on that invariant.
 */
export async function archivePrefix(
  sessionId: string,
  cutoffMessageId: number,
  remainingCount: number,
  client?: PoolClient,
): Promise<void> {
  if (client) {
    await runArchivePrefixStatements(client, sessionId, cutoffMessageId, remainingCount);
    return;
  }
  const own = await getPool().connect();
  try {
    await own.query("BEGIN");
    await runArchivePrefixStatements(own, sessionId, cutoffMessageId, remainingCount);
    await own.query("COMMIT");
  } catch (err) {
    await own.query("ROLLBACK").catch(() => {
      // ROLLBACK failures are non-actionable; the original error is what matters.
    });
    throw err;
  } finally {
    own.release();
  }
}

async function runArchivePrefixStatements(
  tx: PoolClient,
  sessionId: string,
  cutoffMessageId: number,
  remainingCount: number,
): Promise<void> {
  await tx.query(
    `WITH moved AS (
       DELETE FROM messages
       WHERE session_id = $1 AND id <= $2
       RETURNING *
     )
     INSERT INTO messages_archive SELECT * FROM moved
     ON CONFLICT (id) DO NOTHING`,
    [sessionId, cutoffMessageId],
  );
  await tx.query(
    "UPDATE sessions SET message_count = $2 WHERE id = $1",
    [sessionId, remainingCount],
  );
}

/**
 * Archive a suffix of messages — move every row with `id >= cutoffMessageId`
 * into `messages_archive` and recompute `sessions.message_count` from the
 * post-archive live row count.
 */
export async function archiveSuffix(
  sessionId: string,
  cutoffMessageId: number,
  client?: PoolClient,
): Promise<{ archivedCount: number; remainingCount: number }> {
  if (client) {
    return runArchiveSuffixStatements(client, sessionId, cutoffMessageId);
  }
  const own = await getPool().connect();
  try {
    await own.query("BEGIN");
    const outcome = await runArchiveSuffixStatements(own, sessionId, cutoffMessageId);
    await own.query("COMMIT");
    return outcome;
  } catch (err) {
    await own.query("ROLLBACK").catch(() => {
      // ROLLBACK failures are non-actionable; the original error is what matters.
    });
    throw err;
  } finally {
    own.release();
  }
}

async function runArchiveSuffixStatements(
  tx: PoolClient,
  sessionId: string,
  cutoffMessageId: number,
): Promise<{ archivedCount: number; remainingCount: number }> {
  const result = await tx.query<{
    archived_count: string | number;
    remaining_count: string | number;
  }>(
    `WITH moved AS (
       DELETE FROM messages
       WHERE session_id = $1 AND id >= $2
       RETURNING *
     ),
     inserted AS (
       INSERT INTO messages_archive SELECT * FROM moved
       ON CONFLICT (id) DO NOTHING
       RETURNING id
     ),
     remaining AS (
       SELECT COUNT(*)::text AS count FROM messages WHERE session_id = $1
     )
     UPDATE sessions SET message_count = (SELECT count::integer FROM remaining)
     WHERE id = $1
     RETURNING
       (SELECT COUNT(*)::text FROM moved) AS archived_count,
       (SELECT COUNT(*)::text FROM inserted) AS inserted_count,
       (SELECT count FROM remaining) AS remaining_count`,
    [sessionId, cutoffMessageId],
  );
  const row = result.rows[0];
  return {
    archivedCount: Number(row?.archived_count ?? 0),
    remainingCount: Number(row?.remaining_count ?? 0),
  };
}

/**
 * Giant-tool fallback — copy one live message into the archive and replace the
 * live row's content with a short placeholder.
 */
export async function forkToolMessageToArchive(
  messageId: number,
  placeholderContent: string,
  client?: PoolClient,
): Promise<void> {
  if (client) {
    await runForkToolStatements(client, messageId, placeholderContent);
    return;
  }
  const own = await getPool().connect();
  try {
    await own.query("BEGIN");
    await runForkToolStatements(own, messageId, placeholderContent);
    await own.query("COMMIT");
  } catch (err) {
    await own.query("ROLLBACK").catch(() => {
      // ROLLBACK failures are non-actionable; the original error is what matters.
    });
    throw err;
  } finally {
    own.release();
  }
}

async function runForkToolStatements(
  tx: PoolClient,
  messageId: number,
  placeholderContent: string,
): Promise<void> {
  await tx.query(
    `INSERT INTO messages_archive SELECT * FROM messages WHERE id = $1
     ON CONFLICT (id) DO NOTHING`,
    [messageId],
  );
  await tx.query(
    "UPDATE messages SET content = $2 WHERE id = $1",
    [messageId, placeholderContent],
  );
}
