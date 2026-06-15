# Memory Eval — Recon + Divergence Debug + Expansion Plan

> Produced by the `memory-eval-recon` workflow (16 Opus 4.8 agents: 9 subsystem/harness mappers + 6 divergence debuggers + 1 synthesis). Read-only recon. Companion to `audit-findings-v2.md`, `sim-eval-design.md`, and `eval-report-latest.md`.

## 1. How Vex memory works (on real Solana-trading data)

End-to-end, a memory flows through eight stages. Each is the real code path the harness drives over 90 simulated days.

**1. Write door (S2)** — `handleLongMemorySuggest` (`src/vex-agent/tools/internal/long-memory/suggest.ts:183`) validates untrusted agent params via Zod, then runs four gates in order: secret redaction (`redactFreeText` :91 + `scannedStringsContainSecret` :120 → `redact` in `src/lib/diagnostics/text-redaction.ts:86`), live-state exclusion (`scanLiveState`, `src/vex-agent/memory/exclusion-rules.ts:97`), English-by-contract (`checkLongMemorySuggestEnglish`, `src/vex-agent/memory/english-check.ts:179`), and content-hash dedup. Survivors are embedded (redacted title+summary only, fail-loud) and atomically inserted+enqueued. *On real data:* "Adding to WIF on a confirmed breakout produced outsized realized gains" passes all gates, masks no address, and lands as a pending candidate with a consolidate job.

**2. Async judge — escalation / dedup / recurrence (D1–D11)** — `consolidateCandidate` (`src/vex-agent/memory/manager/consolidate.ts:398`) runs the pure deterministic stage `runDeterministicStage` (`src/vex-agent/memory/manager/deterministic-stage.ts:148`); the first terminal rule wins (D1 live-state, D4 exact-dup, D5 near-dup with the `differsOnNumberOrDate` guard :130, D7 premature-generalization :223, D8 mundane, D9 low-confidence, D10 TTL). Only escalation reaches the live OpenRouter judge (`callJudge`, `src/vex-agent/memory/manager/judge.ts:79`). *On real data:* a WIF lesson with two distinct execution anchors (recurrence=2) survives D7 and escalates; the judge returns `promote` with `regimeTags=['memecoin_entry']`.

**3. Promote + supersede + clamp** — `clampSourceTier` (`consolidate.ts:276`) hard-caps the judge's tier to the evidence ceiling (D-GROUND; `user_confirmed` exempt), `planFromVerdict` (:293) resolves the supersede target, and `applyDecisionAtomically` (:609) does owner-check `FOR UPDATE` → `applyDecision` (`promote.ts:381`) → fail-open graph writes, all in one tx. *On real data:* a range-regime "WIF momentum is dead, mean-reversion only" lesson supersedes the bull-era thesis; the predecessor flips to `superseded` and its edges retract.

**4. Dual-trace retrieval / ranking** — `recallLongMemoryTopK` (`src/vex-agent/db/repos/knowledge/recall.ts:28`) + `recallCandidatesTopK` feed `blendAndRank` (`src/vex-agent/memory/long-memory-retrieval-policy.ts:296`). Knowledge scores `rerankScore × sourceTierWeight × activationFactor`; candidates score `similarity × 0.6` with no boosts. The invariant `SOURCE_SOFT_WEIGHT(0.7) × ACTIVATION_MIN_FACTOR(0.88) ≥ CANDIDATE_DUAL_TRACE_WEIGHT(0.6)` (asserted at import) guarantees confirmed knowledge always outranks a candidate at equal similarity. *On real data:* a query "rug check before scaling" ranks the observed WIF lesson (≈0.98) far above its inferred dual-trace candidate (≈0.47).

**5. Maturity / decay / regime (S6a/S6b)** — `decayedActivation` (`src/vex-agent/memory/manager/maturity-policy.ts:216`) is closed-form `max(0.03, activation × 0.5^(days/halfLife))`; `runDecaySweep` (`src/vex-agent/engine/memory-manager/decay-sweep.ts:90`) resolves `effectiveRegime` once (dwell-confirmed two snapshots) and modulates half-life (`regimeHalfLifeDays`: match 60d, mismatch 15d, neutral 30d). *On real data:* a `regime_tags=['bull']` "buy every dip" heuristic fades from full activation to ≤0.2 (decayed tier) once the effective regime confirms bear around sim-day 62.

