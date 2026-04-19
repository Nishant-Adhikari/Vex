# Echo-Agent Audit Inventory

Status: post-milestone state (`echo-agent audit` PR1–PR6).
Generated: 2026-04-18 (post-PR4 `77b9c20`).
Updated: 2026-04-19 (post-PR5 `0c8c185`, refreshed in PR6 follow-up).
Source of truth for the classification decisions taken across the milestone.
§1 (assets) + §3 (hotspots) reflect the final post-PR5 state; §4 (follow-ups)
tracks items intentionally deferred beyond this milestone.

Classification vocabulary:

- `runtime` — executed on the agent runtime path (turn-loop, checkpoint, dispatch, recall).
- `reserved` — declared but intentionally dormant (placeholder namespace, reserved type state). Must be explicitly named, not silently dead.
- `operator-only` — maintenance/ops tool run by a human or CI, not the runtime.
- `benchmark` — reproducible measurement scaffolding.
- `demo` — illustrative scripts, not production.
- `fixture` — static data used by tests or scripts.
- `orphan` — zero referenced by runtime, operator-only, benchmark, demo, test, or packaging. Deletion candidate after global grep.

## 1. Assets and dead-code candidates

| Path | Status | Evidence | Action |
|------|--------|----------|--------|
| `src/echo-agent/public/*` (9 assets) | reserved-for-future | Zero repo references (grep negative), not in `package.json#files`. **User decision 2026-04-18: retain — reserved na przyszłe użycie (potencjalnie frontend / desktop shell per `vex_desktop_bottlenecks` plan).** | **KEEP.** PR5 SKIPS deletion. Future refactor (move to `src/mcp/public/` or dedicated app) is OK; delete is not. |
| `src/echo-agent/sync/replay.ts` (`replayProjections`) | operator-only / e2e-consumed | Updated 2026-04-18 (PR5): consumed by `src/echo-agent/e2e/core/replay-check.ts` (e2e snapshot-compare harness). Zero runtime importers and no `package.json#scripts` entry, but NOT orphan. | **KEEP in-place.** Added top-of-file `operator-only correction + e2e harness tool` comment in PR5. Moving to `scripts/ops/` would break the e2e import path — not worth the churn this milestone. Revisit only if the e2e consumer is removed. |
| `ToolLifecycle = "declared"` variant (`src/echo-agent/tools/protocols/types.ts`) | orphan (type state) | `grep -rn 'lifecycle:\s*"declared"' /mnt/x/EchoClaw/src/` → 0 hits. No manifest uses it. | Remove from `ToolLifecycle` union in PR1 §1c. Does NOT remove public `includeDeclared` parameter (separate concern, §1e). |
| `includeDeclared` parameter (previously in `tools/registry/protocol.ts`, `tools/protocols/types.ts`, `tools/protocols/discovery.ts`, `tools/protocols/discovery.telemetry.ts`, `tools/dispatcher.ts`) | removed (PR1) | After `ToolLifecycle` was narrowed to `"active"`, the flag had literally zero runtime effect. Keeping it as deprecated no-op would have forced future reviewers to ask "when does this go" — dead surface is itself tech debt. MCP clients that still pass the flag get silent-strip from Zod default-parsing (no visible error). | DONE in PR1: removed from public schema, internal type, dispatcher forwarding, discovery branch, and telemetry field. Reintroduction requires a concrete new lifecycle variant + real manifests using it. |
| `src/echo-agent/tools/protocols/navigation/entries-reserved.ts` — namespace `0g-compute` | reserved (collision with inference provider `inference/0g-compute.ts`) | `src/echo-agent/inference/0g-compute.ts` is an inference provider; `entries-reserved.ts:5` declares a reserved protocol namespace with same string label, zero handlers, `advertised: false`. Dual-purpose label is a grep trap for onboarding. | **Documented, not renamed (PR5 decision).** Renaming the protocol namespace label would touch `ProtocolNamespace` union + MCP-projected schema → public contract change with limited upside (zero handlers today). Deferred to whenever the reserved namespace gets a real manifest, at which point its final label gets decided against concrete tool IDs. |
| `src/echo-agent/tools/protocols/navigation/entries-reserved.ts` — namespace `0g-storage` | reserved | Placeholder for future 0G Storage protocol; `advertised: false`, zero handlers. No current collision. | Keep. Document as intentional reserved in this inventory. |

## 2. Operator-only scripts

All live in `src/echo-agent/scripts/`. `package.json` `scripts` field exposes them via `pnpm`. Not counted toward runtime LOC limit.

