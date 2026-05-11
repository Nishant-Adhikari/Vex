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
import { polymarketStatusSchema } from "./api-keys.js";

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

export const apiKeysStateSchema = z
  .object({
    jupiterConfigured: z.boolean(),
    tavilyConfigured: z.boolean(),
    rettiwtConfigured: z.boolean(),
    polymarketStatus: polymarketStatusSchema,
  })
  .strict();

export type ApiKeysState = z.infer<typeof apiKeysStateSchema>;

export const envStateSchema = z
  .object({
    hasKeystorePassword: z.boolean(),
    /**
     * Deprecated alias for `apiKeys.jupiterConfigured` kept for M2/M7
     * back-compat. M9 added the per-field `apiKeys` block; future
     * milestones may drop this field once all callers migrate.
     */
    hasJupiterApiKey: z.boolean(),
    apiKeys: apiKeysStateSchema,
    embeddings: z
      .object({
        configured: z.boolean(),
        reachable: z.boolean(),
        baseUrlRedacted: z.string().nullable(),
        /** M9: true iff all 4 EMBEDDING_* keys present + valid in .env. */
        allFieldsConfigured: z.boolean(),
        /**
         * M9: best-effort probe. `null` when the probe did not run /
         * timed out — UI must treat null as "unknown" and let the
         * write attempt surface the real status.
         */
        dbReachable: z.boolean().nullable(),
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
