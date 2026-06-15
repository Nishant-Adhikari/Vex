# Vex Memory Judge Benchmark — Design Spec (~100 live-judge items)

> Produced by the `judge-benchmark-design` workflow (6 Opus agents: escalation-recipe, kind-taxonomy, verdict-space, current-coverage, benchmark-metrics + synthesis). Code-anchored. Companion to `memory-eval-recon.md` + the 130-item correctness eval.

**Premise that differs from the existing eval:** the 130-item `_world-corpus.ts` deliberately routes many items *away* from the judge (door-rejects, seeded-direct, reconcile-only, D7-blocked). Coverage shows only **48/130 reach the judge**, with whole classes at 0% (strategy_lesson E, conflict-pair G), zero `supersede`, only 4 `retain`. This benchmark inverts that: **every one of ~100 items is engineered to survive D1–D11 and hit `callJudge`**, so the metric denominator is the judge itself. It is a *decision-quality* benchmark, not a *pipeline-routing* benchmark.

## 1. The escalation recipe (guarantee a memory reaches the judge)

A candidate reaches `consolidate.ts → deps.judge(...)` iff it survives all deterministic terminals in `runDeterministicStage` (`deterministic-stage.ts`), first-wins order.

| Gate | Terminal fires when… | Authoring rule to PASS (escalate) |
|------|----------------------|-----------------------------------|
| **D1** live-state rescan | redacted aggregate `liveFraction ≥ 0.30` | No live secrets/state in title+summary+content+entities+tags |
| **D2** stale evidence | an evidence anchor's session is soft-deleted | Every anchor references a live, non-deleted session/execution |
| **D4** exact dup | `content_hash` matches an active row | Unique content_hash vs all pre-seeded active knowledge |
| **D5** near-dup | `maxCosine ≥ 0.93` AND NOT `differsOnNumberOrDate` | cosine < 0.93, OR ≥0.85 carrying a NEW number/date (Graphiti guardrail flips dup→escalate) |
| **D6** conflict flag | *never terminal* (signal only) | SUPERSEDE probes: same-kind active predecessor at cosine ≥0.85 that differs on a number/date → `conflictFlag` + `conflictKnowledgeId` |
| **D8** mundane | `importance ≤ 2` AND ceiling ∈ {none,weak} | `importance ≥ 3` OR ceiling moderate/strong |
| **D9** low confidence | `confidence < 0.30` AND not user-affirmed AND ceiling none | `confidence ≥ 0.30` OR user-affirmed OR ceiling ≥ weak |
| **D7** recurrence gate | `isGeneralizationKind` AND `recurrenceCount < 2` | **Load-bearing.** Generalization kinds (strategy/risk/lesson/pattern/heuristic) MUST carry **2 distinct executionId anchors in their own evidence_refs** (`countRecurrence ≥ 2`, robust per `consolidation-judge.int.test.ts`, avoids F32 cluster fragility). Non-generalization kinds exempt |
| **D10** TTL | `retain_until < now` | NULL or future TTL (EXPIRE probes via dual-trace, not D10) |
| **D11** status guard | candidate `status != 'pending'` | Fresh pending candidate (resetDb) |

**Routing:** default **`seedGemmaCandidate`** (bypasses door, lands pending candidate → D1–D11 → judge). `suggest` only when door behavior is scored. `seedPromotedLessonDirect` ONLY to pre-plant a supersede predecessor, never a scored item.

**Net recipe:** `seedGemmaCandidate` + clean text + ≥1 live anchor + (generalization kinds) 2 own executionId anchors + unique content_hash + cosine managed + importance ≥3 + confidence ≥0.30 + future/NULL TTL ⇒ guaranteed escalate → live judge.

## 2. The 100-item matrix (kind × verdict × difficulty)

All items reach the judge. Theme: one Solana/perp agent across bull→range→bear. ~20 gray-zone calibration items, SOFT-scored.

