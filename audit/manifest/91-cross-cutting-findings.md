## 4. Cross-cutting findings

| Finding | Evidence | Risk |
|---|---|---|
| Migration mirror drift confirmed | `src/vex-agent/db/migrations/029_swap_prequotes.sql` differs from `vex-app/resources/migrations/029_swap_prequotes.sql` | Packaged app can run stale/different migration semantics from runtime source expectations. |
| `runTool` approval bypass | `src/vex-agent/engine/core/run-tool.ts` builds context with `approved:true` | If exposed to renderer/untrusted callers, mutating tools could bypass approval. |
| Loose nested protocol param validation | `src/vex-agent/tools/protocols/runtime.ts`, `src/vex-agent/tools/protocols/types.ts` validate required primitive fields only | Extra keys/deep object payloads can reach protocol handlers. |
| Raw error-text leakage | `src/vex-agent/tools/protocols/runtime.ts`, `src/vex-agent/tools/internal/web.ts`, `src/vex-agent/inference/stream-consumer.ts`, OpenRouter mappers | Provider/tool errors can include URLs, request bodies, user content, or auth-sensitive details. |
| Missing production signing/release posture | `vex-app/electron-builder.yml`, `.github/workflows/ci.yml` | Current builder config is dev/test unsigned; no signed/notarized release workflow found. |
| Missing user-triggered updater UX/implementation | `vex-app/package.json`, `vex-app/electron-builder.yml`, `vex-app/src/shared/ipc/channels.ts` | Updater dependency/channels exist, but no full user-triggered check/download/install flow or renderer surface was found. |
| Plaintext Postgres password file | `vex-app/src/main/compose/electron-secret-adapter.ts`, `vex-app/src/main/compose/render.ts` | Compatibility tradeoff for Docker; must be excluded from renderer/logs/support and tracked as security debt. |
| Renderer local path exposure | `vex-app/src/main/ipc/docker.ts`, Compose DTOs, Docker installer result | `composeOutPath`, install IDs, and installer `artifactPath` can reveal local paths/identifiers to renderer. |
| Docker installer lacks explicit checksum/signature verification | `vex-app/src/main/docker/install.ts` | HTTPS/allowlist is not equivalent to artifact integrity verification. |
| Docker group command risk | `vex-app/src/main/docker/install.ts`, Linux manual UI | `sudo usermod -aG docker $USER` grants root-level Docker authority and needs clear user-facing risk. |
| DB fallback URL with credentials | `src/vex-agent/db/client.ts` | Static credential URL can leak through logs and conflicts with per-install secret posture. |
| Embedding endpoint can be configured remotely | `src/vex-agent/embeddings/config.ts`, `src/vex-agent/embeddings/client.ts` | Memory/tool/user text can be sent to remote embedding provider without explicit policy if misconfigured. |
| Soft delete does not imply erasure | `src/vex-agent/db/migrations/021_sessions_deleted_at.sql`, `src/vex-agent/db/repos/{search,recall-cache,tool-output-blobs}.ts` | Sensitive caches/captures/tool blobs/support/vault/backups can outlive user expectations. |
| Approval policy snapshot may not be live-enforced | `src/vex-agent/engine/core/approval-intent-preview.ts`, `src/vex-agent/engine/core/approval-runtime/post-tx.ts` | Stored `policy_json` may document context but not prevent changed-policy execution. |
| Solana/EVM retry semantics need audit | `src/tools/solana-ecosystem/shared/solana-transaction.ts`, EVM client config paths | Broadcast retries can conflict with no-auto-retry mutation policy unless idempotency is proven. |
| Provider hot-wallet implementation absent | Search across `src/vex-agent` found no backend signer/KMS/HSM/MPC path | Future provider-funded actions need separate backend signer boundary; do not assume current local app supports provider hot wallet safely. |
| Synthetic captures may bypass mutation matrix assumptions | `src/vex-agent/sync/synthetic-capture.ts`, capture pipeline | Synthetic writes still affect projections/audit records and need provenance rules. |
| Stale sync running recovery unclear | `src/vex-agent/sync/worker.ts`, sync repos | Crash/restart can stall long-running sync if `running` rows are not recovered. |
| Preload lacks output-result validation | `vex-app/src/preload/_dispatch.ts`, `vex-app/src/main/ipc/register-handler.ts` | Main validates output, but preload defense in depth is missing. |
| Reserved IPC channels without implementation | `vex-app/src/shared/ipc/channels.ts` | Updater/database/system reserved surfaces can confuse audit and increase accidental exposure risk. |
| Renderer secret-state policy unclear | `vex-app/src/renderer/features/secrets/UnlockScreen.tsx`, `KeystoreStep.tsx` | Failed password retention and RHF password watch need explicit policy. |
| `@vex-lib` renderer import exception needs allowlist | `vex-app/scripts/check-process-boundaries.mjs`, renderer wizard imports | Current imports are pure, but future alias use can erode process boundaries. |
| Large policy/security files | `swap-prequote.ts`, `dispatcher.ts`, `runtime.ts`, `post-tx.ts`, `compose/lifecycle.ts` | Policy ordering regressions become harder to audit as files grow. |

