### 2.16 Work Unit 16 — Solana/Jupiter protocols

#### Files & LOC

- `src/tools/solana-ecosystem/shared/solana-transaction.ts` 311 LOC — **god-file/refactor candidate**
- `src/tools/solana-ecosystem/jupiter/jupiter-prediction/prediction-api/schemas.ts` 537 LOC — **god-file/refactor candidate**
- `src/vex-agent/tools/protocols/solana-jupiter/handlers/core.ts` 177 LOC
- `src/vex-agent/tools/protocols/solana-jupiter/handlers/lend.ts` 86 LOC
- `src/vex-agent/tools/protocols/solana-jupiter/handlers/predict.ts` 263 LOC
- `src/tools/solana-ecosystem/jupiter/**`

#### Responsibility

- Jupiter/Solana swaps, lend/earn, prediction APIs.
- Solana transaction signing/submission helpers.
- Solana API schema validation.
- Solana protocol handlers under Vex protocol runtime.

#### Mechanisms/patterns

- Session wallet resolution before execution.
- Dry-run/quote flow before signing.
- Solana transaction assembly/signing/submission.
- Prediction/lend API calls with API key.
- Some staged submit paths.

#### Dependencies & data-flow

Entry points:

- Dispatcher -> protocol runtime -> Solana/Jupiter handler.
- Handler -> Jupiter API/Solana RPC.
- Mutation handler -> wallet resolution -> Solana signer -> RPC broadcast.

Imports/dependencies:

- Solana wallet/keystore.
- Jupiter protocol clients/schemas.
- Protocol runtime and capture.

Side effects:

- Solana RPC transaction broadcast.
- External Jupiter API calls.
- DB protocol execution/capture writes.

#### Security surface

- Solana secret keys.
- Solana transaction signing and submission.
- Jupiter API key.
- Network retry/duplicate-submit behavior.
- Associated token account creation can be a hidden side effect unless included in explicit transaction flow.

#### Hotspots

- `solana-transaction.ts` uses retry/maxRetries semantics that need idempotency audit.
- Prediction API schemas file 537 LOC.
- Solana transaction duplicate-send semantics require fresh verification.
- Solana/base58 private key redaction coverage should be verified.

`console.*` density:

- No high-density direct console cluster reported; audit `src/tools/solana-ecosystem/**` under global direct-console pass.

#### Tests

Covered:

- Jupiter/Solana tests under `src/tools/solana-ecosystem/jupiter/__tests__/**`.
- Protocol wallet scope/signing tests.
- Runtime taxonomy/completeness tests.

Not covered / unclear:

- Live Solana RPC duplicate-send behavior.
- Every mutation class idempotency.
- Full redaction of Solana errors and base58 secrets.
- End-to-end approval/sign/broadcast.

#### Open risks/smells

- Verify Solana RPC retry behavior against current docs.
- Prefer staged/no-auto-retry submit paths for mutations.
- Ensure hidden ATA side effects are explicit to user/approval preview.
- Add mutation-specific idempotency tests.

