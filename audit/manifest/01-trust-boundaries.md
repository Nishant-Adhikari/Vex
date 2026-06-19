## 1. Trust boundaries & security surface (global)

### 1.1 Renderer → preload

Untrusted input enters from:

- User UI forms and controls under `vex-app/src/renderer/features/**`
- App shell session composer and mission controls under `vex-app/src/renderer/features/appShell/**`
- Renderer API hooks under `vex-app/src/renderer/lib/api/**`
- Renderer direct bridge calls for secret-sensitive or subscription/cancelable flows.

Boundary files:

- `vex-app/src/renderer/vex.d.ts`: declares `window.vex` as `VexBridge`.
- `vex-app/src/preload/index.ts` 36 LOC: exposes one `window.vex` object.
- `vex-app/src/preload/_dispatch.ts` 139 LOC: validates payloads, generates request IDs, calls IPC, validates event payloads, handles abortable calls and subscriptions.
- `vex-app/src/preload/agent/**`, `vex-app/src/preload/shell/**`: domain method composers.

Validation:

- Preload validates request payloads with Zod where schemas are supplied.
- Preload validates event payloads before invoking renderer callbacks.
- Preload currently trusts main-side result validation and does not independently validate returned `Result<T>` objects.

Renderer persistence:

- `vex-app/src/renderer/stores/uiStore.ts` 154 LOC persists only `sidebarOpen`.
- Renderer grep found no direct `fetch`, `WebSocket`, `EventSource`, raw `ipcRenderer`, Node built-in import, or privileged Electron import in inspected paths.
- `@vex-lib` renderer imports currently point to pure config/constants helpers, but this alias needs exact allowlist enforcement.

### 1.2 Preload → main

Boundary files:

- `vex-app/src/shared/ipc/channels.ts` 294 LOC: IPC channel source of truth.
- `vex-app/src/shared/ipc/result.ts` 339 LOC: `Result<T>` and `VexError` shape.
- `vex-app/src/shared/ipc/envelope.ts` 19 LOC: request envelope.
- `vex-app/src/main/ipc/register-handler.ts` 377 LOC: handler registration and validation.
- `vex-app/src/main/ipc/register-all.ts` 106 LOC: centralized handler registration.

Main-side validation and protections:

- Sender must be top frame.
- Sender URL must be `app://vex` in packaged/prod or `http://127.0.0.1:5173` in dev.
- Request envelope is validated.
- Payload schema is validated.
- Success output schema is validated when supplied.
- Error object shape is validated and must be redacted.
- Extra error keys are rejected.
- Correlation IDs are attached.
- AbortController registry supports `vex:cancel`.
- Cleanup removes handlers.

### 1.3 Main → vex-agent runtime

Main privileged files:

- `vex-app/src/main/index.ts` 208 LOC: boot order, protocol, permissions, IPC, worker startup, Sentry, BrowserWindow.
- `vex-app/src/main/agent/**`: bridge from Electron main to agent runtime.
- `vex-app/src/main/ipc/chat.ts` 177 LOC: chat IPC entry.
- `vex-app/src/main/ipc/approvals.ts` 318 LOC: approval IPC entry.
- `vex-app/src/main/ipc/runtime/**`: runtime pause/stop/resume/cancel/wake paths.
- `vex-app/src/main/database/**`: main-owned DB connection and DTO repositories.
- `vex-app/src/main/secrets/**`: main-owned secret session.
- `vex-app/src/main/docker/**`, `vex-app/src/main/compose/**`: local service privilege.

Runtime entry files:

- `src/vex-agent/engine/ingress.ts` 198 LOC: user message entry/routing.
- `src/vex-agent/engine/core/runner/agent.ts` 164 LOC: agent turn runner.
- `src/vex-agent/engine/core/runner/mission-run.ts` 312 LOC: mission run lifecycle.
- `src/vex-agent/engine/core/turn-loop.ts` 383 LOC: core loop.
- `src/vex-agent/engine/core/turn-loop-tool-batch.ts` 413 LOC: tool batch and approval enqueue.
- `src/vex-agent/tools/dispatcher.ts` 478 LOC: tool dispatch and policy gate.
- `src/vex-agent/tools/protocols/runtime.ts` 415 LOC: protocol execution/approval/prequote/capture.

