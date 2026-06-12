/**
 * Builds the OpenRouter `responseFormat` for the memory-manager LLM judge
 * (F31, Layer B). Kept in the inference layer so the OpenRouter SDK type
 * (`ChatRequest`) stays contained here — the memory layer (`memory/manager/`)
 * never imports the SDK, it just hands this layer a JSON Schema and gets back a
 * typed, provider-shaped value (no cast at the call site).
 *
 * Pairs with `provider.requireParameters: true`, attached in
 * `OpenRouterProvider.chatCompletionSimple` when a `responseFormat` is present.
 */

import type { ChatRequest } from "@openrouter/sdk/models/chatrequest.js";

/** A JSON Schema object as produced by `z.toJSONSchema` — passed through to the API. */
export type JudgeJsonSchema = Record<string, unknown>;

/**
 * Wrap a judge JSON Schema in the `type:"json_schema"` (strict) response format.
 * `satisfies` gives a cast-free type check against the SDK union arm.
 */
export function buildJudgeResponseFormat(
  schema: JudgeJsonSchema,
): NonNullable<ChatRequest["responseFormat"]> {
  return {
    type: "json_schema",
    jsonSchema: {
      name: "judge_verdict",
      strict: true,
      description: "Memory-promotion judge verdict",
      schema,
    },
  } satisfies NonNullable<ChatRequest["responseFormat"]>;
}
