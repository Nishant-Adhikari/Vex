# S3 — Retrieval: `long_memory_search` / `long_memory_get` / `long_memory_history` (detailed stage spec)

Parent plan: `memory-system/memory-system-v2.md` §9 S3 (+ §2 read-path, §6 advisory-only). Genesis: `memory-system/memory-system.md` §513-561 (Retrieval), §374-398 (response_format), §344-369 (tool names), §247-272 (dual-trace), §562-592 (supersession/status), §949 (closed). Cutover map: `audit/memory-cutover-manifest.md`.
Status: DRAFT → Codex gate (`harness-memory-s3`) → Opus implement → independent verify → final impl-gate.
Strategy: ADDITIVE — three NEW agent-facing read tools. Old `knowledge_recall`/`knowledge_get`/`knowledge_history` stay until the S9 cutover.

## 0. Owner-ratified scope (2026-06-08)

**Goal of S3:** give the agent working long-term recall — one high-level `long_memory_search` that hides the strategy (vector + dual-trace + rerank), plus `long_memory_get` (by id) and `long_memory_history` (lineage). The agent already WRITES via `long_memory_suggest` (S2); S3 makes memory READABLE.

**NARROWED scope (owner directive):** S3 = the RETRIEVAL FUNCTIONALITY only. The prompt-structure reorganization (the KV-cache hierarchy), prefix-caching, the polished "MEMORY" system-prompt section, the combined kind catalog, and the `getTurnContext`/hot-context rewire are DEFERRED to a dedicated "structuring + caching" phase AFTER the memory module is complete. S3 touches the prompt only minimally: register the new tools + a one-line routing mention so they are discoverable.

**Decisions (conservative, reversible — owner may override):**
- **D1 — graph-expansion = hook now, empty until S8.** `long_memory_search` takes an optional `expand_graph` (default false) that returns empty until S8 populates `memory_entities`/`memory_edges`. No signature churn at S8. (`memory-system-v2.md` §9 S8.)
- **D2 — vector-only now; lexical later.** S3 ships vector recall + dual-trace + rerank (reusing existing primitives). No FTS exists in the repo; the tool HIDES its strategy (genesis §398), so adding BM25/lexical later does NOT change the agent-facing contract. Genesis "vector+lexical" is satisfied incrementally.
- **D3 — dual-trace is via explicit search, not auto-injection.** `long_memory_search` reads `knowledge_entries` AND fresh `memory_candidates`; candidates are de-weighted, marked `source:"memory_candidate"`, never a hard constraint (genesis §260, §247-266). Hot-context AUTO-injection (`getTurnContext`) is the deferred structuring phase.

Advisory-only doctrine holds (§6): retrieval results never feed sizing/approval/wallet-intent. `influence_scope` is never read to set execution/sizing (OD-1).

## 1. Grounding (verified — 6-agent recon `wf_0f733eee-cb1`)

