### 2.15 Work Unit 15 — EVM protocols: Khalani, KyberSwap, Polymarket

#### Files & LOC

- `src/tools/khalani/validation.ts` 633 LOC — **god-file/refactor candidate**
- `src/vex-agent/tools/protocols/khalani/handlers/bridge.ts` 229 LOC
- `src/tools/kyberswap/KyberSwap.md` 576 LOC — **large protocol doc**
- `src/vex-agent/tools/protocols/kyberswap/handlers/swap.ts` 287 LOC
- `src/vex-agent/tools/protocols/kyberswap/handlers/limit-order.ts` 364 LOC — **god-file/refactor candidate**
- `src/vex-agent/tools/protocols/kyberswap/handlers/zap.ts` 397 LOC — **god-file/refactor candidate**
- `src/tools/polymarket/Polymarket.md` 620 LOC — **large protocol doc**
- `src/vex-agent/tools/protocols/polymarket/handlers-clob.ts` 441 LOC — **god-file/refactor candidate**
- `src/vex-agent/tools/protocols/polymarket/manifests/gamma.ts` 460 LOC — **god-file/refactor candidate**
- `src/vex-agent/tools/protocols/polymarket/manifests/clob.ts` 412 LOC — **god-file/refactor candidate**
- `src/tools/polymarket/clob/client.ts` 365 LOC — **god-file/refactor candidate**
- `src/tools/polymarket/clob/validation.ts` 383 LOC — **god-file/refactor candidate**

Tests:

- `src/__tests__/vex-agent/tools/kyberswap-handlers.test.ts` 841 LOC — **test god-file**
- Khalani/Polymarket/Kyber protocol tests under `src/__tests__/vex-agent/tools/**` and `src/__tests__/tools/**`.

#### Responsibility

- Khalani: bridge/balance/quote/order and EVM/Solana bridge execution paths.
- KyberSwap: swaps, limit orders, Zap, aggregator/token/common clients.
- Polymarket: Gamma/CLOB/Data/Bridge/Relayer market and order flows.
- Protocol handlers bridge manifest runtime to protocol clients/signing.

#### Mechanisms/patterns

- Quote/dry-run before decrypt/sign/broadcast.
- Session wallet address validation.
- EIP-712 signing for some order paths.
- CLOB credentials separated from wallet keystore.
- Zod/manual validators for external responses.
- Prequote gate for execute paths.
- Action taxonomy and approval gating.

#### Dependencies & data-flow

Entry points:

- Dispatcher -> protocol runtime -> protocol handler.
- Protocol handler -> protocol client -> external API/RPC.
- For mutations, handler -> wallet resolution -> signer -> API/RPC broadcast.
- Capture pipeline records execution/projection.

Imports/dependencies:

- `src/tools/{khalani,kyberswap,polymarket}/**`
- Wallet resolution helpers.
- Protocol runtime/prequote/capture.
- Config/env/API key helpers.

Side effects:

- External API calls.
- EVM RPC transaction broadcast.
- EIP-712 signing.
- DB protocol execution/capture writes.
- Polymarket credential creation/storage in setup path.

#### Security surface

- EVM private keys.
- Polymarket API credentials/passphrase/secret.
- EIP-712 signature authority.
- Protocol request/response validation.
- Slippage/quote/prequote safety.
- Raw provider/API errors may include sensitive request context.

#### Hotspots

- Validation files are large and protocol-specific.
- Handler files concentrate quote/dry-run/sign/broadcast ordering.
- Polymarket CLOB handler 441 LOC.
- Kyber Zap/limit-order handlers near/above threshold.
- Protocol response validation style is inconsistent across clients.
- Request `path` logging can include query params/user identifiers.
- Provider hot-wallet functionality absent; future provider-funded EVM flows need separate backend signer.

`console.*` density:

- Protocol clients should avoid direct console. Audit any direct logging under `src/tools/**` and `src/vex-agent/tools/protocols/**`.

#### Tests

Covered:

- Kyber handler tests.
- Polymarket wallet scope tests.
- Khalani bridge wallet scope tests.
- Protocol taxonomy/completeness.
- Signer import allowlist.
- Prequote gate tests.

Not covered / unclear:

- Live external API contract drift.
- Redaction of all protocol API error bodies.
- End-to-end approval/sign/broadcast path.
- Strict schema rejection of unknown nested params.

#### Open risks/smells

- Audit every EVM protocol mutation for approval → wallet scope → dry-run/prequote → decrypt → sign/broadcast order.
- Normalize validation/error style.
- Add tests for redacted external API failures.
- Verify retry/idempotency semantics for viem/EVM clients.

