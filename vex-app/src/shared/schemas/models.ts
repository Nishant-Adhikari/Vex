/**
 * Models schemas — provider/model picker contract.
 *
 * Puzzle 1 returns a single "configured global default" derived from
 * `AGENT_PROVIDER` + `AGENT_MODEL` in the engine `.env` (loaded into
 * `process.env` after vault unlock). No network call, no OpenRouter
 * `/models` catalogue, no pricing/context claims — those land in
 * puzzle 06 along with the per-session model migration.
 *
 * When the env vars are absent the read-only handler resolves to
 * `models: []` with `source: "unconfigured"`; it never errors. The UI
 * surfaces "Provider not configured" instead of an error toast.
 */

import { z } from "zod";

export const modelOptionDtoSchema = z
  .object({
    providerId: z.string().min(1).max(64),
    modelId: z.string().min(1).max(200),
    displayName: z.string().min(1).max(200),
    /**
     * Renderer-side brand identifier used by `ModelBrandIcon` /
     * `parseModelProvider`. Mapped from `providerId` in puzzle 1; the
     * OpenRouter catalogue mapper in puzzle 06 may widen this.
     */
    brand: z.string().min(1).max(64),
    /**
     * Context length in tokens. `null` in puzzle 1 — env-derived
     * defaults don't carry catalogue metadata and we deliberately
     * avoid guessing.
     */
    contextLength: z.number().int().positive().nullable(),
    /** USD per 1M input tokens. `null` in puzzle 1 (no catalogue fetch). */
    pricingInputPerMillion: z.number().nonnegative().nullable(),
    pricingOutputPerMillion: z.number().nonnegative().nullable(),
  })
  .strict();
export type ModelOptionDto = z.infer<typeof modelOptionDtoSchema>;

export const modelsListAvailableInputSchema = z.object({}).strict();
export type ModelsListAvailableInput = z.infer<
  typeof modelsListAvailableInputSchema
>;

/**
 * `source` tells the renderer where the list came from. Puzzle 1 only
 * emits `"global_default"` (env-derived single option) or
 * `"unconfigured"` (empty list). Puzzle 06 may add `"openrouter"` etc.
 */
export const modelsListSourceSchema = z.enum([
  "global_default",
  "unconfigured",
]);
export type ModelsListSource = z.infer<typeof modelsListSourceSchema>;

export const modelsListAvailableResultSchema = z
  .object({
    source: modelsListSourceSchema,
    models: z.array(modelOptionDtoSchema),
    fetchedAt: z.string().datetime({ offset: true }).nullable(),
  })
  .strict();
export type ModelsListAvailableResult = z.infer<
  typeof modelsListAvailableResultSchema
>;
