/**
 * walletExportPrivateKey (Phase 2 feature #6).
 *
 * Sudo-style re-auth flow: user re-types the master password and must
 * explicitly acknowledge the risk before the handler decrypts a keystore
 * and routes the raw secret to the OS clipboard with a clear-on-expiry
 * lease. Reuses `chainSchema` from `./base-chain.js` and the shared
 * `PASSWORD_MIN_LENGTH` from the pure `../secrets.js`.
 */

import { z } from "zod";
import { PASSWORD_MIN_LENGTH } from "../secrets.js";
import { chainSchema } from "./base-chain.js";

// ── walletExportPrivateKey (Phase 2 feature #6) ────────────────────────
// Sudo-style re-auth flow: user re-types the master password and must
// explicitly acknowledge the risk before the handler decrypts a keystore
// and routes the raw secret to the OS clipboard with a clear-on-expiry
// lease. `riskAcknowledged: true` is a hard literal — schema rejects any
// other value at both ends of the IPC boundary so an accidental
// auto-tick / missing checkbox can never reach the decryption path.
export const walletExportPrivateKeyInputSchema = z
  .object({
    chain: chainSchema,
    /**
     * Which wallet to export (multi-wallet, up to 3/family). Main is the
     * authority: it resolves this id → inventory entry → keystore path and
     * verifies the decrypted key derives the recorded address. The renderer
     * NEVER sends the address as authority.
     */
    walletId: z.string().min(1).max(128),
    password: z.string().min(PASSWORD_MIN_LENGTH),
    riskAcknowledged: z.literal(true),
  })
  .strict();
export type WalletExportPrivateKeyInput = z.infer<
  typeof walletExportPrivateKeyInputSchema
>;

// Result deliberately does NOT echo the secret. The handler writes it to
// the OS clipboard inside main and tells the renderer "copied — will
// auto-clear in clearAfterMs". `format` reports how the secret was
// encoded so the renderer can describe what was placed on the clipboard.
export const walletExportPrivateKeyResultSchema = z
  .object({
    chain: chainSchema,
    format: z.enum(["hex", "base58"]),
    copied: z.literal(true),
    clearAfterMs: z.number().int().positive(),
  })
  .strict();
export type WalletExportPrivateKeyResult = z.infer<
  typeof walletExportPrivateKeyResultSchema
>;