**6. Reconcile — ledger-wake outcome flip (S7)** — a closing trade calls `enqueueLedgerWake` (`src/vex-agent/memory/ledger-wake.ts:108`) on `instrumentKey`; `processReconcileJob` (`src/vex-agent/engine/memory-manager/reconcile.ts:203`) re-resolves the outcome (`resolveOutcome` → `resolveSpotOutcome`, `outcome-resolver.ts:117`), and `consequenceFor` (`reconcile-policy.ts:113`) maps a positive→negative flip on a terminal status to `flip_judge` → quench/invalidate/retain. *On real data:* a K-lesson promoted on a +$65 WIF win is re-resolved to a −$57 loss when the close lands, flipping signal and quenching activation to ≈0.15.

**7. Knowledge graph (S8)** — `buildGraphPlan` (`src/vex-agent/memory/manager/entity-extraction.ts:350`) extracts entities PRE-TX (LLM never holds locks), `applyGraphPlan` (:467) writes bi-temporal entities/edges under `SAVEPOINT graph_plan` (fail-open), and `invalidateEdgesForOrigin` (`memory-edges/crud.ts:441`) retracts a superseded lesson's edges. *On real data:* a WIF lesson emits entities `{WIF:token, Raydium:protocol, Solana:blockchain}` and edge `WIF→traded_on→Raydium`; superseding it invalidates that edge while preserving audit history.

**8. Anti-poisoning glue** — the source-tier clamp (3) and the `0.6 < 0.7` candidate-weight invariant (4) together mean no judge claim and no fresh candidate can outrank human-verified knowledge; redaction runs twice (door + promote defense-in-depth).

## 2. What the harness deploys

**Corpus** (`_world-corpus.ts`, `assertCorpusCounts` :1570 enforces at module load): exactly 100 memories across 18 taxonomy classes — A:12 (trade lessons), B:8 (recurrence pairs), C:6, D:5, E:6 (slow recurrence >7d), F:6 (two supersession chains F01→F02→F03, F04→F05→F06), G:6 (three conflict pairs), H:10 (graph clusters), I:5, J:6 (near-dups), K:4 (reconcile flips), L:5 (regime-bound decay), M:3 (time-only decay), N:4/O:3/P:5/Q:2/R:4 (door-class adversarial). Plus 30 trades (10 bull wins, 4 K-winners, 6 range mixed, 5 bear losses, 4 closing) and 10 regime snapshots (bull×3, range×3, bear×4). Counts verified against source.

**Oracle** (`_oracle.ts`, `assertOracleCoverage` :1335): exactly one `OraclePrediction` per memory id, importing **zero** policy logic — only the bounded verdict vocabulary (`promote|retain|reject|supersede|expire`), tier ceiling (`none|weak|moderate|strong`), reconcile consequence (`quench|invalidate|reinforce|retain`). Plus 18 `RetrievalOracle` queries (soft `expectedTopIds` precision@k; hard `mustNotAppearIds`). Known gaps F5 (secret leaks) and F7 (unconstrained supersede) are encoded as `knownGap` findings, not silent passes.

**Runner S4** (`runStream`, `_sim-runner.ts:356/:882`): `buildEventStream` (:199) stable-sorts by `(simDay, kindRank, seq)` with `trade(0)→regime(1)→memory(2)`; `advanceClock` (:417) captures ONE `wallNow` per checkpoint. `runMemoryItem` (:510) dispatches by `entryVia`: door-class → real `handleLongMemorySuggest`; `seedPromotedLessonDirect` → active entry bypassing the judge (F/G/H/L/M/K predecessors); `seedGemmaCandidate` → deterministic candidate reaching the judge; `suggest→judge` → full door+judge path via `driveConsolidateCapturingJudge`. K items wire a reconcile target (`linkPromotedCandidateForReconcile` :690) and drive the wake (`runReconcileForItem` :747, `processReconcileForEntry` :801).

**Scorer S5** (`_sim-scorer.ts`, `captureFinalSnapshot` :113): reads real DB state, runs 18 queries through real Gemma embeddings. **Hard gates**: door-rejects (clean shapes), secret-clean, must-not-appear (precondition-aware), superseded-inactive, reject-no-row, decay floor/threshold, reconcile enqueue/flip, tier ceiling. **Soft metrics**: promotion-correctness, supersession-target, graph-presence, steered-judge, retrieval-precision@1. F31 (invalid judge verdict) drops items from soft denominators rather than failing them.

