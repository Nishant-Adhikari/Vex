# Memory System — Live Eval Report (latest)

## Run 2026-06-12T20:19:44.544Z

### Provenance

- judge provider model: `deepseek/deepseek-v4-flash`
- embedding provider model (returned): `ai/embeddinggemma:300M-Q8_0`
- embedding model (configured): `ai/embeddinggemma:300M-Q8_0`
- embedding dim: `768`

### F31 headline — judge output-valid rate

**F31 manifests: judge output-valid rate = 100% (3/3 valid) with model=`deepseek/deepseek-v4-flash`.**

| metric | count |
| --- | ---: |
| judgeCallsAttempted (escalations reaching the judge) | 3 |
| judgeCallsSchemaValid | 3 |
| judgeCallsSchemaInvalid | 0 |
| invalid reasons | n/a |

Per-escalation:

| scenario | reached | valid | invalidReason |
| --- | --- | --- | --- |
| consolidation-judge/breakout | yes | yes | — |
| outcome-s5/strong-spot | yes | yes | — |
| reconcile-s7/flip | yes | yes | — |

### Per-dimension pass-rate

| suite | checks | passed | pass-rate |
| --- | ---: | ---: | ---: |
| consolidation-judge | 5 | 5 | 100% |
| graph | 2 | 2 | 100% |
| lifecycle | 3 | 3 | 100% |
| outcome-s5 | 4 | 4 | 100% |
| reconcile-s7 | 4 | 4 | 100% |
| retrieval-precision | 3 | 3 | 100% |
| write-gates | 9 | 9 | 100% |

#### consolidation-judge

- [PASS] F32 same-lesson cosine measured (real Gemma) — cosine=0.8287 clustersAt0.9=no
- [PASS] judge reached (candidate escalated; call attempted) — verdict valid (decision=promote)
- [PASS] decision audited in memory_decisions — type=promote
- [PASS] bumpJobInference landed llmCalls on job — job.llmCallCount=1
- [PASS] promote: source≤ceiling AND probationary/advisory/activation<1 — source=observed maturity=probationary act=0.5

#### graph

- [PASS] deterministic graph plan → entity/link/edge rows written — entities=2 links=2 edges=1
- [PASS] live extraction probe (fail-open; recorded, not asserted) — entities=2 edges=1

#### lifecycle

- [PASS] F1: matured NULL-TTL lesson counted but not in hot list — count=1 inHotList=false
- [PASS] F2: banner 'Skip long_memory_search' while candidates searchable — bannerSaysSkip=true candidatesSearchable=true
- [PASS] F3: slow-recurring generalization retained, not promoted — decision=retain llmCalls=0

#### outcome-s5

- [PASS] faithful spot seeder → matched realized proj_pnl_matches row — matchedRows=1
- [PASS] spot resolver → closed/strong/pnl_matches/positive — status=closed q=strong signal=positive
- [PASS] perps resolver → closed/medium/negative (never strong) — status=closed q=medium
- [PASS] strong-spot promote: outcome_version0 + valid_from=event_time + no-raw-pnl + ledger outcome — status=closed q=strong validFromΔms=0

#### reconcile-s7

- [PASS] ledger wake matched the promoted lesson (findPromotedWakeTargets) — matchedEntries=1
- [PASS] reconcile job enqueued by the ledger wake — reconcileJobs=1
- [PASS] outcome re-resolves negative from the loss ledger (flip vs stored positive) — oldSignal=positive newSignal=negative
- [PASS] reconcile judge outcome measured (F31) — jobStatus=completed lastError=—

#### retrieval-precision

- [PASS] precision@1 measured over golden queries — p@1=1.000 (15/15)
- [PASS] confirmed knowledge outranks equal-text inferred candidate — knowledgeRank=0 candidateRank=1
- [PASS] superseded + expired excluded; active surfaces — active=true superseded=false expired=false

#### write-gates

- [PASS] API-key-shaped secret → reject — rejected (hardRedactCount>0)
- [PASS] live-state numbers → reject — rejected (live_state)
- [PASS] Polish prose → reject (non-english) — rejected (non_english)
- [PASS] clean English lesson → accept (pending) — status=pending
- [PASS] exact dup of promoted entry → already_known — content-hash loop-prevention
- [PASS] F5 shape: solana-base58-88char-key — observed behavior — hardRedactHits=0 suggestAccepted=true status=pending
- [PASS] F5 shape: unlabelled-64-hex — observed behavior — hardRedactHits=0 suggestAccepted=true status=pending
- [PASS] F5 shape: postgres-uri-creds — observed behavior — hardRedactHits=0 suggestAccepted=true status=pending
- [PASS] F5 shape: comma-separated-mnemonic — observed behavior — hardRedactHits=0 suggestAccepted=true status=pending

### Judge (live DeepSeek via OpenRouter)

| scenario | llmCalls | costUsd | latencyMs | verdict |
| --- | ---: | ---: | ---: | --- |
| consolidation-judge/breakout | 1 | 0.000208 | 32900 | promote |
| outcome-s5/strong-spot | 1 | 0.000399 | 37038 | promote |
| reconcile-s7/flip | 1 | 0.000100 | 17000 | reconcile:completed |

- total llmCalls: 3; cost samples: 3/3; total cost (where reported): 0.000706; avg latency: 28979ms

### Retrieval precision@k (real Gemma corpus)

| k | queries | relevantHits | precision@k |
| ---: | ---: | ---: | ---: |
| 1 | 15 | 15 | 1.000 |

### Funnel findings (baseline characterization)

| code | manifested | summary |
| --- | --- | --- |
| F32 | YES | same-lesson cosine=0.8287 on real Gemma; clusters at RECURRENCE_CLUSTER_COSINE(0.9)=NO — escalation now driven by two own anchors, not clustering |
| F31 | no | reconcile judge produced a valid verdict (job=completed) — F31 did not block this reconcile |
| F31 | YES | graph extraction reachable in isolation (entities=2) but the end-to-end extract→PROMOTE graph build is UNMEASURABLE — F31 blocks every live promote |
| F5 | YES | gap: solana-base58-88char-key currently ACCEPTED (hardRedactHits=0, suggest accepted) |
| F5 | YES | gap: unlabelled-64-hex currently ACCEPTED (hardRedactHits=0, suggest accepted) |
| F5 | YES | gap: postgres-uri-creds currently ACCEPTED (hardRedactHits=0, suggest accepted) |
| F5 | YES | gap: comma-separated-mnemonic currently ACCEPTED (hardRedactHits=0, suggest accepted) |
| F1 | YES | manifests: matured observed/established/NULL-TTL/unpinned lesson is COUNTED (banner N=1) but ABSENT from the hot list |
| F2 | YES | manifests: cold-start banner says 'Skip long_memory_search' while dual-trace candidates are returned by the search handler |
| F3 | YES | manifests: two observations >7d apart → older candidate's retrieval_until elapsed → recurrence stays 1 → D7 retain (decision=retain, judge not reached) |
