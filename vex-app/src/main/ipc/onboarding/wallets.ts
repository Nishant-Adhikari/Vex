/**
 * vex.onboarding.wallet* — Wizard Step 2 IPC handlers (M8).
 *
 * Six handlers split out from `onboarding.ts` per codex turn 8 GREEN
 * and user decision (file boundary at the wallet domain). Every handler
 * routes through `withWalletLock` (global mutex) and
 * `withFreshKeystorePassword` (force-fresh password from `${CONFIG_DIR}/.env`)
 * so concurrent invocations cannot interleave keystore + config writes,
 * and no stale `process.env` value leaks past M7's password write.
 */

import path from "node:path";
import { promises as fs } from "node:fs";
import { BrowserWindow, dialog, shell } from "electron";
import { BACKUPS_DIR } from "@vex-lib/wallet.js";
import { CH } from "@shared/ipc/channels.js";
import { err, ok, type Result } from "@shared/ipc/result.js";
import {
  walletGenerateInputSchema,
  walletGenerateEvmResultSchema,
  walletGenerateSolanaResultSchema,
  walletImportEvmInputSchema,
  walletImportSolanaInputSchema,
  walletImportEvmResultSchema,
  walletImportSolanaResultSchema,
  walletOpenBackupFolderInputSchema,
  walletOpenBackupFolderResultSchema,
  walletRestoreInputSchema,
  walletRestoreResultSchema,
  type WalletChain,
  type WalletGenerateEvmResult,
  type WalletGenerateSolanaResult,
  type WalletImportEvmResult,
  type WalletImportSolanaResult,
  type WalletOpenBackupFolderResult,
  type WalletRestoreResult,
} from "@shared/schemas/wallets.js";
import {
  generateEvmWallet,
  generateSolanaWallet,
  importEvmWallet,
  importSolanaWalletRunner,
} from "../../onboarding/wallets-runner.js";
import { restoreWalletFromFile } from "../../onboarding/wallet-restore.js";
import {
  isPasswordSetupError,
  withFreshKeystorePassword,
} from "../../onboarding/wallet-password.js";
import { withWalletLock } from "../../onboarding/wallet-mutex.js";
import { log } from "../../logger/index.js";
import { registerHandler } from "../register-handler.js";

/**
 * Truncate an address for the dialog message — short enough to fit
 * a single dialog line on every platform without horizontal scroll.
 */