**Clock** (`_sim-clock.ts`, `toWall` :72): projects sim-days onto a fixed epoch via a single `wallNow` per checkpoint so timestamps are valid-ISO but reflect sim-day; `backdateCandidate/KnowledgeEntry/RegimeSnapshot` align created/updated stamps.

**S6 full-run gap (confirmed):** `e2e-memory-correctness.int.test.ts:63-67` — the subset resolver returns `SUBSET_IDS` when `VEX_E2E_SUBSET` is unset or `"10"`, and otherwise a *slice* of the 10-id subset (`SUBSET_IDS.slice(0, n)`). **No caller ever passes all 100 corpus ids.** The full-corpus path is unreachable from the test today; every reported metric is a 10-item smoke run.

## 3. Divergence ledger (root causes)

Ordered: real memory bugs first, then calibration, then artifacts.

### REAL MEMORY BUG

**D1 — Secret leak at the door (F5).** *Symptom:* of the 5 P items, only P03 (BIP39) and P04 (`sk-` API key) hard-reject; P01 (88-char base58), P02 (bare 64-hex), P05 (`postgres://` URI) pass redaction (`hardRedactCount=0`), reach `insertCandidate`, and persist the secret in `contentMd` — an F5 hard-invariant violation. *Root cause:* three redaction gaps, verified against source — `SOLANA_ADDRESS_RE` is `{32,44}` (`text-redaction.ts:78`) so an 88-char base58 string is out of range; `RAW_HEX_KEY_RE` (`:51`) requires the literal label `private_key|seed_key` so P02's "execution key hex" label misses; **no Tier-1 pattern exists for DB connection URIs** at all. The gate at `suggest.ts:201` (`hardRedactCount > 0 || scannedStringsContainSecret`) therefore never fires. *Classification:* **real_memory_bug**. *Fix shape:* **production** redactor change — widen `SOLANA_ADDRESS_RE` to capture longer base58 (or add a long-base58 Tier-1 rule); broaden `RAW_HEX_KEY_RE` to any `…key…[:=]<64hex>` label; add a `postgres|mysql|mongodb(+srv)://user:pass@` Tier-1 DSN rule. All three are exfiltration-class → Tier-1 hard-redact. *Confidence: high.* The harness is correct to surface this as a tracked finding, not a green pass.

### CORPUS CALIBRATION

**C1 — F03 retains instead of escalating to supersede F02.** *Symptom:* F03 (3rd link of the chain) returns deterministic `retain`, judge never reached (`llmCalls=0`); oracle expected `supersede(F02)`. *Root cause:* D7 premature-generalization fires — `deterministic-stage.ts:223` returns retain when `isGeneralization && recurrenceCount < RECURRENCE_PROMOTE_MIN(2)`. F03's recurrence is 0 because F02 was seeded via `seedPromotedLessonDirect` (no candidate row), so `recallSimilarCandidates` finds no cluster sibling. Policy-correct rejection of an unsupported generalization, not a code bug. *Classification:* **corpus_calibration**. *Fix shape:* **test-only** — reseed F02 as `seedGemmaCandidate` (clusterable) or give F03 its own trade-execution anchors to establish recurrence ≥1; alternatively downgrade the oracle to expect retain. *Confidence: high.*

**C2 — K reconcile no-op (no flip).** *Symptom:* K02 completes with `decisionType=null`, `outcomeVersion=0`; positive never flips to negative. *Root cause (verified in corpus):* K-winners carry a full buy+sell roundtrip — e.g. `T-BONK-K2` (`_world-corpus.ts:290`) buys 7B and sells 7B, fully closing the lot via FIFO. The closing trade `T-BONK-K2-CLOSE` (`:313`) is a bare 7B sell against zero open lots, producing a `shortfall` match with `realized_pnl_usd=NULL`. `resolveSpotOutcome` (`outcome-resolver.ts:135`) correctly filters to `matchKind='matched' AND pnl !== null`, so `matchedRows=0` and the gate at `:142` never reaches `closed/negative`; combined with the candidate's evidence pointing only at the original win execution, `outcomeDelta` reports "unchanged". Production behavior is correct (no false precision without a matched lot). *Classification:* **corpus_calibration**. *Fix shape:* **test-only** — strip the sell leg from the four K-winners (`:289-292`) so the close matches an open buy lot, OR add an intermediate buy before each close, OR seed the closing executionId into the candidate's `evidenceRefs`. *Confidence: high.*

