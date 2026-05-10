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

// M8: public addresses sourced from `config.json` so the wizard can
// display them across sessions without the renderer needing to talk to
// the keystore. NULL when the config has no address for that chain.
// Optional on the schema so existing M2/M7 tests + envState handling
// keep parsing without changes.
export const walletAddressesSchema = z
  .object({
    evm: z.string().nullable(),
    solana: z.string().nullable(),
  })
  .strict();

export type WalletAddresses = z.infer<typeof walletAddressesSchema>;

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
    walletAddresses: walletAddressesSchema.optional(),
    setupCompleteFlag: z.boolean(),
  })
  .strict();

export type EnvState = z.infer<typeof envStateSchema>;
