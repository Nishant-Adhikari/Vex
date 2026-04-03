/**
 * Position projector — maps activity events to open positions and lot ledger.
 *
 * Called from activity-populator after each proj_activity insert.
 *
 * Rules:
 * - perps/prediction with position_key → proj_open_positions (open/close based on captureStatus)
 * - order (DCA/limit) with position_key → proj_open_positions (open/cancel lifecycle)
 * - lp with position_key → proj_open_positions (zap-in=open, zap-out=close, zap-migrate=close+open)
 * - spot buy → open lot in proj_pnl_lots
 * - spot sell → FIFO reduce lots in proj_pnl_lots
 * - bridge/lend/stake/reward → skip (no position or lot)
 */

import * as openPositionsRepo from "@echo-agent/db/repos/open-positions.js";
import * as pnlLotsRepo from "@echo-agent/db/repos/pnl-lots.js";
import type { Activity } from "@echo-agent/db/repos/activity.js";
import logger from "@utils/logger.js";

const OPEN_STATUSES = new Set(["open", "executed"]);
const CLOSE_STATUSES = new Set(["closed", "cancelled", "claimed"]);

/**
 * Project an activity event into open positions and/or lot ledger.
 */
export async function projectPosition(activity: Activity): Promise<void> {
  const { productType } = activity;

  switch (productType) {
    case "perps":
    case "prediction":
      return projectLifecyclePosition(activity);
    case "order":
      return projectOrderLifecycle(activity);
    case "lp":
      return projectLpLifecycle(activity);
    case "spot":
      return projectSpotLot(activity);
    default:
      // bridge, lend, stake, reward — no position or lot projection
      return;
  }
}

// ── Perps / Prediction position lifecycle ─────────────────────────

async function projectLifecyclePosition(activity: Activity): Promise<void> {
  const { positionKey, productType, walletAddress, instrumentKey, captureStatus } = activity;
  if (!positionKey) return;

  const status = captureStatus ?? "unknown";

  if (OPEN_STATUSES.has(status)) {
    await openPositionsRepo.upsertPosition({
      namespace: activity.namespace,
      positionType: productType,
      chain: activity.chain,
      externalId: positionKey,
      walletAddress: walletAddress ?? "",
      instrumentKey: instrumentKey ?? undefined,
      positionKey,
      entryPriceUsd: activity.unitPriceUsd ?? undefined,
      notionalUsd: activity.inputValueUsd ?? undefined,
      feeUsd: activity.feeValueUsd ?? undefined,
      contracts: typeof (activity.meta as Record<string, unknown>)?.contracts === "string"
        ? (activity.meta as Record<string, unknown>).contracts as string : undefined,
      settlementAssetKey: activity.settlementAssetKey ?? undefined,
      status: "open",
      data: activity.meta,
    });
    logger.debug("sync.position.opened", { positionKey, productType });

  } else if (CLOSE_STATUSES.has(status)) {
    const closeStatus = status === "cancelled" ? "cancelled" : "closed";
    const closed = await openPositionsRepo.closePosition(activity.namespace, productType, positionKey, closeStatus);
    if (closed) {
      logger.debug("sync.position.closed", { positionKey, productType, closeStatus });
    }
  }
}

// ── Order lifecycle (DCA, limit orders) ───────────────────────────

async function projectOrderLifecycle(activity: Activity): Promise<void> {
  const { positionKey, walletAddress, instrumentKey, captureStatus } = activity;
  if (!positionKey) return;

  const status = captureStatus ?? "unknown";

  if (OPEN_STATUSES.has(status)) {
    await openPositionsRepo.upsertPosition({
      namespace: activity.namespace,
      positionType: "order",
      chain: activity.chain,
      externalId: positionKey,
      walletAddress: walletAddress ?? "",
      instrumentKey: instrumentKey ?? undefined,
      positionKey,
      status: "open",
      data: activity.meta,
    });
    logger.debug("sync.order.opened", { positionKey });

  } else if (status === "cancelled") {
    await openPositionsRepo.closePosition(activity.namespace, "order", positionKey, "cancelled");
    logger.debug("sync.order.cancelled", { positionKey });

  } else if (status === "executed" || status === "filled") {
    // Order filled — close the order position
    await openPositionsRepo.closePosition(activity.namespace, "order", positionKey, "filled");
    logger.debug("sync.order.filled", { positionKey });
  }
}

