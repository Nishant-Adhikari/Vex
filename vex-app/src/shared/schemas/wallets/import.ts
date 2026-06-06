/**
 * walletImport{Evm,Solana} — accept a user-supplied raw private key
 * (EVM hex / Solana base58 or JSON array), encrypt + persist.
 *
 * The import result schemas are alias re-exports of the generate result
 * schemas (`./generate.js`) — preserving the original alias-export identity
 * (`walletImportEvmResultSchema === walletGenerateEvmResultSchema`).
 */

import { z } from "zod";
import {
  walletGenerateEvmResultSchema,
  walletGenerateSolanaResultSchema,
  type WalletGenerateEvmResult,
  type WalletGenerateSolanaResult,
} from "./generate.js";

// ── walletImport{Evm,Solana} ─────────────────────────────────────────────
// rawKey is a secret. Min length is the only schema-side check; full format
// validation lives in main via `normalizePrivateKey()` (EVM) and
// `normalizeSolanaSecretKey()` (Solana auto-detect JSON-array vs base58).
// Renderer MUST clear the source DOM input + form state synchronously
// after a single async submit — see SKILL §14.
export const walletImportEvmInputSchema = z
  .object({ rawKey: z.string().min(1, "Private key required.") })
  .strict();
export type WalletImportEvmInput = z.infer<typeof walletImportEvmInputSchema>;

export const walletImportSolanaInputSchema = z
  .object({ rawKey: z.string().min(1, "Secret key required.") })
  .strict();
export type WalletImportSolanaInput = z.infer<typeof walletImportSolanaInputSchema>;

export const walletImportEvmResultSchema = walletGenerateEvmResultSchema;
export type WalletImportEvmResult = WalletGenerateEvmResult;

export const walletImportSolanaResultSchema = walletGenerateSolanaResultSchema;
export type WalletImportSolanaResult = WalletGenerateSolanaResult;