Main never gives renderer raw DB URL, DB password, Docker authority, wallet key, private key, or raw IPC authority.

### 1.4 vex-agent → wallet/RPC/external APIs

Wallet and signing files:

- `src/tools/wallet/keystore.ts` 213 LOC: encrypted EVM keystore.
- `src/tools/wallet/solana-keystore.ts` 96 LOC: Solana keystore.
- `src/tools/wallet/multi-auth.ts` 169 LOC: session/default wallet resolution.
- `src/tools/wallet/inventory.ts` 271 LOC: wallet inventory validation.
- `src/vex-agent/tools/internal/wallet/resolve.ts` 149 LOC: selected address/signing wallet resolution.
- `src/vex-agent/tools/internal/wallet/send.ts` 379 LOC: wallet intent prepare/confirm.
- `src/vex-agent/tools/internal/wallet/send-execute-evm.ts` 184 LOC: EVM execution.
- `src/vex-agent/tools/internal/wallet/send-execute-solana.ts` 211 LOC: Solana execution.
- `src/tools/wallet/polymarket-credentials.ts` 412 LOC: Polymarket credential derivation/storage.
- `src/tools/polymarket/auth.ts`: CLOB credential auth, no direct keystore import.

Patterns:

- Session wallet scope fails closed on missing selected wallet, deleted wallet, or address drift.
- `resolveSigningWallet` decrypts only after selection and policy validation.
- Wallet send confirm uses DB-backed wallet intents, TTL, CAS, status transitions, and idempotency key.
- Approval paths use structural-only error hashes to avoid raw error replay into transcript.
- Protocol handlers generally resolve signer after quote/dry-run gates.

Critical risk:

- `src/vex-agent/engine/core/run-tool.ts` 87 LOC directly invokes tools with `approved:true`. It is intentionally privileged and must never cross into renderer/untrusted access.

### 1.5 Secrets, keys, and signing authority locations

Secrets live in:

- `src/lib/secret-keys.ts` 30 LOC: managed secret key names.
- `src/lib/local-secret-vault.ts` 351 LOC: AES-256-GCM/scrypt encrypted vault and `.env` stripping.
- `vex-app/src/main/secrets/session.ts` 296 LOC: unlocked main-process secret session and env injection.
- `src/tools/wallet/keystore.ts` 213 LOC: local wallet private keys encrypted at rest.
- `src/tools/wallet/polymarket-credentials.ts` 412 LOC: address-scoped Polymarket CLOB credentials in encrypted vault.
- `vex-app/src/main/compose/render.ts` 159 LOC: generated DB password file path/rendering.
- `vex-app/src/main/compose/electron-secret-adapter.ts` 109 LOC: plaintext Postgres password file with restrictive mode.

Secrets that must not cross into renderer:

- OpenRouter, Jupiter, Tavily, Rettiwt, Polymarket credentials.
- Wallet private keys / Solana secret keys / mnemonic or seed material.
- Postgres DB password or `VEX_DB_URL`.
- Vault master password.
- Provider hot-wallet signing material.

Observed provider hot-wallet state:

- No provider hot-wallet signer/backend signer/KMS/HSM/MPC path was found in inspected `src/vex-agent` source.
- Current mutation paths use selected local user wallets.
- Future provider-funded/provider-signed actions require backend signer policy, idempotency, and audit boundaries.

### 1.6 Full IPC channel surface

Source: `vex-app/src/shared/ipc/channels.ts` 294 LOC.

Request surface by domain:

- `capabilities`
  - `get`
- `system`
  - `health`
  - `osInfo`
  - `network`
- `docker`
  - `detect`
  - `install`
  - `start`
  - `composeUp`
  - `composeDown`
- `database`
  - `migrate`
  - `status` reserved/found in channel surface; implementation exposure needs reconciliation.
- `secrets`
  - `status`
  - `unlock`
  - `lock`
- `wallet`
  - `exportPrivateKey`
- `onboarding`
  - provider, API-key, wallet import/restore, Polymarket setup, wizard-state operations.
