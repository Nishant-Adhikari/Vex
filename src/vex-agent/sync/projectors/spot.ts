/**
 * Spot lot projection — FIFO buy/sell lot matching with transactional sell.
 */

import * as pnlLotsRepo from "@vex-agent/db/repos/pnl-lots.js";
import type { Activity } from "@vex-agent/db/repos/activity.js";
import logger from "@utils/logger.js";

// ── Spot lot ledger ───────────────────────────────────────────────

export async function projectSpotLot(activity: Activity): Promise<void> {
  const { instrumentKey, walletAddress, tradeSide } = activity;
  if (!instrumentKey || !walletAddress) return;

  if (tradeSide === "buy") {
    const quantity = activity.outputAmount ?? "0";
    if (quantity === "0") return; // skip zero-quantity

    await pnlLotsRepo.openLot({
      instrumentKey,
      walletAddress,
      side: "buy",
      quantityRaw: quantity,
      costBasisUsd: activity.inputValueUsd ?? undefined,
      priceUsd: activity.unitPriceUsd ?? undefined,
      costBasisNative: activity.inputValueNative ?? undefined,
      benchmarkAssetKey: activity.benchmarkAssetKey ?? undefined,
      executionId: activity.executionId,
      activityId: activity.id,
      namespace: activity.namespace,
      chain: activity.chain,
    });
    logger.debug("sync.lot.opened", { instrumentKey });

  } else if (tradeSide === "sell") {
    const quantityToSell = BigInt(activity.inputAmount ?? "0");
    if (quantityToSell <= 0n) return;

    await projectSpotSell(activity, instrumentKey, walletAddress, quantityToSell);
    logger.debug("sync.lot.reduced", { instrumentKey, quantitySold: quantityToSell.toString() });
  }
}

// ── Transactional spot sell — FIFO reduce + match ledger ─────────

async function projectSpotSell(
  activity: Activity,
  instrumentKey: string,
  walletAddress: string,
  quantityToSell: bigint,
): Promise<void> {
  const { getPool } = await import("@vex-agent/db/client.js");
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // FOR UPDATE locks lots against concurrent sell races
    const lotResult = await client.query<Record<string, unknown>>(
      `SELECT * FROM proj_pnl_lots
       WHERE instrument_key = $1 AND wallet_address = $2 AND status IN ('open', 'partial')
       ORDER BY opened_at ASC
       FOR UPDATE`,
      [instrumentKey, walletAddress],
    );

    let remaining = quantityToSell;

    for (const lot of lotResult.rows) {
      if (remaining <= 0n) break;
      const lotId = lot.id as number;
      const lotRemaining = BigInt(lot.remaining_quantity_raw as string);
      const toReduce = remaining < lotRemaining ? remaining : lotRemaining;
      const newRemaining = lotRemaining - toReduce;

      // Inline reduce (same transaction)
      if (newRemaining <= 0n) {
        await client.query(
          "UPDATE proj_pnl_lots SET remaining_quantity_raw = '0', status = 'closed', closed_at = NOW() WHERE id = $1",
          [lotId],
        );
      } else {
        await client.query(
          "UPDATE proj_pnl_lots SET remaining_quantity_raw = $2, status = 'partial' WHERE id = $1",
          [lotId, newRemaining.toString()],
        );
      }

      // Inline match insert with SQL-side pro-rata — USD + native (same transaction)
      await client.query(
        `INSERT INTO proj_pnl_matches
           (match_kind, sell_activity_id, lot_id, instrument_key, wallet_address,
            quantity_matched, cost_basis_usd, proceeds_usd, realized_pnl_usd,
            cost_basis_native, proceeds_native, realized_pnl_native, benchmark_asset_key,
            namespace, chain)
         VALUES
           ('matched', $1, $2, $3, $4, $5::text,
            (SELECT cost_basis_usd * $5::numeric / quantity_raw::numeric FROM proj_pnl_lots WHERE id = $2),
            $6::numeric * $5::numeric / $7::numeric,
            ($6::numeric * $5::numeric / $7::numeric) -
              (SELECT cost_basis_usd * $5::numeric / quantity_raw::numeric FROM proj_pnl_lots WHERE id = $2),
            (SELECT cost_basis_native * $5::numeric / quantity_raw::numeric FROM proj_pnl_lots WHERE id = $2),
            $8::numeric * $5::numeric / $7::numeric,
            ($8::numeric * $5::numeric / $7::numeric) -
              (SELECT cost_basis_native * $5::numeric / quantity_raw::numeric FROM proj_pnl_lots WHERE id = $2),
            $9,
            $10, $11)`,
        [
          activity.id, lotId, instrumentKey, walletAddress,
          toReduce.toString(), activity.outputValueUsd, quantityToSell.toString(),
          activity.outputValueNative, activity.benchmarkAssetKey,
          activity.namespace, activity.chain,
        ],
      );

      remaining -= toReduce;
    }

    // Shortfall evidence (same transaction)
    if (remaining > 0n) {
      await client.query(
        `INSERT INTO proj_pnl_matches
           (match_kind, sell_activity_id, lot_id, instrument_key, wallet_address,
            quantity_matched, cost_basis_usd, proceeds_usd, realized_pnl_usd,
            cost_basis_native, proceeds_native, realized_pnl_native, benchmark_asset_key,
            namespace, chain)
         VALUES
           ('shortfall', $1, NULL, $2, $3, $4::text, NULL,
            $5::numeric * $4::numeric / $6::numeric,
            NULL,
            NULL,
            $7::numeric * $4::numeric / $6::numeric,
            NULL,
            $8,
            $9, $10)`,
        [
          activity.id, instrumentKey, walletAddress,
          remaining.toString(), activity.outputValueUsd, quantityToSell.toString(),
          activity.outputValueNative, activity.benchmarkAssetKey,
          activity.namespace, activity.chain,
        ],
      );
      logger.warn("sync.lot.shortfall", {
        instrumentKey,
        quantitySold: quantityToSell.toString(),
        shortfall: remaining.toString(),
      });
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
