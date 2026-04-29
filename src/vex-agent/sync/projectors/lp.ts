/**
 * LP lifecycle projection — zap-in/out/migrate + LP economics recording.
 */

import * as openPositionsRepo from "@vex-agent/db/repos/open-positions.js";
import type { Activity } from "@vex-agent/db/repos/activity.js";
import logger from "@utils/logger.js";

// ── LP lifecycle (zap-in/out/migrate) ─────────────────────────────

export async function projectLpLifecycle(activity: Activity): Promise<void> {
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
    const { insertLpEvent, insertLpLegs } = await import("@vex-agent/db/repos/lp-events.js");
    const { extractLpLegs, extractFeeCollectedUsd } = await import("../lp-economics.js");

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
