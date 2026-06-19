### 2.9 Work Unit 9 — Observability, telemetry, support, redaction

#### Files & LOC

- `vex-app/src/main/logger/index.ts` 90 LOC
- `vex-app/src/main/logger/redact.ts` 90 LOC
- `vex-app/src/main/telemetry/sentry-lifecycle.ts` 195 LOC
- `vex-app/src/main/telemetry/before-send.ts` 130 LOC
- `vex-app/src/main/support/bug-report-service.ts` 184 LOC
- `src/lib/diagnostics/bug-report-schema.ts` modified
- `src/lib/diagnostics/text-redaction.ts`
- `src/lib/diagnostics/redactor.ts`
- `src/utils/logger.ts`
- `src/utils/logger-shim.ts`

#### Responsibility

- Main logger wraps Electron log with redaction and rotation.
- Telemetry is consent-gated and strips sensitive fields.
- Support service builds local bug reports/support bundles.
- Root runtime logger handles backend/runtime logs.
- Diagnostics redactors provide shared text/object redaction.

#### Mechanisms/patterns

- Electron main packaged console output disabled.
- File log rotation.
- Redaction of password, key, secret, token, auth, signature, wallet/address, keystore/cipher/tag/salt/nonce/iv/jwt patterns.
- Sentry consent gate, PII disabled, screenshots/locals disabled.
- Telemetry strips URLs/query/cookies/headers/request data.
- Renderer errors are reported with fixed event name and redacted extras.
- Deduplication of renderer reports.

#### Dependencies & data-flow

Entry points:

- Main boot configures logger.
- Renderer root error callbacks call support and telemetry bridge methods.
- Main handlers and agent bridge log errors.
- Support bug report service reads selected diagnostic data.

Imports/dependencies:

- Main logger used by Electron main modules.
- Runtime root logger used by `src/vex-agent` and protocol/client code.
- Diagnostics redactors should be reused in support/telemetry/log paths.

Side effects:

- Writes log files.
- Sends Sentry events if consented.
- Creates support bug report artifacts.
- Logs protocol/runtime/DB failures.

#### Security surface

- Logs/support/telemetry can leak secrets, wallet addresses, API URLs/query params, DB URLs, protocol request paths, or user content.
- Main redaction is stronger than some root runtime/protocol paths.
- Support bundle must exclude env, DB URL, vault files, keystores, raw memory, raw embeddings, private keys.

#### Hotspots

- `src/vex-agent/db/client.ts` fallback warning includes fallback DB URL with credentials.
- Protocol clients may log request `path`, including query params/user identifiers.
- `src/vex-agent/tools/protocols/runtime.ts` can return/log raw protocol error messages.
- `src/vex-agent/tools/internal/web.ts` can log/return raw web search failure messages.
- `src/vex-agent/inference/stream-consumer.ts` and OpenRouter mappers log raw malformed tool arg slices.
- `src/vex-agent/tools/protocols/discovery.telemetry.ts` defaults to raw query.
- `src/vex-agent/sync/prediction-settlement-sync.ts` logs wallet/proxy identifiers in warning paths.
- Some cleanup/teardown errors are swallowed.

`console.*` density:

- Global count is 37. Deep audit should classify each occurrence by runtime/test/script and ensure production paths use redacted loggers.

#### Tests

Covered:

- Main logger redaction tests.
- Telemetry before-send tests.
- Support tests.
- Diagnostics redaction tests.
- Renderer error reporting dedupe tests.

Not covered / unclear:

- Full raw-provider-error redaction tests.
- Support bundle exclusion proof for DB/vault/env/wallet artifacts.
- Discovery telemetry privacy default.
- Log redaction coverage for Solana/base58 private keys.

#### Open risks/smells

- Add targeted tests for raw protocol/web/inference error redaction.
- Default discovery telemetry to privacy-preserving mode or prove opt-in.
- Verify support bundles exclude all sensitive paths/data.
- Add diagnostics for silent cleanup without leaking secrets.

