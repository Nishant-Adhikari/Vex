## 5. Top refactor candidates (god-files) sorted by LOC

Lockfiles and binary assets are excluded from this table as non-code refactor candidates. Large tests are included because they affect auditability and regression maintenance.

| File | LOC | Why it is a refactor candidate |
|---|---:|---|
| `vex-app/src/renderer/features/appShell/__tests__/AppShell.test.tsx` | 1,447 | Test god-file covering broad app-shell behavior; difficult to scan and maintain. |
| `src/vex-agent/tools/protocols/swap-prequote.ts` | 1,316 | Central fail-closed prequote safety logic; mixes identity, gate, recorder, and classification responsibilities. |
| `src/__tests__/vex-agent/engine/core/turn-loop.test.ts` | 1,311 | Large turn-loop regression suite; important but hard to target. |
| `vex-app/src/renderer/components/dotmatrix-loader.css` | 1,121 | Large visual/CSS file; high maintenance cost for UI changes. |
| `src/__tests__/vex-agent/tools/protocols/swap-prequote.test.ts` | 1,012 | Large safety test suite; may need split by gate/identity/recording behavior. |
| `src/__tests__/integration/memory/long-mission.test.ts` | 1,003 | Large integration test; broad memory/mission behavior. |
| `vex-app/src/renderer/components/ui/dotmatrix-core.tsx` | 960 | Large visual component; likely multiple concerns. |
| `vex-app/src/main/ipc/onboarding/__tests__/polymarket-setup.test.ts` | 921 | Large sensitive onboarding test; split by credential/setup scenario. |
| `vex-app/src/main/ipc/__tests__/wallet-export.test.ts` | 881 | Large private-key export test; security-critical scenarios could be grouped. |
| `src/__tests__/vex-agent/tools/kyberswap-handlers.test.ts` | 841 | Large protocol handler suite; split by swap/limit/zap behavior. |
| `src/__tests__/vex-agent/engine/core/approval-runtime.test.ts` | 832 | Large approval runtime suite; split by approve/reject/TTL/post-tx. |
| `vex-app/src/main/ipc/onboarding/__tests__/wallets.test.ts` | 829 | Large wallet onboarding test; sensitive restore/import scenarios. |
| `vex-app/src/main/compose/lifecycle.ts` | 821 | High-blast-radius Docker/Compose lifecycle file mixing preflight, render, up/down, health, recovery. |
| `src/__tests__/vex-agent/engine/core/runner.test.ts` | 821 | Large runner suite; mission lifecycle tests should be segmented. |
| `src/tools/wallet/backup-restore.ts` | 722 | Crypto-sensitive backup/restore logic concentrated in one file. |
| `vex-app/src/main/ipc/onboarding/wallets.ts` | 704 | Sensitive wallet onboarding IPC god-file. |
| `vex-app/src/main/database/sessions-db.ts` | 684 | Large main-side DB repository; broad query responsibility. |
| `src/__tests__/vex-agent/tools/protocols/bridge-prequote.test.ts` | 683 | Large bridge safety test; split by verdict/gate/capture. |
| `vex-app/src/main/ipc/__tests__/register-handler.test.ts` | 681 | Large IPC boundary test; split sender/envelope/output/error/cancel scenarios. |
| `src/tools/khalani/validation.ts` | 633 | Large protocol validation file; hard to audit response schemas. |
| `src/tools/polymarket/Polymarket.md` | 620 | Large protocol documentation; maintainability and drift risk. |
| `src/__tests__/vex-agent/engine/telemetry-events.test.ts` | 613 | Large telemetry event test; likely multiple domains. |
| `src/vex-agent/tools/protocols/embeddings/polymarket/clob.ts` | 604 | Large protocol embedding/catalog file; split by resource/type. |
| `vex-app/src/main/ipc/__tests__/ipc-handler-surface.test.ts` | 600 | Large surface test; split by domain/registration class. |
| `src/__tests__/vex-agent/tools/internal/wallet/send.test.ts` | 588 | Large wallet-intent/send test; split by prepare/confirm/EVM/Solana/failure. |
| `src/tools/kyberswap/KyberSwap.md` | 576 | Large protocol documentation; drift risk. |
| `src/tools/dexscreener/validation.ts` | 562 | Large validator file; schema complexity. |
| `vex-app/src/main/database/messages-db.ts` | 558 | Large main DB repository; broad message query behavior. |
| `src/vex-agent/tools/protocols/embeddings/polymarket/gamma.ts` | 556 | Large protocol embedding/catalog file. |
| `src/tools/solana-ecosystem/jupiter/jupiter-prediction/prediction-api/schemas.ts` | 537 | Large external API schema file; validation complexity. |
| `vex-app/src/main/ipc/onboarding/polymarket-setup.ts` | 520 | Sensitive Polymarket setup IPC logic. |
| `src/vex-agent/db/migrations/001_initial.sql` | 504 | Large initial schema; broad sensitive DB surface. |
| `src/vex-agent/scripts/cross-lingual-benchmark.ts` | 500 | Large script; isolate benchmark concerns if maintained. |
| `vex-app/scripts/check-build-artifacts.mjs` | 499 | Build/security gate script mixing CSP, protocol, Compose, migrations. |
| `vex-app/src/renderer/features/wizard/steps/ApiKeysStep.tsx` | 491 | Sensitive API-key setup UI with substantial logic. |
| `src/vex-agent/tools/dispatcher.ts` | 478 | Central tool policy dispatcher; ordering regressions are high risk. |
| `vex-app/src/shared/schemas/wallets.ts` | 465 | Large wallet schema contract; boundary-critical. |
| `src/vex-agent/db/repos/session-memories/crud.ts` | 465 | Large memory CRUD repo for sensitive local data. |
| `src/vex-agent/tools/protocols/polymarket/manifests/gamma.ts` | 460 | Large protocol manifest; drift/routing risk. |
| `vex-app/src/main/database/bug-reports-db.ts` | 447 | Large support-report DB repo; sensitive data retention risk. |
| `src/vex-agent/tools/protocols/polymarket/handlers-clob.ts` | 441 | CLOB signing/credential/order handler; security-critical. |
| `src/vex-agent/inference/openrouter.ts` | 439 | Large provider implementation; streaming/metadata/error/retry concerns. |
| `src/vex-agent/scripts/cross-lingual-benchmark-dataset.ts` | 431 | Large script/dataset helper; maintainability. |
| `src/vex-agent/engine/core/approval-runtime/post-tx.ts` | 428 | Complex post-approval execution ordering. |
| `src/vex-agent/engine/wake/executor.ts` | 425 | Long-lived wake executor; cleanup/retry sensitive. |
| `src/tools/wallet/backup.ts` | 421 | Wallet backup logic; crypto-sensitive. |
| `vex-app/src/renderer/features/appShell/SessionRows.tsx` | 416 | Large app-shell UI component. |
| `src/vex-agent/tools/protocols/runtime.ts` | 415 | Central protocol execution/approval/prequote/capture runtime. |
| `vex-app/src/renderer/features/wizard/steps/wallets/RestoreFromArchive.tsx` | 414 | Sensitive wallet restore UI. |
| `src/vex-agent/engine/core/turn-loop-tool-batch.ts` | 413 | Tool batch and approval enqueue logic. |
| `src/tools/wallet/polymarket-credentials.ts` | 412 | Wallet decrypt + CLOB credential persistence. |
| `src/vex-agent/tools/protocols/polymarket/manifests/clob.ts` | 412 | Large CLOB manifest. |
| `vex-app/src/renderer/features/wallets/ExportPrivateKeyModal.tsx` | 392 | Sensitive private-key export UI. |
| `src/vex-agent/tools/protocols/kyberswap/handlers/zap.ts` | 397 | Mutating protocol handler near threshold. |
| `vex-app/src/renderer/features/wizard/steps/EmbeddingStep.tsx` | 394 | Embedding provider setup UI; privacy-sensitive. |
| `src/vex-agent/tools/registry.ts` | 384 | Central tool registry; policy metadata concentration. |
| `src/vex-agent/engine/core/turn-loop.ts` | 383 | Core agent loop; policy and stop-condition concentration. |
| `src/tools/polymarket/clob/validation.ts` | 383 | CLOB response/input validation complexity. |
| `src/tools/khalani/balances.ts` | 383 | Protocol client logic near threshold. |
| `src/tools/dexscreener/DexScreener.md` | 381 | Large protocol documentation. |
| `vex-app/src/renderer/features/appShell/SessionCreator.tsx` | 380 | Large app-shell session creation UI. |
| `src/vex-agent/tools/internal/wallet/send.ts` | 379 | Wallet intent confirm/broadcast lifecycle. |
| `src/tools/polymarket/data/validation.ts` | 379 | External response validation complexity. |
| `vex-app/src/main/ipc/register-handler.ts` | 377 | Central IPC security boundary. |
| `src/vex-agent/db/repos/messages.ts` | 374 | Large message repo; transcript privacy. |
| `src/vex-agent/db/repos/balances.ts` | 366 | Large balance/projection repo. |
| `src/tools/polymarket/clob/client.ts` | 365 | CLOB client; credential/API error surface. |
| `src/vex-agent/tools/protocols/kyberswap/handlers/limit-order.ts` | 364 | Mutating/signing handler. |
| `src/lib/local-secret-vault.ts` | 351 | Encrypted vault and `.env` stripping. |
| `vex-app/src/main/docker/probe.ts` | 342 | Docker/OS probing complexity. |
| `vex-app/src/renderer/features/systemCheck/SystemCheck.tsx` | 367 | Setup gate UI complexity. |
| `vex-app/src/main/ipc/wallet-export.ts` | 335 | Private-key export security-critical path. |
| `vex-app/src/shared/ipc/result.ts` | 339 | Shared error/result contract with growing code/domain catalog. |
| `vex-app/src/main/ipc/approvals.ts` | 318 | Approval IPC bridge into critical runtime authority. |
| `src/tools/solana-ecosystem/shared/solana-transaction.ts` | 311 | Solana signing/send/retry behavior. |
| `vex-app/src/renderer/features/appShell/ApprovalCard.tsx` | 305 | User approval decision UI. |
| `src/vex-agent/engine/core/approval-runtime/snapshot.ts` | 301 | Approval locks/TTL/CAS logic. |