| Cluster | Kind | promote | supersede | retain | reject | expire | Σ |
|---|---|---:|---:|---:|---:|---:|---:|
| P | trade_lesson | 8 (6/2) | 2 | 1 | 2 | – | 13 |
| R | risk_rule | 6 (4/2) | 2 | 1 | 2 | – | 11 |
| S | strategy_lesson | 9 (6/3) | 3 | 1 | 2 | – | 15 |
| U | user_preference | 6 (5/1) | 1 | 1 | 2 | – | 10 |
| K | protocol_fact | 8 (6/2) | 1 | 1 | 2 | – | 12 |
| F | pumpfun_entry_pattern | 5 (3/2) | 1 | 1 | 2 | – | 9 |
| O | observation | 3 (1/2) | – | 4 | 1 | – | 8 |
| M | market_note | 2 (1/1) | – | 2 | 1 | 3 | 8 |
| T | trade_outcome | 3 (2/1) | 1 | 1 | 1 | 1 | 7 |
| X | mixed/gray | 2 | 2 | 4 | 1 | – | 9 |
| **Σ** | | **52** | **15** | **17** | **16** | **4** | **102** |

**Verdict-class intent:** PROMOTE (52) genuine grounding, 14 gray bordering retain/reject. SUPERSEDE (15) v1→v2 conflicts; ~5 semantic (F7, `supersedeTargetSoft`/`knownGap:F7`), rest numeric/date. RETAIN (17) dual-trace + premature-but-escalated. REJECT (16) **junk that still escalates** — high-conf/low-ground (conf 0.97 n=1), near-dup-but-novel, hindsight (processNotOutcome<3), over-abstraction = the **false-promote-rate** trap set. EXPIRE (4) market_note staleness via dual-trace.

**Gray-zone band (~20, SOFT):** grounding-edge (conf 0.90 n=1 → reject), novelty-edge (cosine 0.90–0.92), regime-inflection (buy-the-dip authored day 61 bear), generalizability-edge, source-tier-edge, supersede-ambiguity, thesis-contradiction, slow-recurrence (2nd sighting >7d).

## 3. Independent oracle approach
Fork a sibling `_judge-oracle.ts` under the existing `_oracle.ts` discipline: author every `expectedVerdict`/`expectedTierCeiling`/`expectedSupersedes`/rubric-band from PRODUCT INTENT, **import NO policy module/constant**, re-type the bounded verdict/reason unions locally. Tier ceiling authored from the evidence story (none→hypothesis…strong→observed; user_confirmed exempt). **Rubric expectations as BANDS not exact ints** (live LLM jitter → SOFT). `knownGap:F7` on semantic supersedes (expectation = correct predecessor, never reds). F5 out of scope (leakers die at D1). F31 invalid = MEASURED, never red. **Corpus and oracle authored by DISJOINT subagents** (non-circularity); disagreement = real signal triaged human as memory_bug vs oracle_error.

## 4. Benchmark metrics (decision quality)
Scorer modeled on `_sim-scorer.ts` (HARD invariants `expect()`, SOFT via `recordOracleScore`). **Every metric over `verdictValid===true` (F31-aware).**
- **Verdict confusion matrix** (5×5 oracle×judge) + per-class precision/recall.
- **false_promote_rate** (PRIMARY safety) = promote where oracle≠promote / total promotes — needs the 16 reject + 17 retain trap set.
- **false_reject_rate**, **reject precision/recall**.
- **source_tier_clamp_precision** (stored source ≤ expectedTierCeiling, by tier).
- **supersede_target_accuracy** (SOFT where F7).
- **grounding_calibration** (mean judge grounding per oracle tier — sharp separation = good).
- **confidence_claim_override_rate** (high-conf items rejected/retained; target ≈100% on the N-class trap).
- **novelty_vs_dedup**, **processNotOutcome_fidelity**, **slow_recurrence_precision**, **verdict_distribution_diversity**, **judge_invalid_verdict_rate** (F31 health, target <5%).
- **JUDGE REASONING CAPTURE (added):** capture the full 5-axis rubric + sourceTier + rejectReason the judge ALREADY emits (the test currently discards them) per item → report. Oracle predicts rubric BANDS → measure WHICH axis the judge mis-scores. (Layer 2, gated prod: add a prose `reasoning` field to the judge verdict for prompt-debugging.)

