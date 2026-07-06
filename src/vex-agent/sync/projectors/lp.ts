/**
 * LP lifecycle projection — zap-in/out/migrate (kyberswap) + Pendle single-token
 * lp-add/lp-remove + LP economics recording.
 *
 * Open-lifecycle actions: `zap-in` / `lp-add` open (upsert) the LP position;
 * `zap-out` / `lp-remove` close it — EXCEPT a Pendle `lp-remove` closes ONLY on a
 * PROVEN full exit (`meta.fullExit === true`), because a single-token remove can be
 * partial. `zap-migrate` closes the old and opens the new. Economics (proj_lp_events
 * + legs) come from the kyberswap ZaaS `meta.zapDetails` OR the protocol-neutral
 * `meta.lpLegs` block (any non-ZaaS LP protocol, e.g. Pendle), never both.
 */

import * as openPositionsRepo from "@vex-agent/db/repos/open-positions.js";
import type { Activity } from "@vex-agent/db/repos/activity.js";
import type { LpLegInsert } from "@vex-agent/db/repos/lp-events.js";
import logger from "@utils/logger.js";

// ── LP lifecycle (zap-in/out/migrate + lp-add/lp-remove) ───────────

/** Actions that OPEN/upsert an LP position. */
function isOpenAction(action: string | undefined): boolean {
  return action === "zap-in" || action === "lp-add";
}

/**
 * Whether a close action fully exits the position. Kyberswap `zap-out` is always a
 * full exit; a Pendle `lp-remove` closes ONLY when the capture proved a full exit
 * (`meta.fullExit === true`) — a partial remove leaves the position OPEN.
 */
function isFullCloseAction(action: string | undefined, meta: Record<string, unknown>): boolean {
  if (action === "zap-out") return true;
  if (action === "lp-remove") return meta?.fullExit === true;
  return false;
}

export async function projectLpLifecycle(activity: Activity): Promise<void> {
  const { positionKey, walletAddress, instrumentKey } = activity;
  if (!positionKey) return;

  const meta = activity.meta as Record<string, unknown>;
  const action = meta?.action as string | undefined;

  if (isOpenAction(action)) {
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

  } else if (isFullCloseAction(action, meta)) {
    await openPositionsRepo.closePosition(activity.namespace, "lp", activity.chain, walletAddress ?? "", positionKey, "closed");
    logger.debug("sync.lp.closed", { positionKey });

  } else if (action === "zap-migrate") {
    // Carry cost basis from old position before closing
    const oldPosition = await openPositionsRepo.getByPositionKey(positionKey);
    const carriedNotionalUsd = oldPosition?.notionalUsd ?? undefined;

    // Close old position
    await openPositionsRepo.closePosition(activity.namespace, "lp", activity.chain, walletAddress ?? "", positionKey, "migrated");

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

const NEUTRAL_LEG_TYPES = new Set<LpLegInsert["legType"]>(["deposit", "withdraw", "fee", "refund"]);

/**
 * Validate the protocol-neutral `meta.lpLegs` block (UNTRUSTED — it round-trips
 * through JSONB and originates in a handler capture). Each leg needs a known
 * `legType`, a non-empty `tokenAddress`, and a non-zero `amountRaw`; `amountUsd` is
 * optional. Returns the sanitized legs WITHOUT `lpEventId` (assigned by the caller).
 */
function readNeutralLpLegs(meta: Record<string, unknown>): Omit<LpLegInsert, "lpEventId">[] {
  const raw = meta?.lpLegs;
  if (!Array.isArray(raw)) return [];
  const out: Omit<LpLegInsert, "lpEventId">[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const leg = item as Record<string, unknown>;
    const legType = leg.legType as LpLegInsert["legType"];
    const tokenAddress = typeof leg.tokenAddress === "string" ? leg.tokenAddress : "";
    const amountRaw = typeof leg.amountRaw === "string" ? leg.amountRaw : "";
    if (!NEUTRAL_LEG_TYPES.has(legType) || tokenAddress === "" || amountRaw === "" || amountRaw === "0") continue;
    out.push({
      legType,
      tokenAddress,
      amountRaw,
      tokenSymbol: typeof leg.tokenSymbol === "string" ? leg.tokenSymbol : undefined,
      amountUsd: typeof leg.amountUsd === "string" && leg.amountUsd !== "" ? leg.amountUsd : undefined,
    });
  }
  return out;
}

async function recordLpEconomics(activity: Activity, action: string): Promise<void> {
  const meta = activity.meta as Record<string, unknown>;
  const zapDetails = meta?.zapDetails as import("@tools/kyberswap/zaas/types.js").ZapDetails | undefined;

  try {
    const { insertLpEvent, insertLpLegs } = await import("@vex-agent/db/repos/lp-events.js");

    // ── Kyberswap ZaaS path (unchanged) ──
    if (zapDetails) {
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
        if (legs.length > 0) await insertLpLegs(legs);
        logger.debug("sync.lp_economics.recorded", { eventId, action, legCount: legs.length });
      }
      return;
    }

    // ── Protocol-neutral `meta.lpLegs` path (Pendle + any non-ZaaS LP) ──
    const neutralLegs = readNeutralLpLegs(meta);
    if (neutralLegs.length === 0) return;
    const eventId = await insertLpEvent({
      executionId: activity.executionId,
      captureItemId: activity.captureItemId ?? null,
      namespace: activity.namespace,
      chain: activity.chain,
      action,
      dex: (meta?.dex as string) ?? undefined,
      pool: (meta?.pool as string) ?? undefined,
      positionKey: activity.positionKey ?? undefined,
      instrumentKey: activity.instrumentKey ?? undefined,
      walletAddress: activity.walletAddress ?? "",
      totalValueUsd: activity.inputValueUsd ?? activity.outputValueUsd ?? undefined,
      feeCollectedUsd: undefined,
      valuationSource: activity.valuationSource ?? "none",
    });
    if (eventId > 0) {
      await insertLpLegs(neutralLegs.map((leg) => ({ ...leg, lpEventId: eventId })));
      logger.debug("sync.lp_economics.recorded", { eventId, action, legCount: neutralLegs.length });
    }
  } catch (err) {
    logger.warn("sync.lp_economics.failed", {
      action, positionKey: activity.positionKey,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
