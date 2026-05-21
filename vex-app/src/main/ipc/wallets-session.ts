/**
 * Wallet IPC handlers — per-session wallet scope contract.
 *
 * Distinct from `wallet-export.ts` (sudo-style key export). This file
 * owns the puzzle-1 surface for the eventual session wallet scope
 * (puzzle 05/10) + prepared intent flow.
 *
 * `listSessionWallets` is read-only and returns an empty scope today
 * (no DB column yet). `setSessionWalletScope`, `getPreparedIntent`,
 * `cancelPreparedIntent` fail-close with `wallets.feature_unavailable`.
 *
 * Provider hot-wallet keys never enter the Electron process — provider
 * signing belongs in a backend signer. Read-only handlers here only
 * touch local user-wallet metadata.
 */

import { CH } from "@shared/ipc/channels.js";
import { err, ok, type Result } from "@shared/ipc/result.js";
import {
  preparedIntentDtoSchema,
  sessionWalletScopeDtoSchema,
  walletsActionResultSchema,
  walletsCancelPreparedIntentInputSchema,
  walletsGetPreparedIntentInputSchema,
  walletsListSessionInputSchema,
  walletsSetScopeInputSchema,
  walletsSetScopeResultSchema,
  type PreparedIntentDto,
  type SessionWalletScopeDto,
  type WalletsActionResult,
  type WalletsSetScopeResult,
} from "@shared/schemas/wallets.js";
import { log } from "../logger/index.js";
import { featureUnavailable } from "./_feature-unavailable.js";
import { registerHandler } from "./register-handler.js";

const preparedIntentNullableSchema = preparedIntentDtoSchema.nullable();

function registerListSessionWalletsHandler(): () => void {
  return registerHandler({
    channel: CH.wallets.listSessionWallets,
    domain: "wallets",
    inputSchema: walletsListSessionInputSchema,
    outputSchema: sessionWalletScopeDtoSchema,
    handle: async (input, ctx): Promise<Result<SessionWalletScopeDto>> => {
      log.info(
        `[ipc:vex:wallets:listSessionWallets] ok sessionId=${input.sessionId} ` +
          `scope=empty correlationId=${ctx.requestId}`,
      );
      return ok({
        sessionId: input.sessionId,
        allowedWalletIds: [],
        defaultWalletId: null,
      });
    },
  });
}

function registerSetScopeHandler(): () => void {
  return registerHandler({
    channel: CH.wallets.setSessionWalletScope,
    domain: "wallets",
    inputSchema: walletsSetScopeInputSchema,
    outputSchema: walletsSetScopeResultSchema,
    handle: async (_input, ctx): Promise<Result<WalletsSetScopeResult>> => {
      log.info(
        `[ipc:vex:wallets:setSessionWalletScope] fail-closed feature_unavailable ` +
          `correlationId=${ctx.requestId}`,
      );
      return err(
        featureUnavailable({
          domain: "wallets",
          correlationId: ctx.requestId,
          message:
            "Per-session wallet scope lands in puzzle 05 (DB-backed scope + mission contract hash).",
        }),
      );
    },
  });
}

function registerGetPreparedIntentHandler(): () => void {
  return registerHandler({
    channel: CH.wallets.getPreparedIntent,
    domain: "wallets",
    inputSchema: walletsGetPreparedIntentInputSchema,
    outputSchema: preparedIntentNullableSchema,
    handle: async (_input, ctx): Promise<Result<PreparedIntentDto | null>> => {
      log.info(
        `[ipc:vex:wallets:getPreparedIntent] fail-closed feature_unavailable ` +
          `correlationId=${ctx.requestId}`,
      );
      return err(
        featureUnavailable({
          domain: "wallets",
          correlationId: ctx.requestId,
          message:
            "Prepared wallet intents land in puzzle 05 (durable transfer_intents table).",
        }),
      );
    },
  });
}

function registerCancelPreparedIntentHandler(): () => void {
  return registerHandler({
    channel: CH.wallets.cancelPreparedIntent,
    domain: "wallets",
    inputSchema: walletsCancelPreparedIntentInputSchema,
    outputSchema: walletsActionResultSchema,
    handle: async (_input, ctx): Promise<Result<WalletsActionResult>> => {
      log.info(
        `[ipc:vex:wallets:cancelPreparedIntent] fail-closed feature_unavailable ` +
          `correlationId=${ctx.requestId}`,
      );
      return err(
        featureUnavailable({
          domain: "wallets",
          correlationId: ctx.requestId,
          message:
            "Prepared wallet intent cancel lands in puzzle 05 (DB-backed expiry + idempotency).",
        }),
      );
    },
  });
}

export function registerWalletsSessionHandlers(): ReadonlyArray<() => void> {
  return [
    registerListSessionWalletsHandler(),
    registerSetScopeHandler(),
    registerGetPreparedIntentHandler(),
    registerCancelPreparedIntentHandler(),
  ];
}
