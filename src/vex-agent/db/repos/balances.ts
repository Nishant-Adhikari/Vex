/**
 * Balances repo — proj_balances + proj_portfolio_snapshots.
 *
 * proj_balances: current token balances per wallet+chain+token (upsert/replace).
 * proj_portfolio_snapshots: time-series of portfolio value with per-chain breakdown.
 */

import { query, queryOne, execute, getPool } from "../client.js";
import { jsonb } from "../params.js";

// ── Types ───────────────────────────────────────────────────────

export interface BalanceRow {
  walletFamily: string;
  walletAddress: string;
  chainId: number;
  tokenAddress: string;
  tokenSymbol: string | null;
  tokenName: string | null;
  balanceRaw: string;
  balanceUsd: number | null;
  priceUsd: number | null;
  decimals: number | null;
}

export interface ChainSummary {
  chainId: number;
  totalUsd: number;
  tokenCount: number;
}

export interface PortfolioSnapshot {
  id: number;
  walletFamily: string;
  walletAddress: string;
  snapshotGroupId: string;
  totalUsd: number;
  positions: Record<string, unknown>;
  activeChains: string[];
  pnlVsPrev: number | null;
  pnlPctVsPrev: number | null;
  source: string;
  createdAt: string;
}

/** Atomic wallet identity for per-wallet snapshot reads. */
export interface SnapshotWalletFilter {
  walletFamily: string;
  walletAddress: string;
}

export interface InsertSnapshotArgs {
  walletFamily: string;
  walletAddress: string;
  /** Shared across every wallet row written in one fullBalanceSync cycle. */
  snapshotGroupId: string;
  totalUsd: number;
  positions: Record<string, unknown>;
  activeChains: string[];
  source?: string;
}

// ── Balance CRUD ────────────────────────────────────────────────

/** Upsert a single balance row. */
export async function upsertBalance(row: BalanceRow): Promise<void> {
  await execute(
    `INSERT INTO proj_balances (wallet_family, wallet_address, chain_id, token_address, token_symbol, token_name, balance_raw, balance_usd, price_usd, decimals, synced_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
     ON CONFLICT (wallet_address, chain_id, token_address)
     DO UPDATE SET wallet_family = $1, token_symbol = $5, token_name = $6, balance_raw = $7, balance_usd = $8, price_usd = $9, decimals = $10, synced_at = NOW()`,
    [row.walletFamily, row.walletAddress, row.chainId, row.tokenAddress,
     row.tokenSymbol, row.tokenName, row.balanceRaw, row.balanceUsd, row.priceUsd, row.decimals],
  );
}

/**
 * Transactional full-replace for (walletAddress, chainId).
 * Deletes all existing rows for this wallet+chain, then inserts new ones.
 * Tokens absent from Khalani response are removed — no "ghost" balances.
 */
export async function replaceBalancesForChain(
  walletAddress: string,
  chainId: number,
  newRows: BalanceRow[],
): Promise<number> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Delete all existing for this wallet+chain
    await client.query(
      "DELETE FROM proj_balances WHERE wallet_address = $1 AND chain_id = $2",
      [walletAddress, chainId],
    );

    // Insert new rows
    for (const row of newRows) {
      await client.query(
        `INSERT INTO proj_balances (wallet_family, wallet_address, chain_id, token_address, token_symbol, token_name, balance_raw, balance_usd, price_usd, decimals, synced_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())`,
        [row.walletFamily, row.walletAddress, row.chainId, row.tokenAddress,
         row.tokenSymbol, row.tokenName, row.balanceRaw, row.balanceUsd, row.priceUsd, row.decimals],
      );
    }

    await client.query("COMMIT");
    return newRows.length;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** Get all balances for a wallet, optionally filtered by chain. */
export async function getBalances(walletAddress: string, chainId?: number): Promise<BalanceRow[]> {
  const sql = chainId !== undefined
    ? "SELECT * FROM proj_balances WHERE wallet_address = $1 AND chain_id = $2 ORDER BY balance_usd DESC NULLS LAST"
    : "SELECT * FROM proj_balances WHERE wallet_address = $1 ORDER BY balance_usd DESC NULLS LAST";
  const params = chainId !== undefined ? [walletAddress, chainId] : [walletAddress];
  const rows = await query<Record<string, unknown>>(sql, params);
  return rows.map(mapBalanceRow);
}

/** Per-chain aggregation for UI. */
export async function getBalancesByChain(walletAddress: string): Promise<ChainSummary[]> {
  const rows = await query<{ chain_id: string | number; total_usd: string; token_count: string }>(
    `SELECT chain_id, COALESCE(SUM(balance_usd), 0) AS total_usd, COUNT(*) AS token_count
     FROM proj_balances WHERE wallet_address = $1
     GROUP BY chain_id ORDER BY total_usd DESC`,
    [walletAddress],
  );
  return rows.map(r => ({
    chainId: Number(r.chain_id),
    totalUsd: parseFloat(r.total_usd),
    tokenCount: parseInt(r.token_count, 10),
  }));
}

/**
 * Total USD value. Without `walletAddress` it sums ALL wallets (global /
 * legacy callers); with it, only that wallet's balances. Session-scoped reads
 * pass the selected wallet (puzzle 5 phase 5E-2).
 */