- `sessions`
  - `create`
  - `list`
  - `get`
  - `setPinned`
  - `delete`
  - `getModel`
  - `plan*` operations in current working tree.
- `chat`
  - `submit`
- `messages`
  - `list`
  - `getTail`
  - `getAround`
- `runtime`
  - `getState`
  - `requestPause`
  - `requestStop`
  - `requestResume`
  - `cancelWake`
- `mission`
  - `get`
  - `update`
  - `start`
  - `continue`
  - `recover`
  - `renew`
  - `retry`
  - `edit`
  - `stop`
  - `setAutoRetry`
- `approvals`
  - `list`
  - `get`
  - `approve`
  - `reject`
  - `history`
- `wallets`
  - `list`
  - `set`
  - `getPreparedIntent`
  - `cancel`
- `models`
  - `list`
- `usage`
  - usage query surface.
- `compaction`
  - `get`
  - `list`
  - `retry`
- `knowledge`
  - `list`
  - `updateStatus`
- `memory`
  - `listSession`
  - `getStats`
- `settings`
  - `getPreferences`
  - `setTelemetryConsent`
- `updater`
  - `check` reserved; no full updater implementation found.
- `telemetry`
  - `reportRendererError`
- `support`
  - `createBugReport`
- `cancel`
  - abortable request cancellation.

Event surface:

- `system`
  - `logLine`
  - `resume`
- `docker`
  - `installProgress`
  - `daemonChanged`
  - `composeLogs`
- `database`
  - `migrateProgress`
- `updater`
  - `available` reserved; no full implementation found.
- `engine`
  - `transcriptAppend`
  - `controlState`
  - `streamDelta`

Open IPC risks:

- Reserved updater surface exists without implementation/renderer UX.
- `database.status` and some system event channels need reconciliation against actual handlers/preload exposure.
- Preload-side returned-result validation is absent as defense in depth.

### 1.7 External API and RPC surface

Config defaults and API clients found:

- Vex backend:
  - `https://backend.vexlabs.ai/api`
  - Source: `src/config/store.ts`
- Khalani / HyperStream:
  - `https://api.hyperstream.dev`
  - Sources: `src/tools/khalani/**`, `src/vex-agent/tools/protocols/khalani/**`
- DexScreener:
  - `https://api.dexscreener.com`
  - Sources: `src/tools/dexscreener/client.ts`, `src/tools/dexscreener/ws-client.ts`
- KyberSwap:
  - Aggregator/token/common/limit/Zap service URLs.
  - Sources: `src/tools/kyberswap/**`, `src/vex-agent/tools/protocols/kyberswap/**`
- Solana RPC:
  - `https://api.mainnet-beta.solana.com`
  - Sources: `src/config/store.ts`, `src/tools/solana-ecosystem/**`
- Jupiter:
  - Jupiter API clients under `src/tools/solana-ecosystem/jupiter/**`
  - Uses `x-api-key` for prediction/lend paths.
- Polymarket:
  - Gamma, CLOB, Data, Bridge, Relayer, WebSocket clients under `src/tools/polymarket/**`.
- OpenRouter:
  - `@openrouter/sdk`, model metadata, chat completions, streaming, key/balance metadata.
  - Source: `src/vex-agent/inference/openrouter.ts` 439 LOC.
- Tavily:
  - Web research path under `src/vex-agent/tools/internal/web.ts`.
- Raw HTTP:
  - Web fallback and protocol clients through `src/utils/http.ts`.
- Rettiwt / Twitter:
  - `src/tools/twitter-account/client.ts`.
- Local embeddings:
  - OpenAI-compatible `/embeddings` endpoint.
  - Default described as Docker/local model runner style endpoint.
  - Sources: `src/vex-agent/embeddings/config.ts`, `src/vex-agent/embeddings/client.ts`.
- Docker Desktop download:
  - `https://desktop.docker.com/...`
  - Source: `vex-app/src/main/docker/install.ts`.
  - Risk: no explicit checksum/signature verification found.
- Hugging Face model download:
  - Compose init container downloads GGUF and verifies SHA-256.
  - Source: `vex-app/resources/compose/docker-compose.template.yml`.

