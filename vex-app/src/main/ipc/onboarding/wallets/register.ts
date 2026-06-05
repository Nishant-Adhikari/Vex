/**
 * vex.onboarding.wallet* — per-family registration aggregator.
 *
 * Composes the per-family registers into a single teardown array, preserving
 * the EXACT push order of the original monolithic `registerWalletHandlers`:
 *   1. walletGenerateEvm        2. walletGenerateSolana       (generate)
 *   3. walletImportEvm          4. walletImportSolana         (import — replace)
 *   5. walletRestoreFromBackup  6. walletListBackups
 *   7. walletRestoreArchive                                   (restore)
 *   8. walletOpenBackupFolder                                 (open-backup)
 *   9. walletAddEvm            10. walletAddSolana
 *  11. walletImportAddEvm      12. walletImportAddSolana       (import — inventory)
 *  13. walletExportAll                                        (export)
 */

import { registerGenerateHandlers } from "./generate.js";
import {
  registerImportHandlers,
  registerInventoryHandlers,
} from "./import.js";
import { registerRestoreHandlers } from "./restore.js";
import {
  registerExportAllHandler,
  registerOpenBackupHandler,
} from "./export.js";

/**
 * Register every wallet-onboarding handler and return the teardown callbacks in
 * the original push order. The façade `registerWalletHandlers` delegates here.
 */
export function registerAllWalletFamilies(): Array<() => void> {
  const handlers: Array<() => void> = [];

  registerGenerateHandlers(handlers); // 1, 2
  registerImportHandlers(handlers); // 3, 4
  registerRestoreHandlers(handlers); // 5, 6, 7
  registerOpenBackupHandler(handlers); // 8
  registerInventoryHandlers(handlers); // 9, 10, 11, 12
  registerExportAllHandler(handlers); // 13

  return handlers;
}
