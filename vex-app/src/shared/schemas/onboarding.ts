/**
 * Schema for `vex.onboarding.getEnvState()` — file-presence-only checks
 * (codex turn 3 RED #3). MUST NOT decrypt keystores or expose private
 * key material before the wallet-unlock flow. Wallet status is
 * deliberately reduced to `present | missing` rather than the richer
 * decrypt-tested status the post-unlock CLI helper returns.
 *
 * `embeddings` lives here (not in DockerStatus) because the endpoint is
 * user-configured via `EMBEDDING_BASE_URL` — it might be Docker Model
 * Runner, OpenRouter, or any custom OpenAI-compatible service.
 */

import { z } from "zod";

export const walletPresenceSchema = z.enum(["present", "missing"]);
export type WalletPresence = z.infer<typeof walletPresenceSchema>;

export const envStateSchema = z
  .object({
    hasKeystorePassword: z.boolean(),
    hasJupiterApiKey: z.boolean(),
    embeddings: z
      .object({
        configured: z.boolean(),
        reachable: z.boolean(),
        baseUrlRedacted: z.string().nullable(),
      })
      .strict(),
    walletStatus: z
      .object({
        evm: walletPresenceSchema,
        solana: walletPresenceSchema,
      })
      .strict(),
    setupCompleteFlag: z.boolean(),
  })
  .strict();

export type EnvState = z.infer<typeof envStateSchema>;
