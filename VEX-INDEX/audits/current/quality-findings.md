---
id: audit.current.quality-findings
kind: audit
paths: ["src/**", "vex-app/**"]
source_commit: cb43764
indexed_at: 2026-05-29
stale_when_paths_change: ["src/**", "vex-app/**", "VEX-INDEX/modules/**/*.md"]
related: [index.structure, module.vex-agent.tools-internal, module.vex-app.preload-shared-contracts]
---

# Current Quality Findings

| ID | Finding | Status | Notes |
|---|---|---|---|
| FINDING-quality-001 | `Structure.md` stale after F1/F2/F3 fixes | fixed-in-index | Refreshed 2026-05-28. |
| FINDING-quality-002 | Migration count drift: docs said 27 migrations | fixed-in-index | Current truth: schema version 027 / 24 SQL files. |
| FINDING-quality-003 | Embedding endpoint drift: docs said Docker Model Runner `:12434` | fixed-in-index | Current bundled compose: llama.cpp on `127.0.0.1:55134/v1`; legacy probes remain. |
| FINDING-quality-004 | `modules/vex-app` absent while README/MANIFEST reserved it | fixed | Round 3 (commit 041ce57): 10 deep vex-app module docs + 6 flows + 4 boundaries written; MANIFEST has 36 modules, 0 missing paths. |
| FINDING-quality-005 | `src/lib/env.ts` omitted from root env-config index | fixed-in-index | Added to module + manifest freshness triggers. |
| FINDING-quality-006 | `lib-vault-secrets` contradicted lock behavior | fixed-in-index | Lock clears master password, not vault-injected `process.env` keys. |
| FINDING-quality-007 | Protocol/root module open questions had stale entries | fixed-in-index | Solana predict and Polymarket bridge notes corrected. |
| FINDING-quality-008 | Orphan/reserved channel constants can be mistaken for live API | open | `providerListModels`, `providerTest`, `updater.check`; keep indexed as unbridged/reserved. |
| FINDING-quality-009 | `tools-protocols.md` drift: mutation matrix count + sync table names | fixed-in-index | Round 4: matrix is 28 entries (was "27"); sync tables are `protocol_sync_jobs`/`protocol_sync_runs` (was `sync_jobs`/`sync_runs`). Corrected in `modules/vex-agent/tools-protocols.md`. |
| FINDING-quality-010 | `FLOW-compaction-tracks.md` chunker anchor drift | fixed-in-index | Round 4: `chunker-call.ts` constructor is `:64` (doc said `:63`). Corrected. |
| FINDING-codex-002 | `fetchJson<T>()` casts external JSON to `T` without schema validation | fixed | Bundle B (commits `9b8d18e` Phase 1, `cb43764` Phase 2). `parseJsonResponse`/`fetchJson` (`src/utils/http.ts`) now take an optional Zod `schema` and validate at the boundary, throwing `HTTP_RESPONSE_INVALID` (non-retryable). **Phase 1**: every raw `fetchJson<T>` cast that fed a domain type now passes a permissive `.passthrough()` schema with FIRM validation on signing-bound fields (base64 tx / base58 pubkey / instruction wire) — all Jupiter clients (swaps/prices/tokens/+content/lend/prediction) + the embeddings client; OpenRouter inference was already SDK-Zod-validated. **Phase 2** (full-uniformity, user-chosen): the hand-written validators (Khalani, Polymarket ×5, KyberSwap ×5, DexScreener) converted to Zod, BEHAVIOR-PRESERVING (shared `src/utils/zod-validation-helpers.ts`; `zNumberField` custom guard because Zod 4 `z.number()` rejects Infinity while the original `asNumber` accepted it; per-validator throw type / lenient defaults / element-wise filtering / raw subtrees preserved), proven by per-validator equivalence tests. Each service error-path preserved so validation never pre-empts a domain error. Codex GREEN (design + 2 templates + per-checkpoint reviews). 1211+151 focused tests; central tsc clean. |
| FINDING-codex-003 | Tool-side embedding re-embed appears script-only | needs-more-info | Codex Round-4: `src/vex-agent/tools/protocols/embeddings/reembed.ts:13` — if no desktop trigger, dense discovery can silently degrade after dim/model change. Confirm whether a runtime path exists or it's intentionally a maintenance script. |

Dead-code candidates from Round 2 remain unverified and must not be removed without a separate code audit.
