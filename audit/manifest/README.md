# Vex Audit Manifest — Index

Read-only architecture & structure map of the Vex app, produced to feed a deep
multi-agent audit. **This is a working artifact (untracked); not part of the build.**

## Provenance

- **Generated:** 2026-06-05 by Codex (GPT-5.5) via 5 read-only Explore agents.
- **Baseline:** branch `feat/agent-tool-resolution-safety`, current working tree (includes uncommitted changes).
- **Verified:** LOC spot-checks matched to the line (`swap-prequote.ts` 1316, `compose/lifecycle.ts` 821, `dispatcher.ts` 478).
- **Split:** from a single 2704-line manifest into the parts below; reconstruction is byte-identical to the original.

## How to use

Each deep-audit agent owns one work-unit and reads its `units/unit-NN-*.md` for the
inventory, security surface, hotspots, tests, and open risks of its slice. Start
global context from `00-overview.md` + `01-trust-boundaries.md`, then cross-check
findings against `91-cross-cutting-findings.md`.

**Additional lens for tools (Unit 13):** judge the agent-facing tool surface against
Anthropic's [Writing tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents)
— consolidation, namespacing, description/param clarity, high-signal returns, token
efficiency, actionable errors, eval-driven iteration. The checklist lives in
`units/unit-13-tools-dispatcher-protocol-runtime.md` and also applies to the protocol
manifests in units 15 & 16.

## Top-level parts

| File | Manifest § | Contents |
|---|---|---|
| `00-overview.md` | §0 | Baseline, measured totals, working-tree notes, repo layout, method |
| `01-trust-boundaries.md` | §1 | Full trust chain, secret/key/signing locations, IPC channel surface, external API/RPC surface |
| `units/` | §2 | Per-work-unit deep inventory (20 files) |
| `90-decomposition-table.md` | §3 | The 20 work-units (globs, lens, risk) |
| `91-cross-cutting-findings.md` | §4 | 28 cross-cutting findings (evidence + risk) |
| `92-god-files.md` | §5 | ~78 refactor candidates sorted by LOC |

## Work-unit index (§2 → files)

| # | Work unit | File | Risk | Primary lens |
|---:|---|---|---|---|
| 1 | Electron shell, protocol, window hardening | `units/unit-01-electron-shell-protocol-window.md` | High | Electron security, navigation, app protocol, privilege ownership |
| 2 | IPC / preload / shared contracts | `units/unit-02-ipc-preload-shared-contracts.md` | **Critical** | Renderer→main trust boundary, schemas, channel reconciliation |
| 3 | Main IPC domain handlers | `units/unit-03-main-ipc-domain-handlers.md` | High | Privileged handler safety, DTO redaction, cancellation |
| 4 | Secrets, vault, wallet export | `units/unit-04-secrets-vault-wallet-export.md` | **Critical** | Secret lifetime, vault, clipboard, key handling, crypto |
| 5 | Docker / local services / Compose | `units/unit-05-docker-local-services-compose.md` | High | Docker policy, loopback ports, destructive ops, cleanup |
| 6 | Local DB and migrations | `units/unit-06-local-db-migrations.md` | High | Schema, migrations, DB secret/data safety, migration drift |
| 7 | Renderer onboarding & secret setup UX | `units/unit-07-renderer-onboarding-setup-ux.md` | Medium-High | Untrusted UI, secret retention, setup errors, guidance |
| 8 | Renderer app shell & mission UI | `units/unit-08-renderer-appshell-mission-ui.md` | High | Approval display, bounded state, mission UX, renderer privacy |
| 9 | Observability, telemetry, support, redaction | `units/unit-09-observability-telemetry-support.md` | High | Secret redaction, telemetry consent, support bundle leakage |
| 10 | Agent ingress, runtime leases, workers | `units/unit-10-agent-ingress-runtime-leases.md` | High | Mission lifecycle, leases, cancellation, worker cleanup |
| 11 | Turn loop, prompts, compaction | `units/unit-11-turn-loop-prompts-compaction.md` | High | LLM control flow, prompt safety, compaction privacy |
| 12 | Mission approvals & policy runtime | `units/unit-12-mission-approvals-policy-runtime.md` | **Critical** | Approval correctness, policy snapshots, CAS/idempotency |
| 13 | Tool registry, dispatcher, protocol runtime, prequote, capture | `units/unit-13-tools-dispatcher-protocol-runtime.md` | **Critical** | Tool classification, schema strictness, prequote/capture safety |
| 14 | Wallet intents & wallet primitives | `units/unit-14-wallet-intents-primitives.md` | **Critical** | Signing authority, session wallet scope, retry/idempotency |
| 15 | EVM protocols: Khalani, KyberSwap, Polymarket | `units/unit-15-evm-protocols-khalani-kyber-polymarket.md` | **Critical** | Quotes, credentials, EIP-712, broadcasts, external validation |
| 16 | Solana / Jupiter protocols | `units/unit-16-solana-jupiter-protocols.md` | **Critical** | Solana signing, send retries, Jupiter API validation |
| 17 | Knowledge, memory, recall, privacy | `units/unit-17-knowledge-memory-recall-privacy.md` | High | Sensitive local data, embeddings, deletion/export |
| 18 | Inference, embeddings, env/config | `units/unit-18-inference-embeddings-config.md` | High | External LLM/embedding egress, config validation, provider secrets |
| 19 | Sync, portfolio, projections, captures | `units/unit-19-sync-portfolio-projections-captures.md` | High | Long-running sync, stale runs, projection integrity, capture provenance |
| 20 | Build, release, updater, CI, e2e | `units/unit-20-build-release-updater-ci-e2e.md` | High | Signing/notarization, user-triggered updates, artifact gates |