### SUBSET ARTIFACTS

**A1 — Retrieval precision starvation.** *Symptom:* precision@1 ≈13%; 10–13 of 15 queries have empty/partial `expectedEntryIds`. *Root cause:* the oracle's 18 queries (49 expected slots) were authored for the 100-item corpus; the 10-item subset contains only 6 of those slots. `_sim-scorer.ts:976` correctly filters missing ids, exposing the starvation. *Classification:* **subset_artifact**. *Fix shape:* test-only — mark retrieval `softDimensions`, build a 20–30 item retrieval-coverage subset, or measure precision only on full-corpus runs. *Confidence: high.*

**A2 — Graph dimension 33%.** *Symptom:* 3 items have `expectedGraph` but only A01 produces entities. *Root cause:* K02 and H01 are seeded via `seedPromotedLessonDirect` (`_sim-runner.ts:534`), bypassing the judge and thus `buildGraphPlan` (`entity-extraction.ts:350`); extraction only runs on judge `promote/supersede`. *Classification:* **subset_artifact**. *Fix shape:* test-only — expand the subset to include `entryVia='suggest'` items with `expectedGraph` (A02–A14, C03, D0x, H02–H05, J0x), or mark seeded-cluster-owners as architectural-only. *Confidence: high.*

## 4. What is missing for rigorous, debuggable tests

Ranked by what each blocks.

1. **No full-corpus caller (blocks (a)).** Confirmed at `e2e-memory-correctness.int.test.ts:63-67`: every path returns `SUBSET_IDS` or a slice. There is no `VEX_E2E_SUBSET=full`/`=100` branch and no `resolveSubset(allIds)` call. *Blocks:* running 100 items, all 18 retrieval queries with coverage, both supersession chains, all 4 K-flips, all 5 L-decay and 3 M-decay canaries. Until this exists, every metric is a 10-item smoke signal mislabeled as an eval.

2. **K-flip and F/G-supersession can't fire for real (blocks (b)).** C1 (D7 starves F03) and C2 (roundtrip K-winners leave no open lot) mean the two highest-value learning behaviors — outcome reversal and thesis evolution — are structurally un-exercised. Even a full-corpus run reproduces both unless the corpus is recalibrated. *Blocks:* any claim that reconcile/supersede works end-to-end on real ledger data.

3. **No per-subsystem failure attribution (blocks (c)).** The scorer emits dimension pass/fail but the divergence triage (D7 vs seeding vs redactor) required manual code reading. There is no machine-readable capture that tags a failure with the responsible gate. *Blocks:* debuggability. Add structured cause-codes to `RunCapture` (e.g. `deterministicReason`, `outcomeResolveReason`, `redactionMissShape`) so the scorer can print "K02 no-op: shortfall (no matched lot)" instead of "decision=null".

4. **Oracle drift vs wrongness — the TPR problem (blocks (d)).** The oracle is genuinely independent (zero policy imports, verified). But "system ≠ oracle" today is hand-triaged into bug/calibration/artifact with no recorded rationale persisted into the report. The F5/F7 `knownGap` mechanism is the right pattern; it just isn't generalized. *Blocks:* an oracle that can distinguish "the system is wrong" from "the oracle prediction is stale" without a human in the loop each run. Promote `knownGap` to a first-class `divergenceClass` on every prediction, and make the scorer emit a triage column.

5. **Live-judge non-determinism is unbounded.** OpenRouter verdicts vary run-to-run; F31 silently shrinks soft denominators. *Blocks:* reproducibility. Surface the F31 denominator in the report ("X/100 unmeasured under F31").

## 5. 30-entry Solana/perp expansion plan

Thirty new entries chosen to stress the subsystems the current corpus under-exercises. **Counts only — no entries authored.**