// ── LP lifecycle (zap-in/out/migrate) ─────────────────────────────

async function projectLpLifecycle(activity: Activity): Promise<void> {
  const { positionKey, walletAddress, instrumentKey } = activity;
  if (!positionKey) return;

  const meta = activity.meta as Record<string, unknown>;
  const action = meta?.action as string | undefined;

  if (action === "zap-in") {
    await openPositionsRepo.upsertPosition({
      namespace: activity.namespace,
      positionType: "lp",
      chain: activity.chain,
      externalId: positionKey,
      walletAddress: walletAddress ?? "",
      instrumentKey: instrumentKey ?? undefined,
      positionKey,
      notionalUsd: activity.inputValueUsd ?? undefined,
      status: "open",
      data: activity.meta,
    });
    logger.debug("sync.lp.opened", { positionKey });

  } else if (action === "zap-out") {
    await openPositionsRepo.closePosition(activity.namespace, "lp", positionKey, "closed");
    logger.debug("sync.lp.closed", { positionKey });

  } else if (action === "zap-migrate") {
    // Carry cost basis from old position before closing
    const oldPosition = await openPositionsRepo.getByPositionKey(positionKey);
    const carriedNotionalUsd = oldPosition?.notionalUsd ?? undefined;

    // Close old position
    await openPositionsRepo.closePosition(activity.namespace, "lp", positionKey, "migrated");

    // New position opened with new instrumentKey (from meta.poolTo) + carried cost basis
    const newPool = meta?.poolTo as string | undefined;
    if (newPool && instrumentKey) {
      await openPositionsRepo.upsertPosition({
        namespace: activity.namespace,
        positionType: "lp",
        chain: activity.chain,
        externalId: positionKey,
        walletAddress: walletAddress ?? "",
        instrumentKey,
        positionKey,
        notionalUsd: carriedNotionalUsd,
        status: "open",
        data: activity.meta,
      });
      logger.debug("sync.lp.migrated", { positionKey, newPool, carriedNotionalUsd });
    }
  }

  // Record LP economics event + legs (if zapDetails available in meta)
  await recordLpEconomics(activity, action ?? "unknown");
}

async function recordLpEconomics(activity: Activity, action: string): Promise<void> {
  const meta = activity.meta as Record<string, unknown>;
  const zapDetails = meta?.zapDetails as import("@tools/kyberswap/zaas/types.js").ZapDetails | undefined;
  if (!zapDetails) return;

  try {
    const { insertLpEvent, insertLpLegs } = await import("@echo-agent/db/repos/lp-events.js");
    const { extractLpLegs, extractFeeCollectedUsd } = await import("./lp-economics.js");

    const eventId = await insertLpEvent({
      executionId: activity.executionId,
      captureItemId: activity.captureItemId ?? null,
      namespace: activity.namespace,
      chain: activity.chain,
      action,
      dex: (meta?.dex as string) ?? undefined,
      pool: (meta?.pool as string) ?? (meta?.poolTo as string) ?? undefined,
      positionKey: activity.positionKey ?? undefined,
      instrumentKey: activity.instrumentKey ?? undefined,
      walletAddress: activity.walletAddress ?? "",
      totalValueUsd: activity.inputValueUsd ?? activity.outputValueUsd ?? undefined,
      feeCollectedUsd: extractFeeCollectedUsd(zapDetails),
      valuationSource: zapDetails.initialAmountUsd || zapDetails.finalAmountUsd ? "zaas_estimate" : "none",
    });

    if (eventId > 0) {
      const legs = extractLpLegs(action, zapDetails, eventId);
      if (legs.length > 0) {
        await insertLpLegs(legs);
      }
      logger.debug("sync.lp_economics.recorded", { eventId, action, legCount: legs.length });
    }
  } catch (err) {
    logger.warn("sync.lp_economics.failed", {
      action, positionKey: activity.positionKey,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ── Spot lot ledger ───────────────────────────────────────────────

async function projectSpotLot(activity: Activity): Promise<void> {
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
  const { getPool } = await import("@echo-agent/db/client.js");
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
