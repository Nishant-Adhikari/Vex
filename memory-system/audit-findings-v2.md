# Memory System v2 — Audit Findings (2026-06-12)

Source: 5-lens adversarial review (architecture, security, correctness/concurrency,
performance/scale, product) over the as-built code at HEAD (S0–S10 + STRUCTURE+CACHE
+ DOPIECIA 10.8/1–4, all committed). Each finding carries `file:line` evidence and a
severity. `[VERIFIED]` = re-confirmed by hand in this session, not just reported.

Panel scores (harsh calibration: 7 = solid with real flaws, 9+ ≈ zero findings):

| Lens | Score | One line |
|---|---|---|
| Correctness / concurrency | 7 | Lock/idempotency substrate rigorous; weaknesses at the seams |
| Architecture | 6.5 | Strong functional core; the gates around it are eroding |
| Security / poisoning | 6 | Backstops mostly real; weakest exactly where "hard guarantees" were claimed |
| Performance / scale | 6 | Read paths well-bounded; months-scale growth deferred with 1 silent bug |
| Product pragmatism | 6 | Right shape; zero quality measurement + 2 bugs choke the learning funnel |

**Combined: ~6.5/10.** Micro-engineering 8–9 (transactions, import-time invariant
asserts, lockstep enum↔CHECK, fail-closed-on-LLM, redact-before-everything). Macro
value-loop 4–5 today, because the system does not measure whether memory helps, and
three verified defects silently suppress its own purpose.

---

## P1 — Correctness defects that defeat the system's own intent

### F1 `[VERIFIED]` Promoted lessons never reach Active Memory (hot-context predicate)
- `db/repos/knowledge/hot-context.ts:56` — the hot LIST requires
  `(pinned = TRUE OR valid_until > now())`. A NULL `valid_until` on an unpinned row
  makes `NULL > now()` evaluate NULL → row excluded.
- `memory/manager/promote.ts:168-169` — every promoted entry is written
  `pinned: false, validUntil: null`.
- Net: once a lesson matures past probationary it is **counted** by
  `countActiveHotContextEntries` (`hot-context.ts:113-121`, which has *no* expiry clause
  at all — also miscounts already-expired rows) but can **never appear** in the hot list.
  Banner says N, list shows only pinned/legacy-TTL rows.
- The canonical predicate elsewhere keeps the NULL arm: `recall.ts:56`
  (`pinned OR valid_until IS NULL OR valid_until > now()`), `knowledge/crud.ts:416`.
  hot-context dropped it. This silently defeats the entire S6 maturity pipeline.
- **Fix:** add `valid_until IS NULL OR` to the list predicate; add the same expiry
  predicate to the count. One-liner + regression (matured `observed` entry with NULL
  TTL appears in BOTH list and count).

### F2 Cold-start banner steers the agent AWAY from search exactly when memory is searchable
- `engine/prompts/memory-section.ts:96-99` — "Long-term memory: empty … Skip
  long_memory_search — nothing to find" keys off `countActiveHotContextEntries()`,
  which excludes `inferred`/`hypothesis` sources AND `probationary`/`decayed` maturity
  (`hot-context.ts:37-38`).
- But fresh promotions start `probationary` (`policy.ts:130`) and dual-trace candidates
  are searchable for 7 days (`memory-candidates/crud.ts:604-606`). For the first
  days-to-weeks of real use, `long_memory_search` returns results while the prompt
  actively suppresses calling it. The "does it learn?" impression dies at first use.
- **Fix:** compute the banner from the *searchable* corpus (all active entries + live
  dual-trace candidates), or render "N fresh un-consolidated signals — long_memory_search
  can see them" instead of "Skip" when candidates/probationary entries exist.

### F3 Recurrence gate + 7-day dual-trace TTL = slow-recurring lessons can never promote
- Generalizations (kinds containing strategy/risk/lesson/pattern/heuristic — incl. the
  canonical `trade_lesson`, `kind-families.ts:18`) need `recurrenceCount ≥ 2` distinct
  executionIds (`policy.ts:90`). Recurrence is counted from `recallCandidatesTopK`, which
  filters `retrieval_until > now()` (`crud.ts:606`).
- `retain` never extends `retrieval_until` (`promote.ts:330-359`) and nothing revisits
  retained candidates. Two observations 8+ days apart each score recurrence 1 → retained
  → invisible after 7d, forever. An unanchored generalization (research-derived insight,
  no evidence_refs) has recurrence 0 permanently → can NEVER promote.