function truncateAddress(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/**
 * Resolve `candidate` to its real on-disk path and confirm it is a
 * directory inside `${CONFIG_DIR}/backups/` even after symlink
 * resolution (codex turn 8 answer #5 + turn 9 STILL-OPEN). Returns
 * the resolved real path on success — the handler MUST pass that
 * resolved path (not the renderer-supplied one) to `shell.openPath`
 * to close the symlink-swap TOCTOU window between validation and open.
 */
async function resolveBackupDir(candidate: string): Promise<string | null> {
  try {
    const baseReal = await fs.realpath(BACKUPS_DIR);
    const candidateReal = await fs.realpath(candidate);
    const stat = await fs.stat(candidateReal);
    if (!stat.isDirectory()) return null;
    if (
      candidateReal === baseReal ||
      candidateReal.startsWith(baseReal + path.sep)
    ) {
      return candidateReal;
    }
    return null;
  } catch {
    return null;
  }
}

export function registerWalletHandlers(): Array<() => void> {
  const handlers: Array<() => void> = [];

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

  handlers.push(
    registerHandler({
      channel: CH.onboarding.walletRestoreFromBackup,
      domain: "onboarding",
      inputSchema: walletRestoreInputSchema,
      outputSchema: walletRestoreResultSchema,
      handle: async (
        input,
        ctx
      ): Promise<Result<WalletRestoreResult>> => {
        const parentWindow = BrowserWindow.fromWebContents(ctx.event.sender);

        // Single-roundtrip flow (codex turn 8 answer #2): main owns the
        // file picker so the renderer never sees absolute paths.
        const dialogResult = await dialog.showOpenDialog(
          parentWindow ?? undefined,
          {
            title: `Restore ${input.chain === "evm" ? "EVM" : "Solana"} keystore from backup`,
            filters: [{ name: "Keystore JSON", extensions: ["json"] }],
            properties: ["openFile"],
          }
        );
        if (dialogResult.canceled) {
          return err({
            code: "internal.cancelled",
            domain: "onboarding",
            message: "Restore cancelled.",
            retryable: false,
            userActionable: false,
            redacted: true,
          });
        }
        const sourcePath = dialogResult.filePaths[0];
        if (!sourcePath) {
          return err({
            code: "internal.cancelled",
            domain: "onboarding",
            message: "No file selected.",
            retryable: false,
            userActionable: false,
            redacted: true,
          });
        }

        return withWalletLock(async () => {
          const outcome = await withFreshKeystorePassword(async (pwdCtx) => {
            const confirmReplace = async (mismatch: {
              chain: WalletChain;
              existingAddress: string;
              incomingAddress: string;
            }): Promise<boolean> => {
              const message =
                `Replace your current ${mismatch.chain === "evm" ? "EVM" : "Solana"} wallet ` +
                `(${truncateAddress(mismatch.existingAddress)}) with the imported one ` +
                `(${truncateAddress(mismatch.incomingAddress)})?`;
              const detail =
                "The current wallet will be backed up automatically before " +
                "the replacement. This is irreversible without your master password " +
                "and the backup folder.";
              const choice = await dialog.showMessageBox(
                parentWindow ?? undefined,
                {
                  type: "warning",
                  title: "Replace wallet?",
                  message,
                  detail,
                  buttons: ["Replace", "Cancel"],
                  defaultId: 1,
                  cancelId: 1,
                  noLink: true,
                }
              );
              return choice.response === 0;
            };

            return restoreWalletFromFile({
              chain: input.chain,
              sourcePath,
              password: pwdCtx.password,
              confirmReplace,
            });
          });
          if (isPasswordSetupError(outcome)) return outcome;
          if (outcome.ok) {
            log.info(
              `[ipc:vex:onboarding:walletRestoreFromBackup] ` +
                `chain=${outcome.data.chain} ` +
                `address=${truncateAddress(outcome.data.address)} ` +
                `replaced=${outcome.data.replacedAddress ? truncateAddress(outcome.data.replacedAddress) : "<none>"} ` +
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
      channel: CH.onboarding.walletOpenBackupFolder,
      domain: "onboarding",
      inputSchema: walletOpenBackupFolderInputSchema,
      outputSchema: walletOpenBackupFolderResultSchema,
      handle: async (
        input,
        ctx
      ): Promise<Result<WalletOpenBackupFolderResult>> => {
        const resolved = await resolveBackupDir(input.backupDir);
        if (resolved === null) {
          log.warn(
            `[ipc:vex:onboarding:walletOpenBackupFolder] rejected path correlationId=${ctx.requestId}`
          );
          return err({
            code: "validation.invalid_input",
            domain: "onboarding",
            message: "Backup path is not inside the Vex backups directory.",
            retryable: false,
            userActionable: false,
            redacted: true,
          });
        }
        // Pass the realpath-resolved candidate (not the renderer
        // input) to shell.openPath so a symlink swap between
        // validation and open cannot redirect the open target.
        const errorMessage = await shell.openPath(resolved);
        if (errorMessage !== "") {
          log.error(
            `[ipc:vex:onboarding:walletOpenBackupFolder] shell.openPath failed: ${errorMessage}`
          );
          return err({
            code: "internal.unexpected",
            domain: "internal",
            message: "Could not open backup folder in the file manager.",
            retryable: true,
            userActionable: false,
            redacted: true,
          });
        }
        return ok({ ok: true });
      },
    })
  );

  return handlers;
}