export async function getTotalUsd(walletAddress?: string): Promise<number> {
  const row = walletAddress !== undefined
    ? await queryOne<{ total: string }>(
        "SELECT COALESCE(SUM(balance_usd), 0) AS total FROM proj_balances WHERE wallet_address = $1",
        [walletAddress],
      )
    : await queryOne<{ total: string }>(
        "SELECT COALESCE(SUM(balance_usd), 0) AS total FROM proj_balances",
      );
  return parseFloat(row?.total ?? "0");
}

// ── Portfolio Snapshots ─────────────────────────────────────────

/**
 * Insert a PER-WALLET portfolio snapshot. PnL is computed against the previous
 * snapshot for the SAME (walletFamily, walletAddress); the first row for a
 * wallet has null PnL. All wallet rows from one fullBalanceSync cycle share
 * `snapshotGroupId` so an aggregate view can stitch a cycle back together
 * (puzzle 5 phase 5E-1).
 */
export interface InsertSnapshotResult {
  snapshotId: number;
  pnlVsPrev: number | null;
}

export async function insertSnapshot(args: InsertSnapshotArgs): Promise<InsertSnapshotResult> {
  const prev = await getLatestSnapshot({
    walletFamily: args.walletFamily,
    walletAddress: args.walletAddress,
  });
  let pnlVsPrev: number | null = null;
  let pnlPctVsPrev: number | null = null;
  if (prev && prev.totalUsd > 0) {
    pnlVsPrev = args.totalUsd - prev.totalUsd;
    pnlPctVsPrev = (pnlVsPrev / prev.totalUsd) * 100;
  }

  const row = await queryOne<{ id: number }>(
    `INSERT INTO proj_portfolio_snapshots
       (wallet_family, wallet_address, snapshot_group_id, total_usd, positions, active_chains, pnl_vs_prev, pnl_pct_vs_prev, source)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9) RETURNING id`,
    [args.walletFamily, args.walletAddress, args.snapshotGroupId, args.totalUsd,
     jsonb(args.positions), args.activeChains, pnlVsPrev, pnlPctVsPrev, args.source ?? "sync"],
  );
  return { snapshotId: row?.id ?? 0, pnlVsPrev };
}

/**
 * Latest snapshot. With `filter` (atomic family+address) returns the latest for
 * that wallet; without it, the latest row across all wallets (legacy/global).
 */
export async function getLatestSnapshot(
  filter?: SnapshotWalletFilter,
): Promise<PortfolioSnapshot | null> {
  const row = filter !== undefined
    ? await queryOne<Record<string, unknown>>(
        "SELECT * FROM proj_portfolio_snapshots WHERE wallet_family = $1 AND wallet_address = $2 ORDER BY created_at DESC LIMIT 1",
        [filter.walletFamily, filter.walletAddress],
      )
    : await queryOne<Record<string, unknown>>(
        "SELECT * FROM proj_portfolio_snapshots ORDER BY created_at DESC LIMIT 1",
      );
  return row ? mapSnapshotRow(row) : null;
}

/** Snapshot history for chart, optionally scoped to one wallet. */
export async function getSnapshotHistory(
  range: "24h" | "7d" | "30d" | "all" = "24h",
  filter?: SnapshotWalletFilter,
): Promise<PortfolioSnapshot[]> {
  const intervals: Record<string, string> = { "24h": "24 hours", "7d": "7 days", "30d": "30 days", "all": "100 years" };
  const rows = filter !== undefined
    ? await query<Record<string, unknown>>(
        `SELECT * FROM proj_portfolio_snapshots
         WHERE created_at > NOW() - INTERVAL '${intervals[range]}' AND wallet_family = $1 AND wallet_address = $2
         ORDER BY created_at ASC`,
        [filter.walletFamily, filter.walletAddress],
      )
    : await query<Record<string, unknown>>(
        `SELECT * FROM proj_portfolio_snapshots WHERE created_at > NOW() - INTERVAL '${intervals[range]}' ORDER BY created_at ASC`,
      );
  return rows.map(mapSnapshotRow);
}

// ── Mappers ─────────────────────────────────────────────────────

function mapBalanceRow(r: Record<string, unknown>): BalanceRow {
  return {
    walletFamily: r.wallet_family as string,
    walletAddress: r.wallet_address as string,
    chainId: Number(r.chain_id),
    tokenAddress: r.token_address as string,
    tokenSymbol: r.token_symbol as string | null,
    tokenName: r.token_name as string | null,
    balanceRaw: r.balance_raw as string,
    balanceUsd: r.balance_usd != null ? Number(r.balance_usd) : null,
    priceUsd: r.price_usd != null ? Number(r.price_usd) : null,
    decimals: r.decimals as number | null,
  };
}

function mapSnapshotRow(r: Record<string, unknown>): PortfolioSnapshot {
  return {
    id: r.id as number,
    walletFamily: r.wallet_family as string,
    walletAddress: r.wallet_address as string,
    snapshotGroupId: r.snapshot_group_id as string,
    totalUsd: Number(r.total_usd),
    positions: r.positions as Record<string, unknown>,
    activeChains: r.active_chains as string[],
    pnlVsPrev: r.pnl_vs_prev != null ? Number(r.pnl_vs_prev) : null,
    pnlPctVsPrev: r.pnl_pct_vs_prev != null ? Number(r.pnl_pct_vs_prev) : null,
    source: r.source as string,
    createdAt: r.created_at as string,
  };
}
