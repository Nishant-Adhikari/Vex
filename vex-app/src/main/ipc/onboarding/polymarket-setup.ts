/**
 * vex.onboarding.polymarketAutoSetup — Phase 2 feature #7 IPC handler.
 *
 * One-click Polymarket setup: derive CLOB API credentials from the unlocked
 * EVM wallet keystore, then persist them inside the encrypted secret vault.
 * The renderer ships the user's master password (re-auth, sudo-style) plus
 * a `riskAcknowledged: true` hard literal and an `overwriteConfirmed`
 * boolean for the "credentials already exist" branch.
 *
 * Per-wallet (puzzle 5 B-UI): the renderer may pass `walletId` to target a
 * specific EVM wallet; omitted = the primary. The credentials are merged into
 * the per-address `POLYMARKET_CLOB_CREDENTIALS_BY_ADDRESS` map (primary ALSO
 * refreshes the 3 fixed legacy keys) via the shared `buildPolymarketVaultUpdates`.
 *
 * Flow per locked spec (Codex-approved):
 *   1. Schema validation runs automatically inside `registerHandler`.
 *   2. Vault session must be unlocked. The handler does NOT prompt for an
 *      unlock; the renderer is expected to gate the action behind
 *      `getSecretSessionStatus().unlocked`.
 *   3. Resolve the TARGET wallet from `input.walletId` (or primary). A null
 *      entry → `wallet.not_found`, FAIL CLOSED before re-auth/acquire/network.
 *      The renderer-supplied id is the authority — never a renderer address.
 *   4. Pre-network overwrite check (UX), PER SELECTED WALLET. If the selected
 *      wallet already has credentials (its lowercased address is in
 *      `getConfiguredPolymarketAddresses()`) and the renderer did NOT pass
 *      `overwriteConfirmed: true`, return `wallet.risk_confirmation_required`
 *      BEFORE any network call.
 *   5. Sudo-style re-auth via `verifySecretVaultPassword`. Wrong password →
 *      `wallet.password_invalid`. No session-state mutation, no KDF upgrade.
 *   6. Acquire credentials OUTSIDE the env-write lock, WITH the resolved entry
 *      (acquire asserts the keystore derives the entry's address before
 *      signing). Engine `VexError` codes map to public codes below.
 *   7. Persist UNDER `withEnvWriteLock` so this cannot interleave with
 *      keystoreSet / apiKeysSet / embeddingConfigure / agentCoreConfigure.
 *      A second PER-WALLET configured-probe runs INSIDE the lock to close the
 *      TOCTOU race against a concurrent vault write that landed between (4)
 *      and this point. The write keys are computed by the shared
 *      `buildPolymarketVaultUpdates` (map merge + primary-only fixed keys).
 *   8. Drop the credentials reference as soon as the write returns. JS
 *      strings are immutable so we can't zeroize the buffer — minimising
 *      lifetime is the strongest in-process defense.
 *   9. Audit log records the wallet address + correlationId only. NEVER
 *      the credentials, the walletId, or any prefix preview.
 *
 * Logging contract (mirrors Codex-locked api-keys logging rule):
 *   - log only `address=<X>` + `correlationId=<id>` on success
 *   - NEVER values, lengths, or prefix/suffix previews
 *
 * Structural note: the security-critical orchestration and its helpers now
 * live in the `./polymarket-setup/` sibling modules (errors / probe /
 * credentials / persist / register). This file stays the public façade —
 * `registerPolymarketSetupHandler` is re-exported unchanged.
 */

export { registerPolymarketSetupHandler } from "./polymarket-setup/register.js";
