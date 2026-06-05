/**
 * vex.wallet.exportPrivateKey — sudo-style export of a wallet's private key
 * to the OS clipboard with an auto-clear lease (Phase 2 feature #6).
 *
 * Flow per locked spec:
 *   1. Throttle gate (`checkExportAllowed`). On lockout return
 *      `wallet.export_throttled` with `retryAfterMs` so the renderer can
 *      render a precise "Try again in Xs" message.
 *   2. Session must be unlocked. The export path does NOT itself prompt
 *      for unlock; the renderer is expected to gate the action behind
 *      `getSecretSessionStatus().unlocked`.
 *   3. Re-auth via `verifySecretVaultPassword` — sudo-style, does NOT
 *      mutate session state or rewrite the vault file. Wrong password
 *      advances the throttle. At `EXPORT_FAIL_LIMIT` we relock the vault
 *      so the user must re-enter the password from scratch.
 *   4. Resolve the SELECTED wallet from inventory by `walletId`
 *      (`getWalletById`). Main is the authority: the renderer sends only
 *      the id, never an address. Unknown id → `wallets.invalid_selection`
 *      (fail closed — no decrypt, no clipboard write).
 *   5. Decrypt + VERIFY in the engine (`decryptExportSecret`): derive the
 *      traversal-guarded keystore path, decrypt with the re-typed password,
 *      and assert the key derives the recorded `entry.address` before
 *      returning the clipboard-ready secret (EVM hex / Solana base58; the
 *      engine zeroizes the Solana plaintext buffer). Missing keystore →
 *      `wallet.keystore_missing`; address mismatch / corrupt ciphertext /
 *      wrong-key → `wallet.keystore_corrupt`. A failed verify NEVER reaches
 *      the clipboard and does NOT advance the throttle (the vault password
 *      already proved correct).
 *   6. Write to clipboard inside a single global lease (extracted to
 *      `./wallet-export-clipboard-lease.ts`). A new export cancels the
 *      previous lease's timer + cleanup registry entry.
 *   7. Timer fires after CLEAR_AFTER_MS: only clears the clipboard if the
 *      content still matches the secret we wrote (compared by SHA-256 to
 *      avoid keeping the plaintext alive).
 *   8. Audit log records chain + walletId + correlationId only; never the
 *      secret.
 *
 * Strict process-boundary discipline: the secret string is created and
 * dropped inside this module. It never returns to the renderer; the
 * Result<T> payload reports only `copied: true` + `clearAfterMs`.
 *
 * Compatibility façade: the handler body + structural error mapping live in
 * `./wallet-export/` (`handler.ts`, `errors.ts`). The production export
 * `registerWalletExportHandler` is re-exported here unchanged so importers
 * (and `wallet-export.test.ts`) keep resolving.
 */

export { registerWalletExportHandler } from "./wallet-export/handler.js";

// Test-only lease helpers live with the lease module; re-exported here so
// existing `wallet-export.test.ts` imports keep resolving.
export {
  __getActiveLeaseTokenForTests,
  __resetWalletExportStateForTests,
} from "./wallet-export-clipboard-lease.js";
