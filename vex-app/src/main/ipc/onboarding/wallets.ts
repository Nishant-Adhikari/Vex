/**
 * vex.onboarding.wallet* — Wizard Step 2 IPC handlers (M8).
 *
 * Six handlers split out from `onboarding.ts` per codex turn 8 GREEN
 * and user decision (file boundary at the wallet domain). Every handler
 * routes through `withWalletLock` (global mutex) and
 * `withFreshKeystorePassword` (injects the unlocked in-memory master password
 * into `process.env` only for the duration of the engine call) so concurrent
 * invocations cannot interleave keystore + config writes and the password is
 * not persisted in `.env`.
 *
 * Structural note: the per-handler registration bodies now live in the
 * `./wallets/` sibling modules (guards / dialogs / generate / import / restore /
 * export / register). This file stays the public façade — `registerWalletHandlers`
 * delegates to the per-family aggregator and returns the SAME teardown array in
 * the SAME push order.
 */

import { registerAllWalletFamilies } from "./wallets/register.js";

export function registerWalletHandlers(): Array<() => void> {
  return registerAllWalletFamilies();
}
