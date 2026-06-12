# Batch F — Judge Output-Format Enforcement (fixes F31) — Design (2026-06-12)

Source: 4-agent workflow (installed SDK surface, OpenRouter docs cross-model via
DeepResearch, Zod→JSON-Schema on the real judge schema, synthesis) + two facts the
parent VERIFIED by hand. Companion to `audit-findings-v2.md` F31 and the live
`eval-report-latest.md` (judge output-valid rate 33–67% with deepseek-v4-flash).

## Verified ground truth (not from memory)
- Installed `@openrouter/sdk@0.12.79` natively supports `ChatRequest.responseFormat`
  (wire `response_format`), a 5-arm union incl. `ChatFormatJsonSchemaConfig =
  { type:"json_schema", jsonSchema:{ name, strict?, schema?, description? } }`, and
  `ChatRequest.provider?: ProviderPreferences` with `requireParameters?`
  (wire `require_parameters`) + `allowFallbacks?`. The SDK auto-serializes camelCase→wire.
- Installed `zod@4.3.6` ships native `z.toJSONSchema`. **VERIFIED locally:**
  `z.toJSONSchema(schema, { io:"input" })` → `additionalProperties:false`, and `required`
  contains only the non-optional/non-default fields (the SHAPE the model must SEND).
  `.nullish()` accepts `null`, absent, AND a value — **VERIFIED**.
- **VERIFIED via the live OpenRouter catalog:** `deepseek/deepseek-v4-flash` AND
  `deepseek/deepseek-v4-pro` both list `response_format`, `structured_outputs`, AND
  `tools` in `supported_parameters`. So the exact F31 model honors Rung 1.
- Today the judge call is **prompt-only** (`chatCompletionSimple` passes NO
  `response_format`) — there is zero API-level format enforcement. That, plus the strict
  Zod parse rejecting the model's placeholder `null`s, is F31.

## Recommended design — TWO layers, shipped together

### Layer A (load-bearing, survives ANY model) — null-tolerant Zod gate
The authoritative semantic gate stays in Zod and is made tolerant of placeholder nulls.
In `memory/manager/judge-schema.ts`:
- `previousKnowledgeId: z.number().int().positive().nullish()`
- `rejectReason: memoryDecisionRejectReasonSchema.nullish()`
- `regimeTags: z.array(regimeTagSchema).max(REGIME_TAGS.length).nullish().transform(v => v ?? [])`
- Widen the two `.refine()` guards from `!== undefined` to `(!== undefined && !== null)` so a
  `null` placeholder is treated as "absent" — the cross-field requirements (supersede⇒prevId,
  reject/expire⇒reason) STILL fire.
**Why load-bearing:** `.refine()` does NOT survive `toJSONSchema` (the conditional requireds
are dropped), and strict mode cannot express them — so Zod must remain the real validator.
**Fail-closed preserved:** only `=== undefined` is widened to include `null`; supersede+null,
reject+null, and out-of-enum rejectReason are STILL rejected (verified against the real schema
by the synthesis run). This alone stops the F31 bleed regardless of transport.

### Layer B (raise the floor where the model supports it) — API-level shape enforcement
Thread an OpenRouter `responseFormat` of `type:"json_schema"` built from
`z.toJSONSchema(judgeVerdictSchema, { io:"input" })` (cached at module load), paired with
`provider:{ requireParameters:true }` so the judge routes ONLY to endpoints that honor the
format and **fails loud** (job retries) instead of silently returning prose. `allowFallbacks`
stays default true → a provider OUTAGE still falls back, but only among honoring endpoints.

## Fallback ladder (documented escalation, not runtime auto-negotiation)
- **Rung 0 (always on):** Layer A null-tolerant Zod — the universal floor.
- **Rung 1 (SHIP, default):** `json_schema` strict + `requireParameters:true`. Lands on
  deepseek-v4-flash/-pro (verified) and any model advertising `structured_outputs`.
- **Rung 2 (one-line config swap, only if monitoring shows json_schema routing failures):**
  `{ type:"json_object" }` — valid JSON, no shape enforcement; Layer A + brace-slice + Zod
  still catch shape.
- **Rung 3 (documented future):** forced tool-calling (`tool_choice` a single `emit_verdict`
  fn whose params is the same schema) — widest hard-JSON guarantee; reuses the with-tools path.