## 5. Extend-vs-fresh → NEW separate suite
**ADD a new judge-benchmark corpus + oracle + test; do NOT extend the 130 correctness eval.** Different objective (judge calibration vs pipeline routing), different denominator (all-escalate vs 48/130), cost/runtime isolation (~100 live calls, separately gated). **Maximal reuse, no new harness:** reuse `_sim-runner.ts`/`_sim-clock.ts`/`_sim-scorer.ts`/`_eval-fixtures.ts`/`_report-card.ts`. New files only: `_judge-corpus.ts`, `_judge-oracle.ts`, `judge-benchmark.int.test.ts`.

## 6. Build plan (subagents)
- **Wave 0 (1):** scaffold `_judge-corpus.ts` + `_judge-oracle.ts` skeleton + `judge-benchmark.int.test.ts` shell; stable id scheme; tsc green on stubs.
- **Wave 1 — corpus (5 parallel, NO oracle access):** SA-1 P+R+S promotes; SA-2 U+K+F promotes; SA-3 supersede (15, predecessors); SA-4 reject(16)+expire(4) trap set; SA-5 retain(17)+gray-band(20).
- **Wave 2 — oracle (3 parallel, read only the agent-facing item text, NOT corpus authors' intent):** OA-1 P/R/S; OA-2 U/K/F/T; OA-3 O/M/X+gray.
- **Wave 3 — wiring (1):** HARD invariants + SOFT rows + confusion-matrix/false-promote report.
- **Verify:** tsc; coverage assert (1 oracle row/item; generalization items ≥2 anchors); **dry-run escalation check** (gate predicates only, NO judge — confirms each item escalates BEFORE spending judge calls); focused live ~100-call run; triage disagreements human.

## 7. Open questions for Codex
1. **Non-gameability of `seedGemmaCandidate` escalation** — bypassing the door isolates the judge but removes a real filter. Pure judge-isolation (more rigorous) vs a ~15% real-`suggest` slice (keeps door in loop)?
2. **Recurrence via 2 own-anchors vs live-Gemma clustering** — forcing recurrence robustly may make D7→judge too easy and mask the real slow-recurrence-never-clusters failure. Keep some items on real clustering?
3. **Live-LLM oracle stability** — single-run + rubric bands + SOFT, or N-run majority vote per item with verdict-stability variance (Nx cost)?
4. **SUPERSEDE/F7 measurability** — for semantic conflicts the `differsOnNumberOrDate` guardrail doesn't fire (no `conflictKnowledgeId` hint). Hold the judge to the correct target as a HARD red (expose F7), or keep SOFT/knownGap until F7 fixed?
5. **False-promote trap calibration** — is ~33% non-promote enough trap mass, and is the junk taxonomy (high-conf/low-ground, hindsight, near-dup-novel, over-abstraction) right, or weight higher-leverage junk (fabricated protocol facts, regime-mismatched lessons)?

---

# ADVERSARIAL REVIEW — GATING CHANGES (incorporated; OVERRIDE §1–7 where conflicting)

> Independent 3-lens Opus red-team (Codex substitute, Codex rate-limited to Jun 18). Verdict: **BUILD WITH CHANGES** — all closable in Wave 0; do NOT start corpus/oracle subagents until done. As-specified a high score would OVERSTATE judge quality on the exact safety axis the 130-run failed (junk 1/4, supersession 0/9).

## Decisions on the 5 open questions
1. **Door bypass:** keep 100% `seedGemmaCandidate` for the scored corpus + a *gate-only* real-`suggest` smoke (2–3 items, no judge call) + a MANDATORY "synthetic escalation distribution" external-validity banner on every headline.
2. **Recurrence:** force 2 own executionId anchors on ALL generalization items (slow-recurrence-never-clusters is a pre-judge D7 terminal, unscoreable here); add a slow-recurrence gray probe that STILL escalates (oracle = durability/staleness retain-or-reject); track the real clustering gap out-of-scope (recon C1).
3. **Repetition:** STRATIFIED — N=1 on clean/easy; **N=3 majority-vote + per-item `verdict_instability`** on the ~36 reject/retain traps + ~5 supersedes + ~20 gray (~215 calls). Score `false_promote_rate` on the MODAL verdict; report instability as its own metric.
4. **F7 semantic supersede — SPLIT into 3:** (A) HARD: judge must NOT promote a contradicting v2 as a fresh standalone peer while v1 stays active; (B) SOFT/`knownGap:F7`: exact `previousKnowledgeId` target selection; (C) HARD where supersede DID fire: predecessor ends inactive + non-retrievable. F7 becomes a NUMBER, never a permanent theatrical red.
5. **Trap mass (HIGHEST LEVERAGE):** 33% too thin vs a ~75%-lenient judge → raise reject toward **~40% / ≥30 items**, add **fabricated-protocol-fact** + **regime-mismatched-lesson** clusters, **≥3–6 items per junk subtype**, per-subtype `false_promote_rate`, **pre-registered HARD gate** (e.g. fail >1/30), + a `confidence_claim_override` HARD assertion (every conf-0.97/n=1 item must be reject-or-retain).

## Wave-0 gating changes (BEFORE any corpus/oracle authoring)
1. **Reasoning capture (L1) is the BLOCKER, not a one-liner.** The raw `JudgeVerdict` is collapsed by `planFromVerdict` to a `DecisionPlan` (consolidate.ts) and dropped before any capture seam. PREFER a TEST-ONLY judge-dep wrapper in `driveConsolidateCapturingJudge` that records the raw verdict at the injected-dep boundary (ZERO production change); only if genuinely impossible, plumb `verdict: JudgeVerdict|null` through `CandidateDecision`→`DriveResult`→`JudgeCapture` (behavior-neutral, flag to parent first). Extend `JudgeCapture` with `rubric` / `judgeSourceTier` / `judgeRejectReason`.
2. **Capture BOTH source tiers + the ceiling:** judge-raw `verdict.sourceTier` AND clamped `plan.sourceTier` AND `signals.evidenceStrengthCeiling`. Score clamp-applied (clamped ≤ ceiling) as HARD; judge-raw-tier-vs-oracle-band as SOFT. NEVER score the clamped tier as "judge calibration" (it's ~100% by construction → false-green hiding the mis-scoring).
3. **Dry-run escalation = REAL `runDeterministicStage` + REAL Gemma** (D5/D6/D7 are embedding-dependent). A scalar-only check gives false confidence. Make it a **HARD build-time coverage gate**: a non-escalating item FAILS THE BUILD (not the live run), with `NEAR_DUP_COSINE`/`CONFLICT_COSINE`/`RECURRENCE_PROMOTE_MIN` named in the failure.
4. **Structural non-circularity:** OPAQUE sequential ids (`M001..M102` — NO cluster/verdict/kind semantics in ids or filenames); oracle subagents receive only `{id, kind, agent-facing text, evidence-shape}`; coverage assert: oracle imports nothing from the corpus but the id list + a text accessor.
5. **Firewall corpus authors** from `judge-prompt.ts`/`judge-schema.ts` (no teaching-to-the-rubric); require ≥2 axis-conflicting items per cluster + ~10 off-distribution items from real/messy transcripts; report few-shot-echo vs non-echo agreement separately.
6. **Run protocol fixed up front:** stratified N=3 on traps/supersedes/gray; modal-verdict scoring; `verdict_instability` + F31-unmeasured count as first-class report lines; pin/record model+temperature+seed in the report header; any A/B prompt delta must exceed the measured noise band.
7. **Pre-register metric severities** (cannot be softened post-results): per-subtype `false_promote_rate` HARD gate (Q5); the F7 three-way split (Q4); the external-validity banner (Q1); route vocabulary-over-determined items (TTL-expire, exact-dup) to a separate SANITY bucket OUT of the headline.

## L2 (prod `reasoning` field) — gated, OFF in the measurement run
Strict schema is fine (the `.nullish()`+`toJSONSchema io:input` pattern tolerates an optional field; F31 invalids come from the MODEL, not OpenRouter). BUT a long free-text field worsens F31 (deepseek drifts to markdown/unescaped quotes) + cost. If trialled: `reasoning: z.string().max(N).nullish()`, placed FIRST (reasoning-before-verdict = real CoT), **probe F31 valid-rate WITH vs WITHOUT on ~10 items first**, NEVER log the prose (untrusted model text; report stays enums/counts). Keep L2 behind a `JUDGE_REASONING` env, default OFF, and OUT of the scored run so the benchmark measures the SAME prompt/schema as production.
