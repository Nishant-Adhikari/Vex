/**
 * LP economics — extract cashflow legs from ZaaS zapDetails.
 *
 * Called from position-projector after LP activity insert.
 * Maps ZaaS action types to LP leg types (deposit/withdraw/fee/refund).
 */

import type { ZapDetails, ZapAction } from "@tools/kyberswap/zaas/types.js";
import type { LpLegInsert } from "@echo-agent/db/repos/lp-events.js";
import logger from "@utils/logger.js";

/**
 * Extract LP cashflow legs from ZaaS zapDetails.
 *
 * For zap-in: addLiquidity → deposit, protocolFee → fee, refund → refund
 * For zap-out: removeLiquidity → withdraw, protocolFee → fee, refund → refund
 * For zap-migrate: removeLiquidity → withdraw, addLiquidity → deposit, fees → fee
 */
export function extractLpLegs(
  action: string,
  zapDetails: ZapDetails | undefined,
  lpEventId: number,
): LpLegInsert[] {
  if (!zapDetails?.actions || zapDetails.actions.length === 0) return [];

  const legs: LpLegInsert[] = [];

  for (const zapAction of zapDetails.actions) {
    const type = zapAction.type;

    if (type === "ACTION_TYPE_ADD_LIQUIDITY" && zapAction.addLiquidity) {
      // Deposit legs — tokens going into the pool
      const liq = zapAction.addLiquidity;
      const tokens = liq.tokens ?? [liq.token0, liq.token1].filter(Boolean);
      for (const token of tokens) {
        if (!token?.address || !token?.amount || token.amount === "0") continue;
        legs.push({
          lpEventId,
          legType: "deposit",
          tokenAddress: token.address,
          amountRaw: token.amount,
          amountUsd: token.amountUsd ?? undefined,
        });
      }
    }

    if (type === "ACTION_TYPE_REMOVE_LIQUIDITY" && zapAction.removeLiquidity) {
      // Withdraw legs — tokens coming out of the pool
      const liq = zapAction.removeLiquidity;
      const tokens = liq.tokens ?? [liq.token0, liq.token1].filter(Boolean);
      for (const token of tokens) {
        if (!token?.address || !token?.amount || token.amount === "0") continue;
        legs.push({
          lpEventId,
          legType: "withdraw",
          tokenAddress: token.address,
          amountRaw: token.amount,
          amountUsd: token.amountUsd ?? undefined,
        });
      }
    }

    if (type === "ACTION_TYPE_PROTOCOL_FEE" && zapAction.protocolFee) {
      // Protocol fee legs
      const fee = zapAction.protocolFee;
      const tokens = (fee as unknown as { tokens?: Array<{ address: string; amount: string; amountUsd?: string }> }).tokens;
      if (tokens) {
        for (const token of tokens) {
          if (!token.address || !token.amount || token.amount === "0") continue;
          legs.push({
            lpEventId,
            legType: "fee",
            tokenAddress: token.address,
            amountRaw: token.amount,
            amountUsd: token.amountUsd ?? undefined,
          });
        }
      }
    }

    if (type === "ACTION_TYPE_REFUND" && zapAction.refund) {
      // Refund legs — leftover tokens returned to user
      for (const token of zapAction.refund.tokens) {
        if (!token?.address || !token?.amount || token.amount === "0") continue;
        legs.push({
          lpEventId,
          legType: "refund",
          tokenAddress: token.address,
          amountRaw: token.amount,
          amountUsd: token.amountUsd ?? undefined,
        });
      }
    }
  }

  if (legs.length > 0) {
    logger.debug("sync.lp_economics.legs_extracted", { action, legCount: legs.length });
  }

  return legs;
}

/**
 * Compute total fee collected USD from zapDetails fee actions.
 */
export function extractFeeCollectedUsd(zapDetails: ZapDetails | undefined): string | undefined {
  if (!zapDetails?.actions) return undefined;

  let totalFee = 0;
  for (const action of zapDetails.actions) {
    if (action.type === "ACTION_TYPE_PROTOCOL_FEE" && action.protocolFee) {
      const tokens = (action.protocolFee as unknown as { tokens?: Array<{ amountUsd?: string }> }).tokens;
      if (tokens) {
        for (const t of tokens) {
          if (t.amountUsd) totalFee += parseFloat(t.amountUsd);
        }
      }
    }
  }

  return totalFee > 0 ? String(totalFee) : undefined;
}
