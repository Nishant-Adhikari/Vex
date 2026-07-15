/**
 * Schemas for `vex.onboarding.providerPersist` — Wizard Step 6 (M10).
 *
 * Single IPC that does verify-then-persist atomically (codex turn 2
 * RED #1): handler tests the OpenRouter key+model via a 1-shot chat
 * completion, then stores OPENROUTER_API_KEY in the encrypted vault
 * and writes non-secret AGENT_MODEL + AGENT_PROVIDER=openrouter to
 * `.env`. If verify fails, no persist happens.
 *
 * Input validation:
 *   - `.trim().min(1).max(200)` for apiKey + model (codex turn 1 RED #4
 *     — whitespace-only bypass on plain `.min(1)`).
 *   - `provider` literal "openrouter" only.
 *
 * Output:
 *   - `fieldsWritten` in canonical order (matches engine resolution
 *     precedence in `src/vex-agent/inference/registry.ts:41-108` —
 *     explicit AGENT_PROVIDER overrides fallback).
 *   - `verifiedLatencyMs` from the verify step, surfaced in the
 *     success card.
 */

import { z } from "zod";

export const providerNameSchema = z.enum(["openrouter"]);
export type ProviderName = z.infer<typeof providerNameSchema>;

const trimmedSecret = z.string().trim().min(1).max(200);

/**
 * Optional SECONDARY / fallback provider (issue #25). Coexists with the
 * primary: the engine tries the primary first and, on a transient failure that
 * survives backoff, fails over to this one for that call. Both live in config;
 * omit `fallback` (or leave it undefined) for the original single-provider
 * behavior. When present, BOTH fields are required (a key with no model, or a
 * model with no key, can't form a usable provider).
 */
const fallbackProviderSchema = z
  .object({
    apiKey: trimmedSecret,
    model: trimmedSecret,
  })
  .strict();

export type FallbackProviderInput = z.infer<typeof fallbackProviderSchema>;

export const providerPersistInputSchema = z
  .object({
    provider: z.literal("openrouter"),
    apiKey: trimmedSecret,
    model: trimmedSecret,
    fallback: fallbackProviderSchema.optional(),
  })
  .strict();

export type ProviderPersistInput = z.infer<typeof providerPersistInputSchema>;

/**
 * Canonical fields reported by `providerPersist` (M10). Order
 * matches the deterministic persist order in `provider-writer.ts`.
 * Engine resolution precedence (`registry.ts:41-108`):
 *   1. Explicit `AGENT_PROVIDER` value
 *   2. `OPENROUTER_API_KEY` + `AGENT_MODEL` present → openrouter
 * The API key is stored in the encrypted vault; provider/model selection
 * stays in `.env` so the GUI's wizard choice is unambiguous even when
 * stale `AGENT_PROVIDER` lines exist from manual edits.
 */
export const PROVIDER_PERSIST_CANONICAL_ORDER = [
  "OPENROUTER_API_KEY",
  "AGENT_MODEL",
  "AGENT_PROVIDER",
  // Secondary/fallback provider (issue #25) — reported in `fieldsWritten` ONLY
  // when a fallback was supplied. The fallback key rides the same encrypted
  // vault as the primary; the model id is a non-secret `.env` value.
  "OPENROUTER_API_KEY_FALLBACK",
  "AGENT_MODEL_FALLBACK",
] as const;

export const providerPersistFieldNameSchema = z.enum(
  PROVIDER_PERSIST_CANONICAL_ORDER,
);

export const providerPersistResultSchema = z
  .object({
    fieldsWritten: z.array(providerPersistFieldNameSchema).readonly(),
    verifiedLatencyMs: z.number().int().nonnegative(),
  })
  .strict();

export type ProviderPersistResult = z.infer<typeof providerPersistResultSchema>;