- **Rung 4 (today's failure floor):** prompt-only = F31. Rung 0 makes even this survivable.

## Concrete wiring (4 additive edits; the 4 non-judge callers stay byte-identical)
1. `memory/manager/judge-schema.ts`: Layer A (above) + export
   `judgeVerdictJsonSchema = z.toJSONSchema(judgeVerdictSchema, { io:"input" })` (cached).
2. `inference/openrouter/params.ts` `buildOpenRouterParams`: add 5th optional param
   `responseFormat?: ChatRequest["responseFormat"]`, spread it conditionally (mirror the
   existing `reasoning` spread) — no new import, no cast.
3. `inference/openrouter.ts` `chatCompletionSimple` (+ `types.ts` `JudgeProvider`-adjacent
   interface): add 3rd optional `responseFormat?` param; pass through; when present, also set
   `provider:{ requireParameters:true }` on the send.
4. `memory/manager/judge.ts` `callJudge`: build the format object once
   (`{ type:"json_schema", jsonSchema:{ name:"judge_verdict", strict:true, description, schema:
   judgeVerdictJsonSchema } }`) and pass as the new arg.
The 4 other `chatCompletionSimple` callers (chunker, regime-worker, entity-extraction,
reconcile-judge) pass nothing new → identical wire request.

## Timeout (orthogonal — do NOT bundle into the F31 fix)
`JUDGE_TIMEOUT_MS = 30_000` < the observed 38–56s deepseek-v4-flash latency on the big judge
prompt; strict decoding only ADDS latency, so format enforcement cannot fix a timeout. Track
separately: (a) raise the cap, (b) `provider:{ sort:"latency" }` / latency gate, (c) trim the
judge prompt. Decide with fresh latency measurement under strict mode.

## Scope / tests / unchanged
- **Touched:** judge + judge-schema (Layer A+B); `chatCompletionSimple`/params/types gain one
  optional param each.
- **Same-class vulnerability (follow-up PR, NOT this one):** `reconcileVerdictSchema.sourceTier`
  (`reconcile-policy.ts`) and several `entity-extraction-schema.ts` optionals have the identical
  `null`-placeholder exposure — apply the same `.nullish()` pattern; extract a `nullishOptional`
  helper once 3+ schemas need it (rule-of-three). chunker schema is safe (defaults coerce).
- **Tests (lockstep, focused):** judge-schema cases — F31 promote+double-null PARSES, null
  regimeTags→[], supersede+null-prevId REJECTED, reject/expire+null-reason REJECTED,
  out-of-enum REJECTED; JSON-schema export pins `required` + `additionalProperties:false`;
  params test proves no-responseFormat → no `responseFormat`/`provider` keys (the 4 callers
  unchanged) and with-it → the format + `requireParameters:true`. Plus the LIVE eval
  re-run: judge output-valid rate should jump toward ~100%.
- **Unchanged (invariants):** fail-closed (throw on malformed, no promoting fallback); closed
  enums stay authoritative in Zod; brace-slice; verdict→decision mapping; `merge` exclusion.

## Open decisions for the owner
1. **`requireParameters:true` failure surface.** It makes the judge ERROR loudly (job retries)
   if no endpoint honors the format, instead of silently degrading to prose. That is the
   intended, safer fail-closed behavior — confirm you accept "loud retry" over "silent bad
   verdict" on a config drift to a non-supporting model.
2. **strict:true vs json_object for Rung 1.** Ship strict:true (Layer A absorbs the nulls it
   induces; the live catalog says the model supports it); drop to json_object only if
   monitoring shows routing failures. Confirm the production `AGENT_MODEL` (the judge reuses
   it) is on the structured_outputs list — re-verify at merge time since it is config-driven.
3. **Timeout** (separate decision): raise cap vs latency-route vs trim prompt — needs a fresh
   strict-mode latency measurement.
4. **Anthropic caveat:** if `AGENT_MODEL` ever becomes a Claude model, OpenRouter strips strict
   unless a dated structured-outputs header is sent — flag for future model swaps.
5. **Follow-up PR** for the reconcile/entity-extraction same-class nullish fix — separate, not
   bundled.
