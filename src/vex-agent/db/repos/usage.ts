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
  reasoningTokens?: number;
  provider?: string;
  model?: string;
  currency?: string;
}

export async function logUsage(sessionId: string, entry: UsageEntry): Promise<void> {
  const totalTokens = entry.promptTokens + entry.completionTokens;
  await execute(
    `INSERT INTO usage_log (session_id, prompt_tokens, completion_tokens, total_tokens, cached_tokens, reasoning_tokens, cost, provider, model, currency)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [sessionId, entry.promptTokens, entry.completionTokens, totalTokens,
     entry.cachedTokens ?? 0, entry.reasoningTokens ?? 0, entry.cost,
     entry.provider ?? null, entry.model ?? null, entry.currency ?? "USD"],
  );
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
