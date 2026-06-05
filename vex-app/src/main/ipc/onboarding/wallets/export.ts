/**
 * vex.onboarding.wallet* — export / open-backup handler registration.
 *
 * `registerOpenBackupHandler`: `walletOpenBackupFolder` — realpath-contains the
 * renderer path under `${CONFIG_DIR}/backups/` and hands the RESOLVED path to
 * `shell.openPath` (closes the symlink-swap TOCTOU window).
 * `registerExportAllHandler`: `walletExportAll` — copies ENCRYPTED keystores +
 * a sanitized manifest to a user-chosen folder. No plaintext key material is
 * read, so NO fresh keystore password — `withWalletLock` alone. Main owns the
 * directory picker; the renderer never receives the path.
 */

import { BrowserWindow, dialog, shell } from "electron";
import { CH } from "@shared/ipc/channels.js";
import { err, ok, type Result } from "@shared/ipc/result.js";
import {
  walletExportAllInputSchema,
  walletExportAllResultSchema,
  walletOpenBackupFolderInputSchema,
  walletOpenBackupFolderResultSchema,
  type WalletExportAllResult,
  type WalletOpenBackupFolderResult,
} from "@shared/schemas/wallets.js";
import { exportAllWalletsRunner } from "../../../onboarding/wallets-runner.js";
import { log } from "../../../logger/index.js";
import { registerHandler } from "../../register-handler.js";
import { resolveBackupDir } from "./dialogs.js";
import { withWalletLock } from "./guards.js";

/**
 * Register the open-backup-folder handler into the shared teardown array.
 */
export function registerOpenBackupHandler(handlers: Array<() => void>): void {
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
}

// Export all: copies ENCRYPTED keystores + a sanitized manifest to a
// user-chosen folder. No plaintext key material is read, so NO fresh
// keystore password — withWalletLock alone (Codex 5D review). Main owns the
// directory picker; the renderer never receives the path (result = filenames).
/**
 * Register the export-all handler into the shared teardown array.
 */
export function registerExportAllHandler(handlers: Array<() => void>): void {
  handlers.push(
    registerHandler({
      channel: CH.onboarding.walletExportAll,
      domain: "onboarding",
      inputSchema: walletExportAllInputSchema,
      outputSchema: walletExportAllResultSchema,
      handle: async (_input, ctx): Promise<Result<WalletExportAllResult>> => {
        const parentWindow = BrowserWindow.fromWebContents(ctx.event.sender);
        const dialogResult = await dialog.showOpenDialog(
          parentWindow ?? undefined,
          {
            title: "Export all wallets to a folder",
            properties: ["openDirectory", "createDirectory"],
          }
        );
        if (dialogResult.canceled) {
          return err({
            code: "internal.cancelled",
            domain: "onboarding",
            message: "Export cancelled.",
            retryable: false,
            userActionable: false,
            redacted: true,
          });
        }
        const destDir = dialogResult.filePaths[0];
        if (!destDir) {
          return err({
            code: "internal.cancelled",
            domain: "onboarding",
            message: "No folder selected.",
            retryable: false,
            userActionable: false,
            redacted: true,
          });
        }
        return withWalletLock(async () => {
          const outcome = await exportAllWalletsRunner(destDir);
          if (outcome.ok) {
            log.info(
              `[ipc:vex:onboarding:walletExportAll] ` +
                `files=${outcome.data.files.length} correlationId=${ctx.requestId}`
            );
          }
          return outcome;
        });
      },
    })
  );
}
