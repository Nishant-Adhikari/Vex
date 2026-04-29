/**
 * Solana/Jupiter lending handlers.
 */

import {
  getJupiterLendEarnTokens,
  getJupiterLendEarnPositions,
  getJupiterLendEarnEarnings,
  executeJupiterLendEarnDeposit,
  executeJupiterLendEarnWithdraw,
} from "@tools/solana-ecosystem/jupiter/jupiter-lend/earn-api/service.js";

import type { ProtocolHandler } from "../../types.js";
import { str, ok, fail } from "../../handler-helpers.js";
import { walletAddress, walletSecret } from "./core.js";

// ── Handler map ──────────────────────────────────────────────────

export const LEND_HANDLERS: Record<string, ProtocolHandler> = {
  "solana.lend.rates": async () => ok(await getJupiterLendEarnTokens()),
  "solana.lend.positions": async (p) => {
    const addr = walletAddress(p);
    const positions = await getJupiterLendEarnPositions(addr);
    const posAddresses = positions.map(pos => pos.token.assetAddress).filter(Boolean);
    const earningsResult = posAddresses.length > 0
      ? await getJupiterLendEarnEarnings(addr, posAddresses)
      : null;
    return ok({ positions, earnings: earningsResult?.earnings ?? [], earningsRaw: earningsResult?.raw });
  },
  "solana.lend.deposit": async (p) => {
    const asset = str(p, "asset"), amount = str(p, "amount");
    if (!asset || !amount) return fail("Missing required: asset, amount");
    const result = await executeJupiterLendEarnDeposit(walletSecret(), asset, amount);
    return {
      success: true,
      output: JSON.stringify(result, null, 2),
      data: {
        ...result,
        _tradeCapture: {
          type: "lend", chain: "solana", status: "executed",
          walletAddress: walletAddress(p), inputTokenAddress: asset, inputAmount: amount,
          meta: { action: "deposit", asset },
        },
      },
    };
  },
  "solana.lend.withdraw": async (p) => {
    const asset = str(p, "asset"), amount = str(p, "amount");
    if (!asset || !amount) return fail("Missing required: asset, amount");
    const result = await executeJupiterLendEarnWithdraw(walletSecret(), asset, amount);
    return {
      success: true,
      output: JSON.stringify(result, null, 2),
      data: {
        ...result,
        _tradeCapture: {
          type: "lend", chain: "solana", status: "executed",
          walletAddress: walletAddress(p), inputTokenAddress: asset, inputAmount: amount,
          meta: { action: "withdraw", asset },
        },
      },
    };
  },
};
