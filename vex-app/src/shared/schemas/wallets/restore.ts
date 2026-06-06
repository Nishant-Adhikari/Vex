/**
 * walletRestoreFromBackup — main opens dialog → user picks .json keystore →
 * main decrypts + verifies + mismatch-confirms + atomic-restores.
 *
 * Single-keystore restore (vs the full-archive restore in
 * `./backup-archive.js`). Reuses `chainSchema` from `./base-chain.js`.
 */

import { z } from "zod";
import { chainSchema } from "./base-chain.js";

// ── walletRestoreFromBackup ─────────────────────────────────────────────
// No `sourcePath` on the input — the file picker runs in main (single
// roundtrip per codex turn 8 answer #2). Renderer never sees local
// filesystem paths.
export const walletRestoreInputSchema = z
  .object({ chain: chainSchema })
  .strict();
export type WalletRestoreInput = z.infer<typeof walletRestoreInputSchema>;

// `replacedAddress` is the prior on-disk address that was overwritten
// (null on first-time restore where no keystore previously existed).
// `backupDir` is the path of the auto-backup created before overwriting
// (null when nothing existed to back up — codex turn 8 answer #3).
export const walletRestoreResultSchema = z
  .object({
    chain: chainSchema,
    address: z.string(),
    replacedAddress: z.string().nullable(),
    backupDir: z.string().nullable(),
  })
  .strict();
export type WalletRestoreResult = z.infer<typeof walletRestoreResultSchema>;