| Path | Status | `package.json` entry | Notes |
|------|--------|----------------------|-------|
| `src/echo-agent/scripts/_preflight.ts` | operator-only (shared) | (used by siblings) | DB URL + schema preflight helpers. |
| `src/echo-agent/scripts/knowledge-import.ts` + `scripts/knowledge-import/**` | operator-only | `knowledge-import` | Backup restore. PR5 may move to `scripts/ops/`. |
| `src/echo-agent/scripts/knowledge-export.ts` | operator-only | `knowledge-export` | Backup export. PR5 may move to `scripts/ops/`. |
| `src/echo-agent/scripts/knowledge-reembed.ts` | operator-only | `knowledge-reembed` | Maintenance lease holder (§PR4 from vex_simplified_gate). PR5 may move to `scripts/ops/`. |
| `src/echo-agent/scripts/checkpoint-compliance-check.ts` | operator-only | `checkpoint-compliance` | 614 LOC — NOT counted toward runtime limit. Out of scope for refactor. |
| `src/echo-agent/scripts/checkpoint-compliance-fixtures.ts` | fixture | (imported by check script) | Static test corpus for compliance CLI. |
| `src/echo-agent/scripts/session-recall-demo.ts` | demo | (none) | 582 LOC demo of recall path — NOT counted. |
| `src/echo-agent/scripts/cross-lingual-benchmark.ts` | benchmark | (none) | 502 LOC — benchmark scaffolding. |
| `src/echo-agent/scripts/cross-lingual-benchmark-dataset.ts` | fixture | (imported by benchmark) | 431 LOC static dataset. |

Recommended PR5 reorganization (optional, low priority):

```
src/echo-agent/scripts/
  ops/          # knowledge-*, checkpoint-compliance-check, replay-projections
  benchmarks/   # cross-lingual-benchmark*
  demos/        # session-recall-demo
```

## 3. Runtime hotspots (team-agreed 300/400 LOC threshold) — post-milestone state

Counted toward runtime LOC limit. Pre-milestone LOC is shown in the first
column for historical reference; post-milestone state is in the "Outcome"
column with the actual current LOC (as of 2026-04-19).

| Path | Pre-PR LOC | Post-PR LOC | Outcome |
|------|-----------|-------------|---------|
| `src/echo-agent/db/repos/session-episodes.ts` | 482 | 41 | **DONE (PR2).** Barrel over `session-episodes/{types,crud,recall,promotion-queries}.ts` — biggest submodule 167 LOC. |
| `src/echo-agent/knowledge/promotion.ts` | 455 | 264 | **DONE (PR2).** Orchestrator only; pipeline in `promotion/{eligibility,translation,persist}.ts` — biggest submodule 128 LOC. |
| `src/echo-agent/db/repos/knowledge-lifecycle.ts` | 387 | 94 | **DONE (PR2).** Barrel over `knowledge-lifecycle/{errors,types,supersede}.ts` — biggest submodule 210 LOC. |
| `src/echo-agent/inference/openrouter.ts` | 370 | 370 | **Kept.** Adapter; mapping tests deferred to follow-up (§4). |
| `src/echo-agent/engine/checkpoint/extract.ts` | 361 | 361 | **Kept.** Extraction prompt is cohesive. |
| `src/echo-agent/db/repos/sessions.ts` | 357 | 357 | **Kept.** Cohesive repo; tx-aware helpers added in PR2 of `vex_simplified_gate`. |
| `src/echo-agent/engine/core/checkpoint.ts` | 352 | 352 | **Kept.** Phase I/II invariant load-bearing; non-goal this milestone. |
| `src/echo-agent/tools/protocols/0g/jaine/handlers/swap.ts` | 351 | 351 | **Kept.** Cohesive swap handler. |
| `src/echo-agent/tools/protocols/polymarket/handlers-clob.ts` | 351 | 351 | **Kept.** Cohesive CLOB handler. |
| `src/echo-agent/engine/core/turn-loop.ts` | 333 | 333 | **Kept.** Promotion-hook pinned by `turn-loop-promotion.test.ts` (PR4). |
| `src/echo-agent/tools/protocols/echobook/handlers.ts` | 301 | 37 | **DONE (PR2).** Barrel over `handlers/{posts,comments,profile,social,submolts,notifications,points,trade-proof}.ts` — biggest submodule 85 LOC. |
| `src/echo-agent/tools/protocols/discovery.ts` | 300 | ~295 | **Kept.** `includeDeclared` branch removed in PR1 dropped a few lines. |

## 4. Follow-up tickets (extracted from plan non-goals §7 + PR-time deferrals)

