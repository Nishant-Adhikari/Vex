/**
 * Session message archiving helpers.
 *
 * Kept separate from `sessions.ts` so the lifecycle repo stays focused
 * while preserving the public `sessionsRepo.archivePrefix /
 * archiveSuffix / forkToolMessageToArchive` surface via re-exports.
 *
 * Explicit column projection (puzzle 04 phase 5)
 * ----------------------------------------------
 * Migration 023 added `messages_archive.rewind_checkpoint_id`. The
 * column lives ONLY on the archive table — `messages` doesn't have
 * it. That breaks the previous `INSERT INTO messages_archive SELECT *
 * FROM messages` shortcut: the source row count would no longer match
 * the target's column count. The fix is the same in all three
 * writers below:
 *
 *   - SELECT projection from `messages` uses `MESSAGE_DB_COLUMNS`
 *     (13 columns)
 *   - INSERT target uses `MESSAGE_ARCHIVE_DB_COLUMNS` (14 columns)
 *   - `rewind_checkpoint_id` is supplied by the SELECT:
 *       * `archiveSuffix` (called only by rewind) accepts a
 *         `rewindCheckpointId` arg and stamps it on every archived
 *         row, so `/restore` can later look up exactly those rows.
 *       * `archivePrefix` (compaction) and `forkToolMessageToArchive`
 *         (giant-tool overflow) always pass NULL — those rows are
 *         not restorable.
 *
 * The constants live in `messages.ts` so adding a column to the
 * messages schema forces a deliberate update there, and any forgotten
 * archive path fails typecheck.
 */

import type { PoolClient } from "pg";
import { getPool } from "../client.js";
import { MESSAGE_DB_COLUMNS } from "./messages.js";

const MESSAGE_COLS = MESSAGE_DB_COLUMNS.join(", ");

/**
 * Partial archive — move messages with `id <= cutoffMessageId` into
 * `messages_archive` and set the live `message_count` to
 * `remainingCount`.
 *
 * Compaction-only path — every archived row gets `rewind_checkpoint_id
 * = NULL`, so `/restore`'s `WHERE rewind_checkpoint_id = $1` lookup
 * cannot resurrect compaction-archived rows.
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
  // Symmetric session-row lock — `archiveSuffix` and
  // `restoreLatestCheckpoint` take the same lock, so all three
  // message-set mutators serialize on the same row.
  await tx.query(
    `SELECT id FROM sessions WHERE id = $1 FOR UPDATE`,
    [sessionId],
  );
  await tx.query(
    `WITH moved AS (
       DELETE FROM messages
       WHERE session_id = $1 AND id <= $2
       RETURNING ${MESSAGE_COLS}
     )
     INSERT INTO messages_archive (${MESSAGE_COLS}, rewind_checkpoint_id)
       SELECT ${MESSAGE_COLS}, NULL FROM moved
       ON CONFLICT (id) DO NOTHING`,
    [sessionId, cutoffMessageId],
  );
  await tx.query(
    "UPDATE sessions SET message_count = $2 WHERE id = $1",
    [sessionId, remainingCount],
  );
}

/**
 * Archive a suffix of messages — move every row with `id >=
 * cutoffMessageId` into `messages_archive` and recompute
 * `sessions.message_count` from the post-archive live row count.
 *
 * Called only by `engine/core/rewind.ts`. `rewindCheckpointId` is
 * required when the caller wants `/restore` to be able to unarchive
 * the moved rows later. Passing `null` keeps the old "archive but
 * not restorable" behaviour (useful in tests or recovery paths that
 * intentionally don't write a checkpoint).
 */
