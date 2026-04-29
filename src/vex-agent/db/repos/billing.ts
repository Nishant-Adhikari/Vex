/**
 * Billing repo — provider balance snapshots over time.
 */

import { query, queryOne, execute } from "../client.js";

export interface BillingSnapshot {
  providerBalance: number;
  providerAvailable: number;
  providerLocked: number;
  sessionCost: number;
  provider: string;
  currency: string;
  fetchedAt: string;
}

export async function insertSnapshot(snapshot: {
  provider: string;
  balance: number;
  available: number;
  locked?: number;
  sessionCost?: number;
  currency?: string;
}): Promise<void> {
  await execute(
    `INSERT INTO billing_snapshots (provider, provider_balance, provider_available, provider_locked, session_cost, currency)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [snapshot.provider, snapshot.balance, snapshot.available,
     snapshot.locked ?? 0, snapshot.sessionCost ?? 0, snapshot.currency ?? "USD"],
  );
}

export async function getLatest(provider?: string): Promise<BillingSnapshot | null> {
  const sql = provider
    ? "SELECT * FROM billing_snapshots WHERE provider = $1 ORDER BY fetched_at DESC LIMIT 1"
    : "SELECT * FROM billing_snapshots ORDER BY fetched_at DESC LIMIT 1";
  const row = await queryOne<Record<string, unknown>>(sql, provider ? [provider] : []);
  return row ? mapRow(row) : null;
}

export async function getHistory(provider?: string, hours = 24): Promise<BillingSnapshot[]> {
  const sql = provider
    ? `SELECT * FROM billing_snapshots WHERE provider = $1 AND fetched_at > NOW() - INTERVAL '${hours} hours' ORDER BY fetched_at ASC`
    : `SELECT * FROM billing_snapshots WHERE fetched_at > NOW() - INTERVAL '${hours} hours' ORDER BY fetched_at ASC`;
  const rows = await query<Record<string, unknown>>(sql, provider ? [provider] : []);
  return rows.map(mapRow);
}

function mapRow(r: Record<string, unknown>): BillingSnapshot {
  return {
    providerBalance: Number(r.provider_balance),
    providerAvailable: Number(r.provider_available),
    providerLocked: Number(r.provider_locked),
    sessionCost: Number(r.session_cost),
    provider: r.provider as string,
    currency: (r.currency as string) ?? "USD",
    fetchedAt: r.fetched_at as string,
  };
}