- For a trading agent whose best lessons recur on weekly/market-cycle cadence this is the
  deferral that bites first — and it is not on any deferral list (OD-4 covers
  rejected/expired retention, not retained-recall death).
- **Fix:** extend `retrieval_until` on a `retain` verdict (e.g. +60–90d), or exempt
  `status='retained'` from the TTL filter in the recurrence-cluster recall specifically.

### F4 `[VERIFIED]` Decay sweep starves every entry beyond the first 2000 (false comment)
- `engine/memory-manager/decay-sweep.ts:94` resets `afterId = 0` every run;
  `scanned += 1` counts every row regardless of no-op (`:118`); hard cap
  `DECAY_SWEEP_MAX_ENTRIES = 2000` (`:50,111`). Floor-level/below-delta rows still match
  the predicate (`status='active' AND decay_policy <> 'none'`) forever, so above 2000
  decayable entries every 3h run re-scans the same lowest-id 2000 and the tail NEVER
  decays — stays at full activation, hot-context-eligible, never reaches `decayed`.
- The comment at `:47-48` claims "The remainder is picked up on the next tick" — false;
  nothing persists the cursor. At ~8 promotions/day this is reached in well under a year.
- **Fix:** persist `afterId` across runs, or order the scan
  `last_decayed_at ASC NULLS FIRST` so the cap always targets the stalest rows; correct
  the comment.

---

## P1/P2 — Security: holes in the parts sold as the hard guarantees

### F5 The redactor misses realistic secret shapes — and suggest accepts them
- `lib/diagnostics/text-redaction.ts:48-78` was tested by hand against realistic inputs:
  - raw 64-hex private key, no `0x`/label → **plaintext** (no hit)
  - Solana base58 secret key (~88 chars, exceeds the 32–44 bound) → **plaintext**
  - `DATABASE_URL=postgres://user:pass@host/db` → **plaintext**
  - generic `API_TOKEN=<32 hex>` → **plaintext**
  - `0x`+64-hex raw key → only Tier-2 **masked** (`hardRedactCount=0`)
- `suggest.ts:201` rejects ONLY on `hardRedactCount>0` (or a scanned-string Tier-1 hit),
  so masked/plaintext cases are STORED and the candidate ACCEPTED. The promote-time
  re-redaction (`promote.ts:132-139`) calls the SAME `redact()` → identical miss.
- **Severity P1** (this is the boundary the whole write path trusts).
- BIP39 redaction is also defeated by punctuation (`text-redaction.ts:112-118` skips a
  match containing `.,;!?`) — a comma-separated 12-word phrase → plaintext (documented
  tradeoff, P3).
- **Fix:** add patterns for unlabelled `0x?[a-f0-9]{64}` in a key-ish context, base58
  64–88 runs, `://user:pass@` URI creds; and/or a length-based high-entropy reject in the
  suggest gate (any single hex/base58 token ≥ ~44 chars in persisted free text →
  reject). False positives are cheap (agent reformulates) — the module's own doctrine.

### F6 `user_confirmed` provenance bypasses the evidence ceiling, not tied to `isUserAffirmed`
- `clampSourceTier` (`consolidate.ts:280`) returns `user_confirmed` unconditionally
  whenever the judge emits it ("human is the verifier") — but nothing checks
  `signals.isUserAffirmed`. That signal is computed (`context-builder.ts:138-140`) and
  only fed to the prompt as advice; `planFromVerdict` never gates on it.
- A judge steered by poisoned transcript/tool content into emitting `user_confirmed`
  (with `isUserAffirmed=false`) bypasses the ONLY runtime grounding cap and lands at full
  hot-context weight (`user_confirmed ∈ HOT_CONTEXT_SOURCES`). Defense rests entirely on
  the judge honoring a prose rule against in-context untrusted data — the exact thing the
  threat model says not to trust.
- **Severity P2.** **Fix:** make `clampSourceTier` require `signals.isUserAffirmed===true`
  before honoring `user_confirmed`; else clamp to the ceiling.

