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
import { walletScopeErrorToResult } from "@vex-agent/tools/internal/wallet/resolve.js";

// ── Handler map ──────────────────────────────────────────────────

export const LEND_HANDLERS: Record<string, ProtocolHandler> = {
  "solana.lend.rates": async () => ok(await getJupiterLendEarnTokens()),
  "solana.lend.positions": async (p, ctx) => {
    let addr: string;
    try {
      addr = walletAddress(p, ctx);
    } catch (err) {
      return walletScopeErrorToResult(err);
    }
    const positions = await getJupiterLendEarnPositions(addr);
    const posAddresses = positions.map(pos => pos.token.assetAddress).filter(Boolean);
    const earningsResult = posAddresses.length > 0
      ? await getJupiterLendEarnEarnings(addr, posAddresses)
      : null;
    return ok({ positions, earnings: earningsResult?.earnings ?? [] });
  },
  "solana.lend.deposit": async (p, ctx) => {
    const asset = str(p, "asset"), amount = str(p, "amount");
    if (!asset || !amount) return fail("Missing required: asset, amount");
    // Resolve owner + signer BEFORE broadcast (5D-protocols p2) so a session
    // scope mismatch fails closed without an on-chain side effect.
    let addr: string, secret: Uint8Array;
    try {
      addr = walletAddress(p, ctx);
      secret = walletSecret(ctx);
    } catch (err) {
      return walletScopeErrorToResult(err);
    }
    const result = await executeJupiterLendEarnDeposit(secret, asset, amount);
    return {
      success: true,
      output: JSON.stringify(result, null, 2),
      data: {
        ...result,
        _tradeCapture: {
          type: "lend", chain: "solana", status: "executed",
          walletAddress: addr, inputTokenAddress: asset, inputAmount: amount,
          meta: { action: "deposit", asset },
        },
      },
    };
  },
  "solana.lend.withdraw": async (p, ctx) => {
    const asset = str(p, "asset"), amount = str(p, "amount");
    if (!asset || !amount) return fail("Missing required: asset, amount");
    let addr: string, secret: Uint8Array;
    try {
      addr = walletAddress(p, ctx);
      secret = walletSecret(ctx);
    } catch (err) {
      return walletScopeErrorToResult(err);
    }
    const result = await executeJupiterLendEarnWithdraw(secret, asset, amount);
    return {
      success: true,
      output: JSON.stringify(result, null, 2),
      data: {
        ...result,
        _tradeCapture: {
          type: "lend", chain: "solana", status: "executed",
          walletAddress: addr, inputTokenAddress: asset, inputAmount: amount,
          meta: { action: "withdraw", asset },
        },
      },
    };
  },
};
