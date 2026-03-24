/**
 * Global per-session mutex — serializes concurrent operations on the same session.
 *
 * Used by ALL entry points: GUI chat handler, Telegram bridge, approval resume,
 * Echo Loop, and subagent execution. Prevents race conditions when multiple
 * sources try to use the same session simultaneously.
 *
 * Promoted from telegram/session-lock.ts to be shared across the entire agent.
 */

const sessionLocks = new Map<string, Promise<void>>();

/** Serialize concurrent operations on the same session. */
export async function withSessionLock(sessionId: string, fn: () => Promise<void>): Promise<void> {
  const prev = sessionLocks.get(sessionId) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  sessionLocks.set(sessionId, next);
  try {
    await next;
  } finally {
    if (sessionLocks.get(sessionId) === next) {
      sessionLocks.delete(sessionId);
    }
  }
}
