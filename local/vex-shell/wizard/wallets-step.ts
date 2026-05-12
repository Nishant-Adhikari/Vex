/**
 * Wallets step — delegates to the existing `ensureWallets()` helper in
 * `src/cli/setup/wallets.ts` because that path already owns the
 * create/import ceremony (password confirmation, keystore encryption,
 * address reporting) and the wizard has no reason to re-implement it.
 *
 * Runs ONLY when at least one wallet is missing; otherwise reports status
 * and moves on.
 */

import { log, confirm, isCancel } from "@clack/prompts";
import {
  getEvmWalletStatus,
  getSolanaWalletStatus,
} from "../../../src/cli/setup/status.js";
import { ensureWallets } from "../../../src/cli/setup/wallets.js";

export interface WalletsOutcome {
  aborted: boolean;
  ran: boolean;
}

export async function runWalletsStep(): Promise<WalletsOutcome> {
  const evm = getEvmWalletStatus();
  const sol = getSolanaWalletStatus();

  const evmOk = evm.status === "configured";
  const solOk = sol.status === "configured";

  log.step("Wallets");
  log.info(`EVM wallet: ${evmOk ? "configured" : "missing"} — ${evm.detail}`);
  log.info(`Solana wallet: ${solOk ? "configured" : "missing"} — ${sol.detail}`);

  if (evmOk && solOk) return { aborted: false, ran: false };

  const shouldRun = await confirm({
    message: "Run wallet setup (create/import EVM + Solana keystores)?",
    initialValue: true,
  });
  if (isCancel(shouldRun) || !shouldRun) {
    log.warn("Skipping wallet setup. Features requiring signing will fail at runtime.");
    return { aborted: false, ran: false };
  }

  // ensureWallets uses readline-based prompts internally — @clack is paused
  // while it runs, then we resume.
  try {
    await ensureWallets();
    log.success("Wallet setup completed.");
    return { aborted: false, ran: true };
  } catch (err) {
    log.error(`Wallet setup failed: ${err instanceof Error ? err.message : String(err)}`);
    return { aborted: false, ran: true };
  }
}
