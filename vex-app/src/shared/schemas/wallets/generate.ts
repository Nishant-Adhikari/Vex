/**
 * walletGenerate{Evm,Solana} — generate a fresh keypair, encrypt with the
 * master password from M7. Result schemas carry only the public address.
 *
 * The Solana result reuses the PRIVATE `solanaAddressSchema` from
 * `./base-chain.js` (single source); the EVM result reuses the public
 * `evmAddressSchema`.
 */

import { z } from "zod";
import { evmAddressSchema, solanaAddressSchema } from "./base-chain.js";

// ── walletGenerate{Evm,Solana} ───────────────────────────────────────────
export const walletGenerateInputSchema = z.object({}).strict();

export const walletGenerateEvmResultSchema = z
  .object({ address: evmAddressSchema })
  .strict();
export type WalletGenerateEvmResult = z.infer<typeof walletGenerateEvmResultSchema>;

export const walletGenerateSolanaResultSchema = z
  .object({ address: solanaAddressSchema })
  .strict();
export type WalletGenerateSolanaResult = z.infer<typeof walletGenerateSolanaResultSchema>;