| # | Theme | Target subsystem (under-exercised) | Oracle class added | New trades/regimes? |
|---|-------|-----------------------------------|--------------------|----------------------|
| 4 | **Perp funding-rate lessons** (negative funding bleed, funding-flip entry timing) | Reconcile (S7) + maturity decay | `promote`/strong + `reconcile:quench` flips | 4 perp executions + 2 closing (real funding-driven loss) |
| 4 | **Liquidation discipline** (forced-liq post-mortems, margin buffer rules) | Reconcile flip + supersession | 2× `supersede` chain + 2× `reconcile:invalidate` | 2 liq-event executions + closes |
| 4 | **Memecoin rug / honeypot patterns** (LP-pull, sell-tax, mint-authority-live) | Graph (S8) clusters + retrieval must-not-appear | `promote`/moderate + graph entities | No trades; new graph cluster ids |
| 4 | **Perp basis / leverage-regime** (basis compression, leverage scaling by vol regime) | Maturity regime decay (S6b) + conflict | `conflict` pair (G-style) + regime-bound `L`-style decay | 2 regime snapshots (perp-specific vol axis) |
| 3 | **LP / MEV** (IL on concentrated LP, sandwich exposure, JIT) | Graph cluster + near-dup dedup (J) | `near_dup` (reinforce) + graph | No new trades |
| 3 | **Stablecoin depeg** (USDC/USDT depeg response, exit discipline) | Decay (rare-event time-only M) + conflict | `M`-style time-only decay + `supersede` | No trades; seeded early |
| 3 | **Door-class adversarial perp** (live-state funding dumps, secret in RPC URL, non-English) | Write door (S2) gates — incl. the F5 DSN leak | `reject` (door) + F5 `knownGap` for a `wss://…@` RPC URI | No trades |
| 3 | **Slow-recurrence perp rules** (>7d apart, e.g. "never hold perps over weekend") | Recurrence / E-class slow detection | `E`-style slow recurrence (promote on 2nd) | No trades; 2 sim-days >7d apart |
| 2 | **Cross-venue supersession** (spot thesis superseded by perp evidence, different kind — F7) | Promote/supersede F7 unconstrained target | `supersede` flagged `knownGap:F7` | No trades |

**Totals:** 30 entries; ~8–10 new perp/liq executions + 4–6 closing trades (to make funding/liq flips *real*, not no-ops — directly addresses gap 2); ~4 new regime snapshots adding a perp-vol axis. The plan deliberately weights **reconcile (8), graph (7), and regime decay (7)** because those are the dimensions the 10-item subset cannot measure and the calibration bugs (C1/C2) neutralize.

## 6. Recommended S6/S7 slice plan for the /harness gate

### S6 — full-corpus path + calibration fixes + honest report (test-only)

1. **Full-corpus caller.** Add a `VEX_E2E_SUBSET=full` (or `=100`) branch in `e2e-memory-correctness.int.test.ts:63-67` that resolves `WORLD_CORPUS.memories.map(m => m.id)` and calls `resolveSubset(allIds)`. *Verify:* assert 100 items dispatched, 18 queries measured.
2. **K loss calibration.** Strip the sell leg from the four K-winners (`_world-corpus.ts:289-292`) so each closing trade matches an open buy lot and realizes a loss. *Verify:* `scoreReconcile` shows `flipApplied=true`, `outcomeVersion=1`, `decisionType=reconcile` for K01–K04.
3. **F03 escalation handling.** Reseed F02 (and F05) as `seedGemmaCandidate` so F03/F06 cluster and clear D7, OR anchor F03/F06 to trade executions. *Verify:* F03 reaches judge (`llmCalls≥1`), emits `supersede(F02)`; predecessor inactive.
4. **Honest report.** Add cause-codes to `RunCapture` and surface the F31 denominator + triage column in the scorer (gaps 3/4). *Verify:* report prints per-dimension cause and "X/100 unmeasured under F31".
5. **Do NOT touch the F5 redactor in S6.** The leak is a real bug but a **production** change; keep it as a tracked finding so the gate review decides it explicitly.

### S7 — 30-entry expansion + oracle (test-only, then one production fix)

1. **Corpus expansion.** Add the 30 entries + perp/liq trades + regime snapshots per Section 5. Update `assertCorpusCounts` to 130.
2. **Oracle expansion.** One `OraclePrediction` per new id + new retrieval queries; keep zero policy imports. Update `assertOracleCoverage`.
3. **Production redactor fix (separate PR, gated by approval).** Implement the three Tier-1 patterns from D1 in `src/lib/diagnostics/text-redaction.ts`. **Security-boundary change — explicit approval before merge.**

**Sequencing rationale:** S6 makes the existing eval truthful (full path, real flips, honest attribution) without any production risk; S7 broadens coverage and only then lands the one production fix the eval exposed, isolated and approval-gated per the repo's hard-stop rules on security-sensitive behavior.