### F7 `supersede` can target an arbitrary active entry; judge's id PREFERRED over conflict id
- `planFromVerdict` (`consolidate.ts:317-329`): `previousKnowledgeId =
  verdict.previousKnowledgeId ?? conflictKnowledgeId` — the judge's free-choice id wins,
  with no check it equals the deterministic conflict target, that `conflictFlag` was set,
  or that kinds match. `runSupersedeStatements` validates only existence + `status=active`
  + content-hash novelty. The judge prompt even hands it candidate ids
  (`renderNearDupLine`), and SERIAL ids 1..N are guessable.
- Net: poisoned candidate + steered judge can flip ANY good active lesson to `superseded`
  (removing it from recall/hot-context) and replace it with the poison successor —
  combined kill-and-inject, mechanically unconstrained on the target. Gets worse with
  corpus size (more good memory to kill, stable enumerable ids).
- **Severity P2.** **Fix:** constrain `previousKnowledgeId` to the deterministic-flagged
  set (`conflictKnowledgeId` or a `nearDupTopK` id); reject→retain otherwise; assert
  `predecessor.kind === candidate.kind` in supersede. The deterministic target should win;
  the judge only decides supersede-vs-reject.

### F8 `EMBEDDING_BASE_URL` has no locality gate and is renderer-settable
- `embeddings/config.ts:44-49` accepts any `http(s)://` host; the vex-app schema
  (`embedding.ts:15-28`) only rejects embedded credentials, not remote hostnames; no
  `127.0.0.1`/loopback enforcement anywhere. `embedDocument` sends `title+summary` to that
  URL. Combined with F5, a secret missed in a lesson title/summary is transmitted to
  whatever host the (untrusted-per-CLAUDE.md) renderer configured.
- **Severity P2** (latent; becomes live the day a hosted embeddings default is added).
- **Fix:** loopback/private-host-only gate in `loadEmbeddingConfig`/`isValidEmbeddingUrl`
  unless an explicit, separately-confirmed "remote embeddings" opt-in is set.

### F9 Knowledge export writes plaintext `content_md` with default file perms
- `scripts/knowledge-export.ts:228,248` — `createWriteStream(args.out)` default mode
  (world-readable under typical umask); only a help-text warning. P3 (maintenance CLI, not
  IPC-exposed). **Fix:** open with mode `0o600`.

---

## P1/P2 — Correctness: failure-exhaust paths under-engineered

### F10 Poison-pill candidate = unbounded recurring LLM cost
- A candidate that repeatedly crashes the judge stays `pending` forever: `suggest.ts:341`
  inserts `retainUntil: null`, so the D10 TTL backstop (`deterministic-stage.ts:227-229`)
  never fires; each job burns 3 attempts → `permanently_failed`; the sweep's "active job"
  check counts only pending/running/failed (`executor.ts:172-176`), so every 3h tick
  enqueues a fresh job forever. No candidate-level attempt cap / dead-letter exists.
- Per the repo's own poisoning threat model, an adversarial lesson that reliably breaks
  judge JSON is a permanent ~24-LLM-calls/day cost leak + unbounded `memory_jobs` growth.
- **Severity P2.** **Fix:** set a real `retainUntil` at suggest time, and/or count
  per-candidate failed items and terminalize after N cross-job failures.

### F11 Reconcile permanent failure is a silent forever-dead-end
- `resetReconcileJob` is documented as "the ONLY revive" (`memory-jobs/crud.ts:99,158`)
  and has **zero production callers**. After max_attempts (e.g. one multi-hour OpenRouter
  outage during a flip that needs the judge), the `(entry, version)` key goes
  `permanently_failed`; the version never bumps, so every future ledger wake for that
  entry hits the dead key and no-ops. The lesson's outcome diverges from the ledger
  permanently and invisibly (inspector is read-only, `last_error` hidden).
- **Severity P2.** **Fix:** have the maintenance sweep re-arm `permanently_failed`
  reconcile rows older than a cool-down (the function already exists), or emit a loud
  divergence counter.

### F12 Cross-job stranded item burns a job to permanently_failed in futile retries
- Sequence (`executor.ts:245-247,295-303,347`, `memory-job-items/crud.ts:84-115`,
  `memory-decisions/crud.ts:192,322-337`): job A's item fails transiently → a new suggest
  enqueues job B unconditionally → B decides the candidate → A's retry revives its own
  failed item → idempotent-close finds B's decision but `markItemDone` requires
  `d.job_id=i.job_id` and `uniq_mji_decision` forbids linking B's decision → permanently
  "unclosed" → markFailed loop until A is `permanently_failed`. No corruption, but
  guaranteed wasted attempts + a stuck `failed` item + a misleading terminal job.