Reuse (all exist, S0–S2 done):
- **Query embed** `embeddings/client.ts` `embedQuery(query, config?) → { embedding, providerModel }` (prefix `"task: search result | query: <q>"`). The `providerModel` is the audit truth and the recall filter — NOT `config.model`.
- **Vector recall (knowledge)** `db/repos/knowledge/recall.ts` `recallTopK(queryEmbedding, filters: RecallFilters, k)` — cosine `<=>`; MANDATORY `embedding_model=$ AND embedding_dim=$` filters; `status='active'`; optional `kind`; expiry gate `(pinned OR valid_until IS NULL OR valid_until > now())`; fetches `k*2`, orders by distance. `mapRowToCandidate` → similarity `= clampUnit(1 - cosine_distance)`. NOTE: recallTopK does NOT apply the hot-context source filter (so explicit search CAN return inferred/hypothesis — genesis §951: visible as soft/historical, just ranked lower).
- **Rerank** `knowledge/ranking.ts` `rerank(candidates, {k}) → RankedRecallResult[]`: `score = similarity + recencyBoost(max 0.15, 7d half-life) + confidenceBoost(max 0.10) + pinnedBoost(0.20 flat)`. Stable sort by score DESC. Does NOT yet use maturity/activation/influence (S6).
- **Overflow / cache** `db/repos/recall-cache.ts` + `knowledge/recall-payload.ts` `splitInlineAndOverflow` — inline cap 10 entries / 50KB; `recall_cache_entries` 15-min TTL; overflow fetched by a cache key. Cache key hashes the FULL filter set.
- **Handlers to mirror** `tools/internal/knowledge/recall.ts` `handleKnowledgeRecall` (embedQuery → recallTopK → rerank → split) and `tools/internal/knowledge/get.ts`/lineage for get/history. ToolDef shape `tools/registry/knowledge.ts` (read tools: `mutating:false`, `pressureSafety:"read_only"`, `actionKind:"read"`).
- **Candidate columns** (001 ~565-622): `embedding`/`embedding_model`/`embedding_dim`, `status`, `retrieval_visibility` (`not_consolidated|suppressed`), `retrieval_until`, `importance`, `sensitivity`, `source`. `idx_mc_embedding_match (embedding_model, embedding_dim)` exists. NO candidate vector-recall function yet → S3 adds one.
- **Dual-trace contract** (genesis §247-272, v2 §2 layer 5 + §9 S3): a `not_consolidated` candidate (not expired) is visible at LOWER weight, marked `not_consolidated`/`fresh_signal`, never a hard execution constraint; `retrieval_until` bounds visibility. The S2 forward-note (Codex): `not_consolidated` alone is NOT "return this" — S3 must apply a signal gate + low weight.
- **Result discriminator** (genesis §513): one ranked list, each result tagged `source:"long_memory"` (knowledge_entries) vs `source:"memory_candidate"` (fresh). concise|detailed (§374).
- **Active/current filter** (genesis §562-592): superseded/invalidated/archived must NOT outrank active; recallTopK's `status='active'` handles it for knowledge.
- **memLog** allowlist has `candidateId/entryId/status/kind/count/similarity/durationMs/...` — enough for retrieval logs.

## 2. The three tools (`tools/internal/long-memory/{search,get,history}.ts`)

