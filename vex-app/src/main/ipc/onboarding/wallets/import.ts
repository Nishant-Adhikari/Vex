/**
 * vex.onboarding.wallet* — import-wallet handler registration.
 *
 * Two register groups, kept in this single import-domain module:
 *   - `registerImportHandlers`: replace-style single-wallet import
 *     (`walletImportEvm`, `walletImportSolana`).
 *   - `registerInventoryHandlers`: multi-wallet inventory append
 *     (`walletAddEvm`, `walletAddSolana`, `walletImportAddEvm`,
 *     `walletImportAddSolana`).
 *
 * `rawKey` is a SECRET — NEVER logged (only id + truncated addr). Every handler
 * routes through `withWalletLock` + `withFreshKeystorePassword`.
 */

import { CH } from "@shared/ipc/channels.js";
import { type Result } from "@shared/ipc/result.js";
import {
  walletAddInputSchema,
  walletAddResultSchema,
  walletImportAddInputSchema,
  walletImportEvmInputSchema,
  walletImportSolanaInputSchema,
  walletImportEvmResultSchema,
  walletImportSolanaResultSchema,
  type WalletAddResult,
  type WalletImportEvmResult,
  type WalletImportSolanaResult,
} from "@shared/schemas/wallets.js";
import {
  addEvmWallet,
  addSolanaWallet,
  importEvmWallet,
  importEvmWalletInventory,
  importSolanaWalletInventory,
  importSolanaWalletRunner,
} from "../../../onboarding/wallets-runner.js";
import { log } from "../../../logger/index.js";
import { registerHandler } from "../../register-handler.js";
import { truncateAddress } from "./dialogs.js";
import {
  isPasswordSetupError,
  withFreshKeystorePassword,
  withWalletLock,
} from "./guards.js";

/**
 * Register the replace-style single-wallet import handlers (EVM then Solana),
 * preserving the original push order.
 */
export function registerImportHandlers(handlers: Array<() => void>): void {
  handlers.push(
    registerHandler({
      channel: CH.onboarding.walletImportEvm,
      domain: "onboarding",
      inputSchema: walletImportEvmInputSchema,
      outputSchema: walletImportEvmResultSchema,
      handle: async (
        input,
        ctx
      ): Promise<Result<WalletImportEvmResult>> => {
        return withWalletLock(async () => {
          const outcome = await withFreshKeystorePassword(async () => {
            return importEvmWallet(input.rawKey);
          });
          if (isPasswordSetupError(outcome)) return outcome;
          if (outcome.ok) {
            log.info(
              `[ipc:vex:onboarding:walletImportEvm] ` +
                `address=${truncateAddress(outcome.data.address)} ` +
                `correlationId=${ctx.requestId}`
            );
          }
          return outcome;
        });
      },
    })
  );

  handlers.push(
    registerHandler({
      channel: CH.onboarding.walletImportSolana,
      domain: "onboarding",
      inputSchema: walletImportSolanaInputSchema,
      outputSchema: walletImportSolanaResultSchema,
      handle: async (
        input,
        ctx
      ): Promise<Result<WalletImportSolanaResult>> => {
        return withWalletLock(async () => {
          const outcome = await withFreshKeystorePassword(async () => {
            return importSolanaWalletRunner(input.rawKey);
          });
          if (isPasswordSetupError(outcome)) return outcome;
          if (outcome.ok) {
            log.info(
              `[ipc:vex:onboarding:walletImportSolana] ` +
                `address=${truncateAddress(outcome.data.address)} ` +
                `correlationId=${ctx.requestId}`
            );
          }
          return outcome;
        });
      },
    })
  );
}

// ── Multi-wallet inventory (puzzle 5 phase 5D) ───────────────────────────
// Append a wallet to the per-family inventory (≤3). Same lock + fresh-
// password wrap as generate/import: the engine encrypts a new keystore.

/**
 * Register the inventory add + import-add handlers, preserving the original
 * push order (addEvm, addSolana, importAddEvm, importAddSolana).
 */
export function registerInventoryHandlers(handlers: Array<() => void>): void {
  handlers.push(
    registerHandler({
      channel: CH.onboarding.walletAddEvm,
      domain: "onboarding",
      inputSchema: walletAddInputSchema,
      outputSchema: walletAddResultSchema,
      handle: async (input, ctx): Promise<Result<WalletAddResult>> => {
        return withWalletLock(async () => {
          const outcome = await withFreshKeystorePassword(async () => {
            return addEvmWallet(input.label);
          });
          if (isPasswordSetupError(outcome)) return outcome;
          if (outcome.ok) {
            log.info(
              `[ipc:vex:onboarding:walletAddEvm] ` +
                `id=${outcome.data.id} address=${truncateAddress(outcome.data.address)} ` +
                `correlationId=${ctx.requestId}`
            );
          }
          return outcome;
        });
      },
    })
  );

  handlers.push(
    registerHandler({
      channel: CH.onboarding.walletAddSolana,
      domain: "onboarding",
      inputSchema: walletAddInputSchema,
      outputSchema: walletAddResultSchema,
      handle: async (input, ctx): Promise<Result<WalletAddResult>> => {
        return withWalletLock(async () => {
          const outcome = await withFreshKeystorePassword(async () => {
            return addSolanaWallet(input.label);
          });
          if (isPasswordSetupError(outcome)) return outcome;
          if (outcome.ok) {
            log.info(
              `[ipc:vex:onboarding:walletAddSolana] ` +
                `id=${outcome.data.id} address=${truncateAddress(outcome.data.address)} ` +
                `correlationId=${ctx.requestId}`
            );
          }
          return outcome;
        });
      },
    })
  );

  // Import-add: rawKey is a SECRET — NEVER logged (only id + truncated addr).
  handlers.push(
    registerHandler({
      channel: CH.onboarding.walletImportAddEvm,
      domain: "onboarding",
      inputSchema: walletImportAddInputSchema,
      outputSchema: walletAddResultSchema,
      handle: async (input, ctx): Promise<Result<WalletAddResult>> => {
        return withWalletLock(async () => {
          const outcome = await withFreshKeystorePassword(async () => {
            return importEvmWalletInventory(input.rawKey, input.label);
          });
          if (isPasswordSetupError(outcome)) return outcome;
          if (outcome.ok) {
            log.info(
              `[ipc:vex:onboarding:walletImportAddEvm] ` +
                `id=${outcome.data.id} address=${truncateAddress(outcome.data.address)} ` +
                `correlationId=${ctx.requestId}`
            );
          }
          return outcome;
        });
      },
    })
  );

  handlers.push(
    registerHandler({
      channel: CH.onboarding.walletImportAddSolana,
      domain: "onboarding",
      inputSchema: walletImportAddInputSchema,
      outputSchema: walletAddResultSchema,
      handle: async (input, ctx): Promise<Result<WalletAddResult>> => {
        return withWalletLock(async () => {
          const outcome = await withFreshKeystorePassword(async () => {
            return importSolanaWalletInventory(input.rawKey, input.label);
          });
          if (isPasswordSetupError(outcome)) return outcome;
          if (outcome.ok) {
            log.info(
              `[ipc:vex:onboarding:walletImportAddSolana] ` +
                `id=${outcome.data.id} address=${truncateAddress(outcome.data.address)} ` +
                `correlationId=${ctx.requestId}`
            );
          }
          return outcome;
        });
      },
    })
  );
}