- **Severity P2.** **Fix:** in idempotent-close, when `dec.jobId !== job.id` terminalize
  the item with a bounded code (`decided_elsewhere`) and count it closed; exclude
  non-pending-candidate items from the revive query.

### F13 Decay transition and its audit row are not atomic (D-AUDIT violable)
- The sweep calls `decayEntry` without a tx (`decay-sweep.ts:71`), so
  `applyMaturityTransition` and `recordMaturityEvent` are separate pool statements
  (`maturity.ts:309-347`); a crash between them = transition with no audit row. `stop()`
  awaits only the tick, never an in-flight sweep (`executor.ts:196-206`) → quit teardown
  can hit exactly this window. **Severity P3.** **Fix:** wrap transition+audit in one tx;
  track/await the in-flight sweep in `stop()`.

### F14 Session-memory stale embedding has no repair path
- `resolve-item.ts:121-135` returns success "stale until a future re-embed pass", but no
  re-embed pass exists for `session_memories` (only knowledge has `reembed.ts`). A
  transient embed-service failure leaves body/vector divergence permanently. P3.

---

## P1/P2 — Process & architecture: the gates around the code are eroding

### F15 `[VERIFIED]` The 1003-line eval harness never runs — and is broken
- `src/__tests__/integration/memory/long-mission.test.ts` (37 KB) matches NEITHER vitest
  config: unit config excludes `src/__tests__/integration/**`; integration config includes
  only `*.int.test.ts`. `[VERIFIED]` file exists, name lacks `.int.`. It holds the
  cross-session leak guard + FIX-2 hot-context source-filter scenarios; line ~312 asserts
  `e.source` on `ActiveKnowledgeListItem` — a field that does not exist on the type / is
  not in the SELECT — so it would FAIL if it ever ran. It was even edited during S9 while
  dead.
- **Severity P1.** **Fix:** `git mv … long-mission.int.test.ts` + fix the stale assertion.

### F16 `[VERIFIED]` The memory integration suite is not in CI at all
- `.github/workflows/ci.yml` runs root `pnpm test` (unit), vex-app `pnpm test`, e2e — no
  `test:integration` job, no postgres service. `[VERIFIED]` (grep: no integration ref).
  Every concurrency proof the architecture leans on (claim-lost, owner-check,
  idempotent-close, reinforce, reconcile, graph-v1) runs only when a dev runs it locally —
  so it rots exactly like F15 did.
- **Severity P1.** **Fix:** add a `test:integration` job with a postgres+pgvector service;
  the config already serializes (maxWorkers:1). Note edge-case rule §4: such jobs must
  `pnpm install` BOTH the root and vex-app trees.

### F17 Type-gate erosion, actively compounding
- vex-app `lint` checks only shared+e2e (`vex-app/package.json:26`); main carries ~591
  strict-profile errors (169 in `../src/vex-agent` via `@vex-lib`). S10 knowingly added +2
  (`memory-inspector-db.ts` replicating the broken VexError shape of `long-memory-db.ts`)
  plus an `exactOptionalPropertyTypes` error in S3's `search.ts:444`. Root
  `tsconfig.test.json` is wired into no script/CI and carries ~239 errors (230 in
  `src/__tests__/vex-agent`) — which is how F15's dead assertion survived. No ratchet.
- **Severity P1.** **Fix:** wire `tsc -p tsconfig.test.json` + vex-app main into CI with a
  max-error count (fail-on-increase); fix the 2 new inspector errors + `search.ts:444` now.

### F18 Layering inversion: domain policy lives in the worker layer
- Nine `memory/manager/*` files import constants from `engine/memory-manager/policy.ts`
  (`NEAR_DUP_COSINE`, `RECURRENCE_PROMOTE_MIN`, `PROBATION_ACTIVATION`, the `JUDGE_*` caps)
  — pure domain policy with zero engine consumers — creating a memory↔engine directory
  cycle. Meanwhile `NEAR_DUP_K`/`CLUSTER_K` sit inline in `consolidate.ts:166-167`. Three
  homes for one concern. **Severity P2.** **Fix:** move domain constants to
  `memory/manager/policy.ts`, leave only worker-cadence engine-side.

