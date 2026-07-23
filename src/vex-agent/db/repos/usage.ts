/**
 * Usage repo — inference cost tracking with cache/reasoning token breakdown.
 */

import { queryOne, execute } from "../client.js";

export interface UsageStats {
  sessionTokens: number;
  sessionCost: number;
  sessionRequestCount: number;
  sessionLastRequestAt: string | null;
  lifetimeTokens: number;
  lifetimeCost: number;
  requestCount: number;
  lastRequestAt: string | null;
}

export interface UsageEntry {
  promptTokens: number;
  completionTokens: number;
  cost: number;
  cachedTokens?: number;
  /**
   * NET cache savings for this request (read savings − write surcharge) from
   * `computeRequestCost`. Can be NEGATIVE (write-heavy explicit-cache
   * request) — persisted truthfully. Default 0.
   */
  cachedSavings?: number;
  /** Cache-write tokens (explicit-cache models only; absent ⇒ 0). */
  cacheWriteTokens?: number;
  reasoningTokens?: number;
  provider?: string;
  model?: string;
  currency?: string;
}

export async function logUsage(sessionId: string, entry: UsageEntry): Promise<void> {
  const totalTokens = entry.promptTokens + entry.completionTokens;
  await execute(
    `INSERT INTO usage_log (session_id, prompt_tokens, completion_tokens, total_tokens, cached_tokens, reasoning_tokens, cost, provider, model, currency, cached_savings, cache_write_tokens)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [sessionId, entry.promptTokens, entry.completionTokens, totalTokens,
     entry.cachedTokens ?? 0, entry.reasoningTokens ?? 0, entry.cost,
     entry.provider ?? null, entry.model ?? null, entry.currency ?? "USD",
     entry.cachedSavings ?? 0, entry.cacheWriteTokens ?? 0],
  );
}

/**
 * Cumulative prompt+completion tokens logged for a session subtree (SUM of
 * `total_tokens`), across every turn and currency. This is the same accumulator
 * `logUsage` feeds after each LLM turn; the hard token-budget guard reads it at
 * the top of each mission iteration to decide whether to auto-abort.
 *
 * SUBTREE (fix C): the sum spans the session AND every session linked below it
 * via `session_links` (recursively), so a subagent's child-session spend counts
 * against the run's budget instead of being invisible. The walk is deliberately
 * NOT filtered by `session_links.ended_at` — a completed subagent's tokens must
 * keep counting (the ceiling is cumulative), so removing an ended link would
 * make total spend drop, breaking monotonicity.
 *
 * `since` (fix B — run-scoping): when provided, only usage rows with
 * `created_at >= since` are summed. The turn loop passes the run's immutable
 * `started_at` so the budget counts only tokens the RUN itself spent, not the
 * setup/recovery tokens already logged to the same root session before it. Omit
 * (or pass null) for the all-time total (the setup phase, whose baseline is the
 * session's own start). `0` when the subtree has no matching usage rows yet.
 */
export async function getSessionTotalTokens(
  sessionId: string,
  opts?: { since?: string | null },
): Promise<number> {
  const since = opts?.since ?? null;
  const cutoffClause = since ? " WHERE u.created_at >= $2" : "";
  const params: unknown[] = since ? [sessionId, since] : [sessionId];
  const row = await queryOne<{ tokens: string }>(
    `WITH RECURSIVE session_tree(session_id) AS (
       SELECT $1::text
       UNION
       SELECT sl.child_session_id
         FROM session_links sl
         JOIN session_tree st ON sl.parent_session_id = st.session_id
     )
     SELECT COALESCE(SUM(u.total_tokens),0) AS tokens
       FROM usage_log u
       JOIN session_tree st ON u.session_id = st.session_id${cutoffClause}`,
    params,
  );
  return parseInt(row?.tokens ?? "0", 10);
}

export async function getStats(sessionId?: string, currency?: string): Promise<UsageStats> {
  const currencyClause = currency ? " WHERE currency = $1" : "";
  const currencyParams = currency ? [currency] : [];

  const lifetime = await queryOne<{ tokens: string; cost: string; count: string; last: string | null }>(
    `SELECT COALESCE(SUM(total_tokens),0) AS tokens, COALESCE(SUM(cost),0) AS cost, COUNT(*) AS count, MAX(created_at) AS last FROM usage_log${currencyClause}`,
    currencyParams,
  );

  let sessionTokens = 0;
  let sessionCost = 0;
  let sessionRequestCount = 0;
  let sessionLastRequestAt: string | null = null;
  if (sessionId) {
    const sessionClause = currency ? " AND currency = $2" : "";
    const sessionParams = currency ? [sessionId, currency] : [sessionId];
    const session = await queryOne<{ tokens: string; cost: string; count: string; last: string | null }>(
      `SELECT COALESCE(SUM(total_tokens),0) AS tokens, COALESCE(SUM(cost),0) AS cost, COUNT(*) AS count, MAX(created_at) AS last FROM usage_log WHERE session_id = $1${sessionClause}`,
      sessionParams,
    );
    sessionTokens = parseInt(session?.tokens ?? "0", 10);
    sessionCost = parseFloat(session?.cost ?? "0");
    sessionRequestCount = parseInt(session?.count ?? "0", 10);
    sessionLastRequestAt = session?.last ?? null;
  }

  return {
    sessionTokens,
    sessionCost,
    sessionRequestCount,
    sessionLastRequestAt,
    lifetimeTokens: parseInt(lifetime?.tokens ?? "0", 10),
    lifetimeCost: parseFloat(lifetime?.cost ?? "0"),
    requestCount: parseInt(lifetime?.count ?? "0", 10),
    lastRequestAt: lifetime?.last ?? null,
  };
}