### `long_memory_search`
1. Validate input (Zod): `query` (1..512), `k?` (default 8, max `LONG_MEMORY_MAX_K`), `kind?` (optional exact filter), `response_format?` (`concise|detailed`, default concise), `include_candidates?` (default true), `expand_graph?` (default false — D1 hook). (R1: `scope` REMOVED — semantics were undefined vs the hardcoded expiry gate; S3 always returns active + non-expired.)
2. `embedQuery(query)` → `{embedding, providerModel}`. Use `providerModel` + `embedding.length` as the recall filter for BOTH stores (write/read consistency).
3. **Knowledge recall:** `recallLongMemoryTopK(embedding, { embeddingModel: providerModel, embeddingDim: embedding.length, kind?, includeExpired:false }, k)` → `LongMemoryResult[]` tagged `source:"long_memory"`, EACH carrying the entry's `source` TIER (observed|user_confirmed|inferred|hypothesis), `maturityState`, similarity, and the rerank inputs. (R1-#4: the recall SELECT MUST include `source` so S3 can rank inferred/hypothesis LOWER without excluding them — genesis §951.)
4. **Dual-trace recall (D3, if `include_candidates`):** new `recallCandidatesTopK(embedding, { embeddingModel: providerModel, embeddingDim }, k)` over `memory_candidates` WHERE `status='pending' AND retrieval_visibility='not_consolidated' AND (retrieval_until IS NULL OR retrieval_until > now()) AND embedding_model=$ AND embedding_dim=$` ORDER BY `embedding <=> $` LIMIT k. Map to `LongMemoryResult` `source:"memory_candidate"`, `notConsolidated:true`, UUID id (string).
5. **Score + blend (`blendAndRank`, pure — R1-#1/#2):** the two sources are scored SEPARATELY (NOT through knowledge's `rerank`, which keeps only `status='active'` rows and assumes numeric ids):
   - knowledge: `score = rerankScore(sim, recency, confidence, pinned) × sourceTierWeight` (observed/user_confirmed → 1.0; inferred/hypothesis → `SOURCE_SOFT_WEIGHT=0.7`).
   - candidate: `score = similarity × CANDIDATE_DUAL_TRACE_WEIGHT (0.6)` — NO boosts; gated by `similarity ≥ LONG_MEMORY_CANDIDATE_MIN_SIMILARITY=0.35` and capped at `LONG_MEMORY_CANDIDATE_MAX=3`.
   - **Guarantee (tested):** with `CANDIDATE_DUAL_TRACE_WEIGHT (0.6) < SOURCE_SOFT_WEIGHT (0.7) ≤ 1` and candidates carrying no boosts, a confirmed entry ALWAYS outranks a candidate at equal raw similarity (worst confirmed = hypothesis = `sim×0.7 ≥ sim×0.6`); a much-higher-similarity fresh candidate may still surface. Merge; stable sort by score DESC.
6. **Graph-expansion (D1):** if `expand_graph`, stub `expandViaGraph(seedEntryIds) → []` (no-op until S8). Merge (empty).
7. **Inline-only (R1-#3):** return the top results inline (`LONG_MEMORY_INLINE_CAP=10` / `LONG_MEMORY_INLINE_CHARS_CAP=50KB`). NO overflow-cache reuse — `CachedRecallEntry` drops `source`/`score`/`notConsolidated`/UUID identity and the key would collide across `include_candidates`. If the ranked set exceeds the cap, truncate to the cap and emit `search.truncated {count: dropped}` + a steering hint in the output ("showing top N — refine your query for more"). NO silent truncation. (Long-memory overflow cache = a later refinement with its own DTO/key.)
8. Format per `response_format` (each item carries `source` + `notConsolidated?`):
   - concise: `{ source, id, kind, title, similarity, score, notConsolidated? }`.
   - detailed: + `summary, contentMd (capped), tags, validUntil, maturityState (knowledge only), sourceTier, evidenceRefs`.
9. memLog (allowlisted keys ONLY — R1-#6): `search.served {count, durationMs}`, `search.candidates {count}` (fresh included), `search.truncated {count}` (dropped). NOT `candidateCount`.

### `long_memory_get`
- Input: `id` (int — knowledge_entries.id), `response_format?`. Fetch entry + a lineage snapshot (supersedes/superseded_by). Returns the entry (detailed by default — it's an explicit fetch). Fail with a steering message if not found / not active (note if superseded → point at the successor). Mirror `knowledge_get`.

### `long_memory_history`
- Input: `id`, `response_format?`. Returns the supersession/lineage chain (`getLineageChain`) COMBINED with the entry's reinforcement fields (`first_promoted_at`, `last_reinforced_at`, `outcome_version`) — R1-#7: the lineage repo returns compact lineage only, so the handler fetches the entry too and merges into the S3 history DTO (NO repo change). Read-only. Mirror `knowledge_history`/lineage.

All three: `mutating:false`, `pressureSafety:"read_only"`, `actionKind:"read"`, `visibility:{}` (always visible — unlike session memory's `requiresSessionMemory` gate). Namespaced `long_memory_*`. ToolDefs per Anthropic guidance (new-hire description, concise/detailed, unambiguous params, steering errors).

## 3. Repo additions

- `db/repos/knowledge/recall.ts`: `recallLongMemoryTopK(...)` — the SAME vector SQL as `recallTopK` but the SELECT/DTO ALSO returns `source` (+ `maturity_state`, `activation_strength` for S6) so S3 can apply source-tier ranking (R1-#4). Additive — `recallTopK`/`knowledge_recall` untouched. (Implementer may instead extend `recallTopK`'s DTO with `source` additively; the CONTRACT is "S3's knowledge recall returns `source`".)
- `db/repos/memory-candidates/{crud,index}.ts`: `recallCandidatesTopK(queryEmbedding, filters, k, client?) → MemoryCandidateRecallRow[]` — dual-trace vector recall (mandatory model/dim filter; `not_consolidated`+non-expired+`pending` predicate; cosine `<=>` order; `k*2` fetch; similarity `1-cosdist`). NO migration (uses `idx_mc_embedding_match`).
- Knowledge `rerank` reused ONLY for the knowledge sub-list's BASE score; the candidate sub-list is scored by S3's own pure scorer (R1-#1 — never push candidates through `rerank`).
- `long_memory_get`/`history`: reuse `knowledge/get` + `knowledge/lineage.getLineageChain`; `history` ALSO fetches the entry's reinforcement fields and combines (R1-#7). NO `recall-cache` reuse (R1-#3, inline-only).

## 4. Merge / rerank / dual-trace policy (`memory/long-memory-retrieval-policy.ts`, pure)

- Constants: `LONG_MEMORY_DEFAULT_K=8`, `LONG_MEMORY_MAX_K` (= existing recall max), `LONG_MEMORY_INLINE_CAP=10`, `LONG_MEMORY_INLINE_CHARS_CAP=50_000`, `SOURCE_SOFT_WEIGHT=0.7`, `CANDIDATE_DUAL_TRACE_WEIGHT=0.6`, `LONG_MEMORY_CANDIDATE_MIN_SIMILARITY=0.35`, `LONG_MEMORY_CANDIDATE_MAX=3`. Hard invariant: `CANDIDATE_DUAL_TRACE_WEIGHT < SOURCE_SOFT_WEIGHT ≤ 1`.
- `scoreKnowledge(r) = rerankScore × (sourceTier ∈ {observed,user_confirmed} ? 1 : SOURCE_SOFT_WEIGHT)`.
- `scoreCandidate(r) = similarity × CANDIDATE_DUAL_TRACE_WEIGHT` (NO recency/confidence/pinned boosts → guarantees confirmed wins at equal raw similarity — R1-#2).
- `blendAndRank(knowledge: LongMemoryResult[], candidates: LongMemoryResult[]) → { results: LongMemoryResult[]; droppedCandidates: number }` — pure: score each source with its own scorer; gate candidates (`similarity ≥ MIN_SIMILARITY`) + cap (`MAX`); merge; stable sort by score DESC; return the dropped-over-cap count. A candidate is ALWAYS a soft score, never a hard constraint.
- Doctrine guards (unit-tested): (a) confirmed ≥ candidate at equal raw similarity — incl. the worst case (fresh+pinned hypothesis knowledge still beats a max-similarity candidate at the SAME sim); (b) inferred/hypothesis knowledge ranks below observed but is NOT excluded; (c) over-cap candidates dropped and counted (no silent truncation).

## 5. Registration + minimal routing

- Extend `tools/registry/long-memory.ts` with the 3 read ToolDefs (alongside `long_memory_suggest`).
- `INTERNAL_TOOL_LOADERS`: add `long_memory_search/get/history → handlers`.
- `TOOL_MAP_CATEGORIES`: add them under the existing "Long-term memory" category.
- Minimal prompt wiring (NOT the deferred reorg/MEMORY-section): one line in `engine/prompts/tool-usage.ts` / memory-routing so the agent knows `long_memory_search` exists for cross-session recall. Do NOT touch the knowledge-state banner aesthetics, the combined catalog, or the prompt order (deferred).
- registry-completeness + tool-map-consistency tests must stay green (3 new tools wired at all points).

## 6. Scope split

| Concern | S3 (now) | Deferred |
|---|---|---|
| `long_memory_search/get/history` tools + handlers | ✅ | |
| Candidate vector recall (`recallCandidatesTopK`) | ✅ | |
| Dual-trace merge + de-weighted rerank + source discriminator | ✅ | |
| Graph-expansion | hook (empty, D1) | populate/use → **S8** |
| Lexical/BM25 | | later refinement (D2) |
| Registration + minimal tool-routing line | ✅ | |
| Prompt hierarchy reorg + prefix-caching | | **structuring+caching phase (post-module)** |
| Polished MEMORY section + combined kind catalog | | **structuring phase** |
| `getTurnContext`/hot-context rewire, recall-seed/hydrate | | **structuring phase** (must precede S9) |
| Maturity/activation in rerank | | **S6** |
| Session-memory rename + transcript marker (3-part, renderer) | | **S9** cutover |
| Delete old `knowledge_recall/get/history` | | **S9** |

## 7. Tests (self-documenting names — no gate-codes)

- **Policy unit** (`long-memory-retrieval-policy.test.ts`): confirmed entry outranks a candidate at equal raw similarity — INCLUDING the worst case (fresh+pinned hypothesis knowledge still beats a candidate at the same similarity); inferred/hypothesis knowledge ranks below observed but is NOT excluded; candidates below min-similarity dropped; cap enforced + dropped count returned (no silent truncation).
- **Handler unit** (`long-memory-search.test.ts`, mock embed+repos): query → embed → knowledge+candidate recall → blended union with `source` tags; `include_candidates:false` returns only `long_memory`; expired/suppressed/terminal candidates excluded; `expand_graph:true` returns empty (hook); over-cap results truncate to the inline cap + emit `search.truncated` (no silent drop); concise vs detailed shapes; empty → clean "nothing found" steering; embed outage → fail-loud (no fallback). `long_memory_get`: found / not-found-steer / superseded→point-at-successor. `long_memory_history`: lineage chain + reinforcement fields (first_promoted_at/last_reinforced_at/outcome_version) present.
- **Repo integration** (real pgvector, temp-harness): `recallCandidatesTopK` returns only not_consolidated + non-expired, ordered by cosine, model/dim filtered; a suppressed/expired/terminal candidate is excluded; dim-mismatch filtered.
- **Registry** (reuse suites): registry-completeness + tool-map consistency green with the 3 new tools; `knowledge_recall` unaffected.
- **Verify:** `pnpm exec tsc --noEmit`; targeted vitest; integration on real pgvector via throwaway temp-harness (no embeddings probe — handler tests mock embed; the repo test seeds synthetic vectors).

## 8. Decisions to ratify (gate)

- D1 graph-expansion hook (empty until S8); D2 vector-only now; D3 dual-trace via explicit search (de-weighted, gated, capped, source-discriminated, never hard).
- Narrowed scope: retrieval only; prompt reorg/caching/MEMORY-section/catalog/getTurnContext DEFERRED to the structuring phase; session-rename/transcript-marker/old-tool-deletion = S9.
- Read tools: `mutating:false`/`read_only`/always-visible; concise default; `recallCandidatesTopK` no migration.
- R1 fixes: candidates scored SEPARATELY (not via knowledge `rerank`); `scoreCandidate = sim×0.6` (no boosts) + source-tier `0.7` de-weight on inferred/hypothesis knowledge, with the `CANDIDATE < SOURCE_SOFT ≤ 1` invariant guaranteeing confirmed-wins-at-equal-sim; INLINE-ONLY (overflow cache deferred — its DTO drops source/UUID); `scope` removed; S3 knowledge recall returns `source`; memLog uses allowlisted `count` on `search.served/candidates/truncated`; `long_memory_history` combines entry reinforcement fields + lineage.

## 9. Gate rounds (`harness-memory-s3`)

- **R1 (BLOCKED → fixed):** (1) don't run candidates through knowledge `rerank` (drops non-active rows; numeric vs UUID ids) → separate scorer + source-discriminated result type; (2) equal-similarity guarantee → candidates scored `sim×weight` with no boosts + the `0.6<0.7≤1` invariant; (3) `recall-cache` DTO drops source/score/UUID → INLINE-ONLY for S3; (4) recall DTO must include `source` to rank inferred/hypothesis lower without excluding; (5) `scope` undefined → removed; (6) `candidateCount` not allowlisted → allowlisted `count` on separate events; (7) `long_memory_history` reinforcement fields → combine entry + lineage in the handler.

## 10. Status

DONE (pending commit) — plan gate GREEN (R2) + impl gate GREEN (after R1: format-aware chars cap + reject-unknown-params). Verified: tsc clean; 46 non-DB tests (policy 12 + handler 18 + registry 16) + 2 regression; 8/8 repo integration on real pgvector. `harness-memory-s3` thread `019ea86a-…`. Deferred (structuring+caching phase, must precede S9): prompt reorg/cache, MEMORY section, combined catalog, getTurnContext/hot-context rewire. S9: session rename + transcript marker + delete old knowledge_recall.