### F19 `consolidate.ts` is the funnel and is accreting (~798 lines, ~6 responsibilities)
- DI wiring + ledger-deps + verdict→plan mapping + decide pipeline + atomic apply +
  reinforcement + graph savepoint + error class + re-exports. `applyDecisionAtomically`
  is now a 5-optional-key bag (`consolidate.ts:609-625`) — the shape rules/20 §10 flags.
  **Severity P2.** **Fix:** split `consolidate-deps.ts` + `verdict-mapping.ts` (both pure,
  already separately tested); fold the optional args into the `CandidateDecision` object.

### F20 Institutionalized copy-paste
- vex-app `withClient`/`dbUnavailable`/`dbError` now in **8 copies** under
  `vex-app/src/main/database/` (S9/S10 added the 7th/8th, against rule 17). Repo helpers
  `vectorLiteral` ×5, `toIsoOrNull` ×7 (3 signatures), `clampUnit` ×3, each citing the
  previous copy as "precedent". **Severity P3.** **Fix:** extract
  `vex-app/.../database/with-client.ts` + `db/repos/_shared/`.

### F21 Error-context black hole + minor telemetry misuse
- `applyGraphWritesFailOpen` swallows the exception (`catch {` `consolidate.ts:778`),
  logging only `errorCode: "graph_apply_error"`; tick/job failures discard the real
  message. The allowlist HAS `errorKind` — nothing populates it. Also `memory-system-v2.md`
  promises `correlationId` on transition logs but no call site ever passes it (dead
  allowlist key since S0); `decay-sweep.ts:133` logs scanned-count under the `queueDepth`
  key (semantic misuse). **Severity P2/P3.** **Fix:** populate `errorKind` with the error
  constructor name + `pg` code (bounded tokens); use `instanceof ClaimLostError` instead of
  `msg.includes("claim lost")` (`executor.ts:356`); doc/key hygiene.

---

## P1/P2 — Performance & scale (single-user desktop, months horizon)

### F22 memory_candidates: unbounded retention + per-suggest sequential scan
- OD-4 open (`memory-system-v2.md:269`); zero `DELETE FROM memory_*` anywhere. Terminal
  candidate rows (~3 KB embedding each) accumulate forever.
  `findLatestCandidateByContentHash` runs on EVERY suggest (`suggest.ts:273`) but the only
  content_hash index is partial `WHERE status='pending'` (`001:711`) → full seq scan of an
  ever-growing table on the agent's hot write path. **Severity P1 (scale).**
  **Fix:** `CREATE INDEX idx_mc_content_hash ON memory_candidates(content_hash,
  recorded_at DESC)`; close OD-4 with a retention prune in the 3h sweep (decisions stay as
  the audit).

### F23 No ANN path decided — only deferred, with a migration cost
- `001:125-126` admits the `vector` column has no typmod → adding ivfflat/hnsw later needs
  a column re-type on shipped user data. Exact scans run ×2 per search and up to 32 per
  16-candidate consolidate batch. Fine to tens of thousands of rows on desktop, but
  pre-release is the cheapest moment to decide. No count/latency telemetry, so the cliff is
  invisible. **Severity P2.** **Fix:** decide `vector(768)` + HNSW now (the per-row
  model/dim filter already guarantees single-model reality), or document the measured
  threshold + add telemetry.

### F24 memory_jobs grows 1:1 with suggests; jobs-summary aggregates the full table
- `enqueueConsolidateJob` is a plain INSERT on every accept incl. duplicates
  (`suggest.ts:358`); no dedupe, no pruning. The inspector `getJobsSummary` LEFT JOIN
  aggregates every job ever created before LIMIT, no index on `memory_jobs(created_at)` →
  degrades to the 5s timeout. **Severity P2.** **Fix:** partial-unique pending-consolidate
  index + ON CONFLICT DO NOTHING; rewrite summary as top-N-then-LATERAL; add the index.

### F25 Per-turn cost + per-candidate kind census
- 3 linear knowledge scans every turn (`turn-context.ts:55-59`); `listActiveKindCounts`
  runs per ESCALATED candidate (up to 16 identical GROUP BYs/batch, hoistable to job
  level, `consolidate.ts:515,199`). `findCandidateByPromotedKnowledgeId` has no index on
  `promoted_knowledge_id`. Dead substrate: `memory_edges.fact_embedding` always NULL while
  a partial index for it can never be hit. **Severity P3.** **Fix:** collapse the 3 reads;
  hoist the census; add the index.

