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
 *
 * Split into modules: projector-lp.ts, projector-spot.ts.
 */

import * as openPositionsRepo from "@echo-agent/db/repos/open-positions.js";
import type { Activity } from "@echo-agent/db/repos/activity.js";
import logger from "@utils/logger.js";
import { projectLpLifecycle } from "./projectors/lp.js";
import { projectSpotLot } from "./projectors/spot.js";

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