Deferred during PR4 (test coverage) — not implemented because the value is lower
than the SDK/DB mocking cost in the current milestone, and existing suites already
provide structural coverage:

- Provider adapter mapping tests (`inference/openrouter.ts`, `inference/0g-compute.ts`).
  `registry.test.ts` + `resilience.test.ts` + `config.test.ts` + `cost-calculation.test.ts`
  already cover selection, retry, config, and cost shape. What remains (response
  parse, HMAC signature, tool-call delta accumulation) is highly SDK-shaped and
  would be a maintenance burden without integration-level payloads.
- `sync/replay.ts` unit tests. §1 decided to KEEP in-place (e2e consumer), so
  a dedicated unit suite would need DB + MUTATION_MATRIX fixture work that is
  disproportionate to the risk. The e2e harness at `e2e/core/replay-check.ts`
  provides structural coverage today.

Other follow-ups:

- Extend `ProtocolParamDef` with `enum`/`schema` (option (b) from plan §2.8) — broader contract evolution.
- Full Zod migration for handler readers (replace `str()/num()/bool()`).
- Full Zod schemas on `inference/0g-compute/mappers.ts` response parsing and `sync/lp-economics.ts` GraphQL.
- Rewrite inference provider adapters (`openrouter.ts`, `0g-compute.ts`).
- Native gas reserve backstop (`handler-helpers.ts:52` TODO).
- `validateCaptureContract` fail-open → fail-closed policy change (intentional today; documented in `capture-validator-policy.test.ts`).
- (completed in PR1) `includeDeclared` removed entirely from `discover_tools` schema + internal types.
- Unified DB pool for Agent DB vs echo-agent DB — intentional separation today.
- Generic `sync/` worker + domain projectors migration.
- Refactor `scripts/checkpoint-compliance-check.ts` (614 LOC) — operator CLI, out-of-scope for runtime audit.

## 5. MCP contract surface (do not break)

Imports from `@echo-agent/*` into `src/mcp/`:

| Symbol | From | Preserved by |
|--------|------|--------------|
| `dispatchTool` | `tools/dispatcher.ts` | PR1 (internal refactor only, signature unchanged). |
| `getProductionMcpTools` | `tools/registry.ts` | PR1 (filtering logic unchanged). |
| `ToolDef`, `JsonSchema`, `OpenAITool`, `toOpenAITools` | `tools/types.ts` | PR1/PR3 (type shape unchanged). |
| `PROTOCOL_ADVERTISED_NAMESPACE_ALLOWLIST`, `PROTOCOL_NAMESPACE_ALLOWLIST`, `NAMESPACE_DEFAULTS`, `PROTOCOL_TOOLS`, `isAdvertisedProtocolNamespace`, `isKnownProtocolNamespace`, `isProtocolToolAvailable`, `countAvailableToolsForNamespace`, `getMissingEnvForNamespace`, `getProtocolHandler`, `getProtocolManifest`, `NamespaceDefault` | `tools/protocols/catalog.ts` | PR1 (re-exports preserved; internal implementation = per-namespace registry + Map lookup). |
| `ProtocolNamespace`, `ProtocolToolManifest`, `ProtocolHandler`, `ToolLifecycle` | `tools/protocols/types.ts` | PR1 (`ToolLifecycle = "active" | "declared"` → `ToolLifecycle = "active"` after `declared` removal; if any external consumer uses `"declared"`, that's a breaking change — mitigated by grep in PR1). |
| `InternalToolContext` | `tools/internal/types.ts` | stable. |
| `runMigrations`, `getPool`, embedding config, `sessionsRepo.*` | misc | PR6 added typed exports check to `mcp-contract.test.ts` §"non-tools MCP surface". |

Enforcement (post-PR6):
- Protocol + tool surface: `src/__tests__/echo-agent/tools/mcp-contract.test.ts`
  — now covers `tools/*` imports AND the non-tools MCP surface
  (`runMigrations`, `getPool`, embedding config constants + loader,
  `sessionsRepo.{createSession,setScope,endSession}`). Primary structural gate.
- Production profile filtering: `src/__tests__/mcp/surface/profile.test.ts`
  — asserts `getProductionMcpTools` hides subagent / MCP-excluded entries.
- Registry projection for docs: `src/__tests__/mcp/docs/registry-projection.test.ts`
  — asserts the per-namespace projection MCP exposes to docs consumers.
- Cross-module type checking: `pnpm exec tsc --noEmit` (required in CI).

No single test "closes the topic" — these four layers together protect the
MCP surface. If a refactor silently renames or removes any of the 13 listed
symbols, the structural tests fail before the MCP bridge even boots.
