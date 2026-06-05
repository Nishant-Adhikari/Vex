/**
 * vex.onboarding.wallet* — generate-wallet handler registration.
 *
 * Registers `walletGenerateEvm` and `walletGenerateSolana`. Both route through
 * `withWalletLock` + `withFreshKeystorePassword` so the keystore write is
 * serialised and the master password is injected only for the engine call.
 */

import { CH } from "@shared/ipc/channels.js";
import { type Result } from "@shared/ipc/result.js";
import {
  walletGenerateInputSchema,
  walletGenerateEvmResultSchema,
  walletGenerateSolanaResultSchema,
  type WalletGenerateEvmResult,
  type WalletGenerateSolanaResult,
} from "@shared/schemas/wallets.js";
import {
  generateEvmWallet,
  generateSolanaWallet,
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
 * Register the generate-wallet handlers into the shared teardown array,
 * preserving the original push order (EVM then Solana).
 */
export function registerGenerateHandlers(handlers: Array<() => void>): void {
  handlers.push(
    registerHandler({
      channel: CH.onboarding.walletGenerateEvm,
      domain: "onboarding",
      inputSchema: walletGenerateInputSchema,
      outputSchema: walletGenerateEvmResultSchema,
      handle: async (
        _input,
        ctx
      ): Promise<Result<WalletGenerateEvmResult>> => {
        return withWalletLock(async () => {
          const outcome = await withFreshKeystorePassword(async () => {
            return generateEvmWallet();
          });
          if (isPasswordSetupError(outcome)) return outcome;
          if (outcome.ok) {
            log.info(
              `[ipc:vex:onboarding:walletGenerateEvm] ` +
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
      channel: CH.onboarding.walletGenerateSolana,
      domain: "onboarding",
      inputSchema: walletGenerateInputSchema,
      outputSchema: walletGenerateSolanaResultSchema,
      handle: async (
        _input,
        ctx
      ): Promise<Result<WalletGenerateSolanaResult>> => {
        return withWalletLock(async () => {
          const outcome = await withFreshKeystorePassword(async () => {
            return generateSolanaWallet();
          });
          if (isPasswordSetupError(outcome)) return outcome;
          if (outcome.ok) {
            log.info(
              `[ipc:vex:onboarding:walletGenerateSolana] ` +
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
