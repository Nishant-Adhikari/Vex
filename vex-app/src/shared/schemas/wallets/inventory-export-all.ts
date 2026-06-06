/**
 * Multi-wallet inventory add/import/export (puzzle 5 phase 5D).
 *
 * Append (not overwrite) up to 3/family. `label` capped here (boundary) AND in
 * the engine inventory helper. Results carry no key material.
 */

import { z } from "zod";

// ── Multi-wallet inventory add/import/export (puzzle 5 phase 5D) ─────────────
export const walletAddInputSchema = z
  .object({ label: z.string().trim().max(120).optional() })
  .strict();
export type WalletAddInput = z.infer<typeof walletAddInputSchema>;

export const walletImportAddInputSchema = z
  .object({ rawKey: z.string().min(1), label: z.string().trim().max(120).optional() })
  .strict();
export type WalletImportAddInput = z.infer<typeof walletImportAddInputSchema>;

export const walletAddResultSchema = z
  .object({
    id: z.string().max(128),
    address: z.string().max(128),
    label: z.string().max(120),
  })
  .strict();
export type WalletAddResult = z.infer<typeof walletAddResultSchema>;

export const walletExportAllInputSchema = z.object({}).strict();
export type WalletExportAllInput = z.infer<typeof walletExportAllInputSchema>;

export const walletExportAllResultSchema = z
  .object({ files: z.array(z.string().max(256)).max(64) })
  .strict();
export type WalletExportAllResult = z.infer<typeof walletExportAllResultSchema>;
