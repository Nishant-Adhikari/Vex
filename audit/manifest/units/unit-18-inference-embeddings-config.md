### 2.18 Work Unit 18 — Inference, embeddings, env/config

#### Files & LOC

- `src/vex-agent/inference/openrouter.ts` 439 LOC — **god-file/refactor candidate**
- `src/vex-agent/inference/config.ts` 187 LOC
- `src/vex-agent/inference/registry.ts` 155 LOC
- `src/vex-agent/inference/stream-consumer.ts` 288 LOC
- `src/vex-agent/inference/resilience.ts` 105 LOC
- `src/vex-agent/embeddings/client.ts` 222 LOC
- `src/vex-agent/embeddings/config.ts` 107 LOC
- `src/config/store.ts`
- `src/lib/agent-config.ts`
- `src/lib/embedding-constants.ts`
- `src/lib/polymarket.ts`
- `src/utils/http.ts`
- `src/utils/dotenv.ts`
- `vex-app/src/renderer/features/wizard/steps/EmbeddingStep.tsx` 394 LOC — **god-file/refactor candidate**

#### Responsibility

- Configure and call OpenRouter inference.
- Stream model outputs and tool call deltas.
- Configure and call embedding provider.
- Store app/runtime config defaults.
- Parse env/settings for providers/subagents.
- Provide HTTP/schema helper utilities.

#### Mechanisms/patterns

- Provider registry caches provider with reset on secret lock.
- OpenRouter model metadata cache with stale last-good fallback.
- Streaming tool-call delta parsing.
- Retry/timeout resilience helpers.
- Embedding response shape and dimension validation.
- Embedding logs input character count, not raw text.
- Config validators for numeric ranges/env fields.
- `.env` atomic writes and managed secret cleanup.

#### Dependencies & data-flow

Entry points:

- Engine turn loop calls inference registry/provider.
- Memory/knowledge/tool embedding flows call embedding client.
- Onboarding provider/embedding steps set config/secrets.
- Secret lock resets provider.

Imports/dependencies:

- OpenRouter SDK.
- Local secret/env config.
- Embedding constants.
- HTTP utility for schema-validated JSON.

Side effects:

- External OpenRouter API calls.
- Local/remote embedding endpoint calls.
- Config/env file writes.
- Provider cache mutation.
- Logs retry/model metadata events.

#### Security surface

- OpenRouter API key.
- Model prompts/transcripts can include sensitive content.
- Embedding inputs can include memory/tool/user content.
- Embedding endpoint is configurable; remote use is a data exfiltration risk unless explicitly opt-in.
- Malformed tool arg logging can leak raw slices.

#### Hotspots

- `openrouter.ts` 439 LOC.
- `EmbeddingStep.tsx` 394 LOC.
- Raw malformed tool args logged in `stream-consumer.ts`/OpenRouter mappers.
- OpenRouter SDK retry behavior should be freshly verified.
- Config file load/save logs full paths.

`console.*` density:

- Runtime uses logger utilities. Direct console hits in config/scripts should be classified.

#### Tests

Covered:

- Inference provider tests.
- Stream consumer tests.
- Embeddings client tests.
- Config/env tests.
- Renderer embedding/provider step tests.

Not covered / unclear:

- Live OpenRouter SDK behavior as of current version. (ADDRESSED: bumped to `@openrouter/sdk` 0.12.79 and re-verified.)
- Remote embedding provider opt-in UX/policy.
- Raw provider error redaction. (ADDRESSED in `fix(inference)`: `errors.ts`/`stream-consumer` now surface only status + code + a scrubbed message; classifier-drift bug fixed.)
- Model metadata drift handling under all failures.

#### Open risks/smells

- Add explicit remote embedding policy.
- Redact malformed tool args/provider errors.
- Split OpenRouter provider by metadata, streaming, mapping, balance.
- Verify retry semantics with official current docs.