---

## P1 — Product: nothing measures whether memory helps

### F26 Zero memory-quality feedback loop
- No `last_used`/`usage_count`/`retrieval_count` anywhere; retrieval never touches
  activation; memLog records only aggregate per-search counts, never which entries were
  served or whether they influenced a decision. `scripts/cross-lingual-benchmark.ts` is a
  one-off manual language-pivot gate, not a recall-precision eval of the real corpus. Every
  tuned constant (0.93/0.85/0.9 cosines, 0.6/0.7 weights, decay half-lives) is hand-picked
  with no validation path. **Severity P1 (product).** **Fix:** log served entry ids per
  search; add `last_retrieved_at`/`retrieval_count` to knowledge_entries; build a golden
  recall eval (this audit's live-LLM harness is that eval).

### F27 Over-build relative to zero users / zero measurement
- S6b regime (daily LLM over Tavily+Twitter, ~648 LOC + table) modulates decay half-life
  30d→60d/15d, imperceptible until months of corpus. S8 graph expansion fills leftover
  slots with content-empty pointers of unmeasured value. ~19k LOC prod + ~13k LOC tests
  shipped before one real lesson exists, while the core funnel carries F1/F2/F3.
  **Severity P2 (judgment).** **Recommendation:** freeze/flag S6b + graph expansion behind
  the eval; fix the funnel (F1–F3) first; the 80/20 core is suggest + redaction gates +
  dedupe + judge + plain vector search + hot context + compact/session chunks.

### F28 Kind-name substrings silently determine promotability; agent never told
- `kind` is free-form, but `breakout_pattern` vs `breakout_fact` flips the recurrence ≥ 2
  requirement (`kind-families.ts:32-34`). No prompt mentions this. **Severity P2.**
  **Fix:** one sentence in the suggest description.

### F29 Strongest confirmation (exact re-suggest) is the only signal that does nothing
- `suggest.ts:259-267` short-circuits `already_known` without reinforcement; `reinforceEntry`
  is reachable only via the manager's near-dup path. Non-trade lessons (user preferences)
  can sit probationary, excluded from hot context, indefinitely. **Severity P2.**
  **Fix:** reinforce on the exact-dup short-circuit in a small tx.

### F30 Chunker output language is honor-system while the agent path is hard-gated
- Track 2 chunker is only prompt-instructed to write English (`chunker-call.ts:82`);
  `checkLongMemorySuggestEnglish` is applied nowhere outside suggest. A disobedient chunker
  silently rots session memory for non-English users, undetected. **Severity P2.**
  **Fix:** reuse the english-check on chunker output (re-prompt once, then accept-with-flag
  + a language telemetry counter).

---

---

## P1 — Found by the LIVE harness (run #1, 2026-06-12) — NOT static review

### F31 `[VERIFIED-LIVE]` judgeVerdictSchema is brittle against a real model's JSON habits → fail-closed means a swapped-in judge promotes NOTHING
- First live run of the eval harness with the REAL judge model `deepseek/deepseek-v4-flash`
  (real Gemma embeddings, ephemeral pg) threw `memory_judge_schema_invalid` at
  `judge.ts:109` on a genuine consolidation:
  - `previousKnowledgeId`: schema is `z.number().int().positive().optional()` (undefined
    OR number); the model emitted `previousKnowledgeId: null` → rejected (null ≠ undefined).
  - `rejectReason`: `memoryDecisionRejectReasonSchema.optional()`; the model emitted a
    value not in the closed enum (placeholder/null on a non-reject verdict) → rejected.
  - The schema is `.strict()` (`judge-schema.ts:77-99`), so any extra/placeholder field or
    null-for-optional fails the whole verdict.
- Root cause: DeepSeek v4-flash (like many models) emits a COMPLETE object with placeholder
  `null` values for inapplicable optional fields. The strict schema treats that as malformed
  → `callJudge` throws → no promoting fallback (by design, §949) → the item fails → 3 retries
  → `permanently_failed`. **Net: with this model, essentially NOTHING gets promoted.**
- **VERIFIED across 2 independent live runs — TWO failure modes, intermittent:**
  - Run 1: valid-rate 67% (2/3) — `schema_invalid=1`.
  - Run 2: valid-rate 33% (1/3) — `schema_invalid=1` AND `judge_timeout=1`.
  - The second mode is LATENCY: the consolidation/outcome judge calls measured **38s / 46s /
    56s** wall-clock against `JUDGE_TIMEOUT_MS = 30_000` → the 30s race fires → `judge_timeout`
    → throw → no promotion. deepseek-v4-flash is simply too slow for the 30s cap on the
    full-context judge prompt.
  - The `reconcile` judge (a SHORTER/simpler verdict — lesson header + old/new outcome enums,
    no full transcript) validated in BOTH runs (~25s, under the cap). So the failures
    correlate with the FULL judge prompt: bigger context = slower (timeout) and a richer
    schema = more placeholder nulls (schema_invalid). This is strong evidence the brittleness
    is specifically in the heavy consolidation judge path.
- This is the fail-closed safety property *working* — but it also means the judge is
  effectively single-model-coupled to whatever JSON style the original model (the in-turn
  agent model) happened to produce. Any model swap (a supported, expected operation — the
  judge uses `AGENT_MODEL`) can silently zero out memory formation.
- **Severity P1** (it breaks the core funnel under a supported config; only the live harness
  could find it — no static review or stubbed test would).
- **Fix (production, Batch F / judge-robustness — recommend FIRST, it blocks measuring the
  judge path at all):**
  1. **schema_invalid:** before strict validation, preprocess the parsed judge JSON to drop
     null-valued optional keys (or make the optionals `.nullable()` and coerce null→absent in
     `planFromVerdict`); strengthen the prompt OUTPUT CONTRACT: "omit previousKnowledgeId
     unless verdict=supersede; omit rejectReason unless verdict∈{reject,expire}; never emit
     null". Keep the closed-enum rejection for genuinely out-of-vocab values (backstop stays).
  2. **judge_timeout:** the 30s `JUDGE_TIMEOUT_MS` is too tight for a slow model on the full
     prompt. Either raise it (config), or — better — keep the cap but recognize a timed-out
     judge as a transient (already retried), AND consider trimming the judge prompt for
     latency. This is a tuning/robustness call, not a safety relaxation (fail-closed stays).
  - The harness now measures **"judge output-valid rate"** continuously, so model-compat is a
    permanent metric (run-to-run variance is expected and recorded).

### F32 `[LIVE]` recurrence clustering at cosine 0.9 may not escalate real-worded lessons
- The `consolidation-judge` scenario seeded "two distinct executions in the same Gemma
  neighborhood (recurrence ≥2)" but the candidate did NOT reach the judge (`llmCalls=0`) —
  it terminated deterministically. Either the two differently-worded lessons did not cluster
  above `RECURRENCE_CLUSTER_COSINE = 0.9` on REAL Gemma vectors (so recurrence stayed 1 →
  D7 `premature_generalization` retain), or the candidate's own anchors weren't counted as
  expected. **Severity P2 (measurement + possible tuning signal):** 0.9 cosine is a high bar
  for real embeddings of paraphrased lessons; if real recurring lessons rarely cluster, the
  generalization-promote path is harder to trigger in practice than the design assumes.
  Needs harness-side seeding fidelity AND a real-corpus measurement of typical
  same-lesson cosine. (Distinct from F3, which is the TTL-death of slow-recurring lessons.)

---

## What held up under fire (do not "fix")
Atomic apply + audit; idempotent-close (no double-promote across all walked interleavings);
`wake_pending` re-arm (no constructible lost-wake); fixed compounding decay; memLog
structural guard; inspector DTO strip-lists + `.strict()`; clampSourceTier for non-user
tiers; closed graph vocabularies + tighter-than-substrate extraction bounds; advisory-only
end-to-end; fail≠empty prompt semantics; import-time invariant asserts on ranking
constants; lockstep enum↔CHECK tests; agent-facing tool descriptions ("genuinely good LLM
steering").

---

## Deferrals already on record (context)
- OD-4 retention (rejected/expired candidates, session_memories TTL) — open.
- `knowledge_entries` → `long_memory_entries` rename — separate large slice.
- merge/supersede structured payload — gated on Judge Context v2 (now landed).
- Track-2 chunker output validation — "docelowo" (now F30).