export async function archiveSuffix(
  sessionId: string,
  cutoffMessageId: number,
  rewindCheckpointId: string | null,
  client?: PoolClient,
): Promise<{ archivedCount: number; remainingCount: number }> {
  if (client) {
    return runArchiveSuffixStatements(client, sessionId, cutoffMessageId, rewindCheckpointId);
  }
  const own = await getPool().connect();
  try {
    await own.query("BEGIN");
    const outcome = await runArchiveSuffixStatements(
      own,
      sessionId,
      cutoffMessageId,
      rewindCheckpointId,
    );
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
  rewindCheckpointId: string | null,
): Promise<{ archivedCount: number; remainingCount: number }> {
  // Symmetric session-row lock — `archivePrefix` and
  // `restoreLatestCheckpoint` take the same lock, so all three
  // message-set mutators serialize on the same row.
  await tx.query(
    `SELECT id FROM sessions WHERE id = $1 FOR UPDATE`,
    [sessionId],
  );
  // The `ON CONFLICT (id)` branch upgrades an existing archive row's
  // `rewind_checkpoint_id` from NULL → the current rewind id when
  // possible. Without that, a prior `forkToolMessageToArchive` would
  // leave the row stamped NULL forever and `/restore` would silently
  // drop it (the live row got DELETED by the CTE above). The WHERE
  // clause prevents stomping an already-stamped row from a different
  // (defensive — should not happen, since archived rows aren't
  // movable back to live without `/restore`).
  const result = await tx.query<{
    archived_count: string | number;
    inserted_count: string | number;
    remaining_count: string | number;
  }>(
    `WITH moved AS (
       DELETE FROM messages
       WHERE session_id = $1 AND id >= $2
       RETURNING ${MESSAGE_COLS}
     ),
     inserted AS (
       INSERT INTO messages_archive (${MESSAGE_COLS}, rewind_checkpoint_id)
         SELECT ${MESSAGE_COLS}, $3 FROM moved
       ON CONFLICT (id) DO UPDATE
         SET rewind_checkpoint_id = EXCLUDED.rewind_checkpoint_id
         WHERE messages_archive.rewind_checkpoint_id IS NULL
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
    [sessionId, cutoffMessageId, rewindCheckpointId],
  );
  const row = result.rows[0];
  const archivedCount = Number(row?.archived_count ?? 0);
  const insertedCount = Number(row?.inserted_count ?? 0);
  // Restorability invariant: when the caller supplied a checkpoint
  // id, EVERY moved row must end up with that stamp on its archive
  // entry. A mismatch means a conflicting row had a NON-NULL stamp
  // we refused to overwrite — the live row is now gone and `/restore`
  // cannot find it under the new checkpoint id. Fail loudly inside
  // the tx so the caller rolls back instead of shipping a partial
  // archive.
  if (rewindCheckpointId !== null && insertedCount !== archivedCount) {
    throw new Error(
      `archiveSuffix: ${archivedCount - insertedCount} archived row(s) already carried a different rewind_checkpoint_id; refusing partial stamp for checkpoint ${rewindCheckpointId}`,
    );
  }
  return {
    archivedCount,
    remainingCount: Number(row?.remaining_count ?? 0),
  };
}

/**
 * Giant-tool fallback — copy one live message into the archive and
 * replace the live row's content with a short placeholder. Never
 * restorable via `/restore` (`rewind_checkpoint_id = NULL`).
 *
 * Takes `sessionId` so the internal helper can lock the sessions
 * row first (symmetric with `archivePrefix` / `archiveSuffix` /
 * `restoreLatestCheckpoint`). Caller (`compact-jobs/service.ts`)
 * already has the session id in scope.
 */
export async function forkToolMessageToArchive(
  sessionId: string,
  messageId: number,
  placeholderContent: string,
  client?: PoolClient,
): Promise<void> {
  if (client) {
    await runForkToolStatements(client, sessionId, messageId, placeholderContent);
    return;
  }
  const own = await getPool().connect();
  try {
    await own.query("BEGIN");
    await runForkToolStatements(own, sessionId, messageId, placeholderContent);
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
  sessionId: string,
  messageId: number,
  placeholderContent: string,
): Promise<void> {
  // Symmetric session-row lock — same invariant as `archivePrefix`
  // and `archiveSuffix`.
  await tx.query(
    `SELECT id FROM sessions WHERE id = $1 FOR UPDATE`,
    [sessionId],
  );
  // Both subsequent statements constrain by `session_id` AS WELL AS
  // `id` so a wrong `sessionId` arg cannot lock one session row while
  // mutating a message owned by another. Caller bugs surface as a
  // no-op rather than cross-session writes.
  await tx.query(
    `INSERT INTO messages_archive (${MESSAGE_COLS}, rewind_checkpoint_id)
       SELECT ${MESSAGE_COLS}, NULL FROM messages
       WHERE id = $1 AND session_id = $2
     ON CONFLICT (id) DO NOTHING`,
    [messageId, sessionId],
  );
  await tx.query(
    "UPDATE messages SET content = $3 WHERE id = $1 AND session_id = $2",
    [messageId, sessionId, placeholderContent],
  );
}
