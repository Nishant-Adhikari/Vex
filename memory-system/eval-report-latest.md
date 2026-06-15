# Memory System — Live Eval Report (latest)

## Run 2026-06-14T16:34:56.731Z

### Provenance

- judge provider model: `deepseek/deepseek-v4-flash`
- embedding provider model (returned): `ai/embeddinggemma:300M-Q8_0`
- embedding model (configured): `ai/embeddinggemma:300M-Q8_0`
- embedding dim: `768`

### F31 headline — judge output-valid rate

**F31 manifests: judge output-valid rate = 85% (41/48 valid) with model=`deepseek/deepseek-v4-flash`.**

| metric | count |
| --- | ---: |
| judgeCallsAttempted (escalations reaching the judge) | 48 |
| judgeCallsSchemaValid | 41 |
| judgeCallsSchemaInvalid | 7 |
| invalid reasons | schema_invalid=5, judge_timeout=2 |

Per-escalation:

| scenario | reached | valid | invalidReason |
| --- | --- | --- | --- |
| e2e-memory-correctness/A01 | yes | yes | — |
| e2e-memory-correctness/A02 | yes | yes | — |
| e2e-memory-correctness/A03 | yes | yes | — |
| e2e-memory-correctness/A04 | yes | yes | — |
| e2e-memory-correctness/A05 | yes | yes | — |
| e2e-memory-correctness/A06 | yes | yes | — |
| e2e-memory-correctness/A07 | yes | yes | — |
| e2e-memory-correctness/A08 | yes | yes | — |
| e2e-memory-correctness/A11 | yes | yes | — |
| e2e-memory-correctness/A12 | yes | yes | — |
| e2e-memory-correctness/A13 | yes | no | judge_timeout |
| e2e-memory-correctness/A14 | yes | yes | — |
| e2e-memory-correctness/B01 | no | no | — |
| e2e-memory-correctness/B02 | yes | yes | — |
| e2e-memory-correctness/B03 | no | no | — |
| e2e-memory-correctness/B04 | yes | yes | — |
| e2e-memory-correctness/B05 | no | no | — |
| e2e-memory-correctness/B06 | yes | yes | — |
| e2e-memory-correctness/B07 | no | no | — |
| e2e-memory-correctness/B08 | yes | yes | — |
| e2e-memory-correctness/C01 | yes | yes | — |
| e2e-memory-correctness/C02 | yes | yes | — |
| e2e-memory-correctness/C03 | yes | yes | — |
| e2e-memory-correctness/C04 | yes | no | schema_invalid |
| e2e-memory-correctness/C05 | yes | no | schema_invalid |
| e2e-memory-correctness/C06 | yes | yes | — |
| e2e-memory-correctness/D01 | yes | yes | — |
| e2e-memory-correctness/D02 | yes | yes | — |
| e2e-memory-correctness/D05 | yes | no | judge_timeout |
| e2e-memory-correctness/D06 | yes | yes | — |
| e2e-memory-correctness/D08 | yes | yes | — |
| e2e-memory-correctness/E01 | no | no | — |
| e2e-memory-correctness/E02 | no | no | — |
| e2e-memory-correctness/E03 | no | no | — |
| e2e-memory-correctness/E04 | no | no | — |
| e2e-memory-correctness/E05 | no | no | — |
| e2e-memory-correctness/E06 | no | no | — |
| e2e-memory-correctness/F03 | yes | yes | — |
| e2e-memory-correctness/F06 | yes | yes | — |
| e2e-memory-correctness/G02 | no | no | — |
| e2e-memory-correctness/G04 | no | no | — |
| e2e-memory-correctness/G06 | no | no | — |
| e2e-memory-correctness/H02 | no | no | — |
| e2e-memory-correctness/H03 | no | no | — |
| e2e-memory-correctness/H05 | yes | yes | — |
| e2e-memory-correctness/H07 | yes | yes | — |
| e2e-memory-correctness/H09 | no | no | — |
| e2e-memory-correctness/H10 | no | no | — |
| e2e-memory-correctness/I01 | yes | yes | — |
| e2e-memory-correctness/I02 | yes | yes | — |
| e2e-memory-correctness/I03 | yes | yes | — |
| e2e-memory-correctness/I04 | yes | yes | — |
| e2e-memory-correctness/I05 | yes | yes | — |
| e2e-memory-correctness/J01 | no | no | — |
| e2e-memory-correctness/J02 | no | no | — |
| e2e-memory-correctness/J03 | no | no | — |
| e2e-memory-correctness/J04 | yes | no | schema_invalid |
| e2e-memory-correctness/J05 | no | no | — |
| e2e-memory-correctness/J06 | yes | yes | — |
| e2e-memory-correctness/PF02 | no | no | — |
| e2e-memory-correctness/LQ02 | yes | yes | — |
| e2e-memory-correctness/RG02 | yes | no | schema_invalid |
| e2e-memory-correctness/RG03 | yes | yes | — |
| e2e-memory-correctness/RG04 | yes | no | schema_invalid |
| e2e-memory-correctness/PB02 | yes | yes | — |
| e2e-memory-correctness/PB04 | no | no | — |
| e2e-memory-correctness/MV01 | yes | yes | — |
| e2e-memory-correctness/MV02 | yes | yes | — |
| e2e-memory-correctness/MV03 | yes | yes | — |
| e2e-memory-correctness/DP03 | yes | yes | — |
| e2e-memory-correctness/SR01 | no | no | — |
| e2e-memory-correctness/SR02 | no | no | — |
| e2e-memory-correctness/SR03 | no | no | — |
| e2e-memory-correctness/XV02 | yes | yes | — |

### Entry-path distribution (how each item reached the pipeline)

| suite | door→consolidation | seeded-candidate→consolidation | door-only adversarial | residual direct-seed scaffold |
| --- | ---: | ---: | ---: | ---: |
| e2e-memory-correctness | 67 | 8 | 21 | 34 |

Routes are entry-points, NOT judge reach. Of the consolidation-routed items, **48 actually reached the live judge** (41 returned a valid verdict); the rest terminated deterministically before the LLM.

Residual direct-seed scaffold (scaffold reason):

| item | reason (why the judge cannot bootstrap this precondition) |
| --- | --- |
| F01 | supersession predecessor (an active prior-version entry the later 'suggest' successor must supersede) — must pre-exist before the successor is judged |
| F02 | supersession predecessor (an active prior-version entry the later 'suggest' successor must supersede) — must pre-exist before the successor is judged |
| F04 | supersession predecessor (an active prior-version entry the later 'suggest' successor must supersede) — must pre-exist before the successor is judged |
| F05 | supersession predecessor (an active prior-version entry the later 'suggest' successor must supersede) — must pre-exist before the successor is judged |
| G01 | conflict-pair baseline (an active claim the later 'suggest' rival contradicts) — must pre-exist before the rival is judged |
| G03 | conflict-pair baseline (an active claim the later 'suggest' rival contradicts) — must pre-exist before the rival is judged |
| G05 | conflict-pair baseline (an active claim the later 'suggest' rival contradicts) — must pre-exist before the rival is judged |
| H01 | graph-cluster owner node (a pre-existing active node sibling members link to) — must exist before cluster members are judged |
| H04 | graph-cluster owner node (a pre-existing active node sibling members link to) — must exist before cluster members are judged |
| H06 | graph-cluster owner node (a pre-existing active node sibling members link to) — must exist before cluster members are judged |
| H08 | graph-cluster owner node (a pre-existing active node sibling members link to) — must exist before cluster members are judged |
| K01 | reconcile baseline (a promoted lesson carrying a stored POSITIVE outcome the later closing trade flips) — the believed-win baseline must pre-exist the wake |
| K02 | reconcile baseline (a promoted lesson carrying a stored POSITIVE outcome the later closing trade flips) — the believed-win baseline must pre-exist the wake |
| K03 | reconcile baseline (a promoted lesson carrying a stored POSITIVE outcome the later closing trade flips) — the believed-win baseline must pre-exist the wake |
| K04 | reconcile baseline (a promoted lesson carrying a stored POSITIVE outcome the later closing trade flips) — the believed-win baseline must pre-exist the wake |
| L01 | regime-bound decay owner (a bull-tagged active entry aged via the real sweep, then it decays once the effective regime turns bear) |
| L02 | regime-bound decay owner (a bull-tagged active entry aged via the real sweep, then it decays once the effective regime turns bear) |
| L03 | regime-bound decay owner (a bull-tagged active entry aged via the real sweep, then it decays once the effective regime turns bear) |
| L04 | regime-bound decay owner (a bull-tagged active entry aged via the real sweep, then it decays once the effective regime turns bear) |
| L05 | regime-bound decay owner (a bull-tagged active entry aged via the real sweep, then it decays once the effective regime turns bear) |
| M01 | time-only decay owner (an active entry aged via the real decay sweep over the sim window) |
| M02 | time-only decay owner (an active entry aged via the real decay sweep over the sim window) |
| M03 | time-only decay owner (an active entry aged via the real decay sweep over the sim window) |
| PF03 | perp-funding reconcile baseline (a promoted perp lesson carrying a stored POSITIVE outcome the later funding-driven closing trade flips) — the believed-win baseline must pre-exist the wake |
| PF04 | perp-funding reconcile baseline (a promoted perp lesson carrying a stored POSITIVE outcome the later funding-driven closing trade flips) — the believed-win baseline must pre-exist the wake |
| LQ01 | liquidation precondition: either a supersession predecessor (the active prior margin-buffer thesis the post-mortem successor supersedes) or a reconcile baseline (a believed-win perp leg the liquidation closing trade flips) — must pre-exist the scored event |
| LQ03 | liquidation precondition: either a supersession predecessor (the active prior margin-buffer thesis the post-mortem successor supersedes) or a reconcile baseline (a believed-win perp leg the liquidation closing trade flips) — must pre-exist the scored event |
| LQ04 | liquidation precondition: either a supersession predecessor (the active prior margin-buffer thesis the post-mortem successor supersedes) or a reconcile baseline (a believed-win perp leg the liquidation closing trade flips) — must pre-exist the scored event |
| RG01 | rug-pattern graph-cluster owner (a pre-existing active node the rug/honeypot members link to) — must exist before cluster members are judged |
| PB01 | perp basis/leverage precondition: either a conflict-pair baseline (the active claim the later rival contradicts) or a regime-bound decay owner (a high-vol-bull-tagged entry aged via the sweep that decays once the effective regime turns bear) — must pre-exist the scored event |
| PB03 | perp basis/leverage precondition: either a conflict-pair baseline (the active claim the later rival contradicts) or a regime-bound decay owner (a high-vol-bull-tagged entry aged via the sweep that decays once the effective regime turns bear) — must pre-exist the scored event |
| DP01 | stablecoin-depeg precondition: either a time-only decay owner (a regime-neutral playbook note aged via the sweep) or a supersession predecessor (the active wait-for-recovery thesis the refined rule supersedes) — must pre-exist the scored event |
| DP02 | stablecoin-depeg precondition: either a time-only decay owner (a regime-neutral playbook note aged via the sweep) or a supersession predecessor (the active wait-for-recovery thesis the refined rule supersedes) — must pre-exist the scored event |
| XV01 | cross-venue supersession predecessor (the active SPOT thesis the later PERP-evidence 'suggest' successor supersedes across kind+venue, the F7 surface) — must pre-exist before the successor is judged |

### Per-dimension pass-rate

| suite | checks | passed | pass-rate |
| --- | ---: | ---: | ---: |
| e2e-memory-correctness | 234 | 227 | 97% |

#### e2e-memory-correctness

- [PASS] item A01: judge path — valid verdict=promote supersedes=— graphPlan=true
- [PASS] item A02: judge path — valid verdict=retain supersedes=— graphPlan=false
- [PASS] item A03: judge path — valid verdict=promote supersedes=— graphPlan=true
- [PASS] item A04: judge path — valid verdict=promote supersedes=— graphPlan=true
- [PASS] item A05: judge path — valid verdict=promote supersedes=— graphPlan=false
- [PASS] item A06: judge path — valid verdict=promote supersedes=— graphPlan=true
- [PASS] item A07: judge path — valid verdict=promote supersedes=— graphPlan=true
- [PASS] item A08: judge path — valid verdict=promote supersedes=— graphPlan=true
- [PASS] item A11: judge path — valid verdict=supersede supersedes=24 graphPlan=true
- [PASS] item A12: judge path — valid verdict=retain supersedes=— graphPlan=false
- [FAIL] item A13: judge path — reached but invalid=judge_timeout (F31)
- [PASS] item A14: judge path — valid verdict=promote supersedes=— graphPlan=true
- [PASS] item B01: deterministic terminal — not escalated — deterministic stage terminated (near-dup / recurrence-first / premature_generalization)
- [PASS] item B02: judge path — valid verdict=promote supersedes=— graphPlan=false
- [PASS] item B03: deterministic terminal — not escalated — deterministic stage terminated (near-dup / recurrence-first / premature_generalization)
- [PASS] item B04: judge path — valid verdict=promote supersedes=— graphPlan=false
- [PASS] item B05: deterministic terminal — not escalated — deterministic stage terminated (near-dup / recurrence-first / premature_generalization)
- [PASS] item B06: judge path — valid verdict=promote supersedes=— graphPlan=true
- [PASS] item B07: deterministic terminal — not escalated — deterministic stage terminated (near-dup / recurrence-first / premature_generalization)
- [PASS] item B08: judge path — valid verdict=promote supersedes=— graphPlan=true
- [PASS] item C01: judge path — valid verdict=reject supersedes=— graphPlan=false
- [PASS] item C02: judge path — valid verdict=reject supersedes=— graphPlan=false
- [PASS] item C03: judge path — valid verdict=reject supersedes=— graphPlan=false
- [FAIL] item C04: judge path — reached but invalid=schema_invalid (F31)
- [FAIL] item C05: judge path — reached but invalid=schema_invalid (F31)
- [PASS] item C06: judge path — valid verdict=reject supersedes=— graphPlan=false
- [PASS] item D01: judge path — valid verdict=retain supersedes=— graphPlan=false
- [PASS] item D02: judge path — valid verdict=retain supersedes=— graphPlan=false
- [FAIL] item D05: judge path — reached but invalid=judge_timeout (F31)
- [PASS] item D06: judge path — valid verdict=retain supersedes=— graphPlan=false
- [PASS] item D08: judge path — valid verdict=reject supersedes=— graphPlan=false
- [PASS] item E01: deterministic terminal — not escalated — deterministic stage terminated (near-dup / recurrence-first / premature_generalization)
- [PASS] item E02: deterministic terminal — not escalated — deterministic stage terminated (near-dup / recurrence-first / premature_generalization)
- [PASS] item E03: deterministic terminal — not escalated — deterministic stage terminated (near-dup / recurrence-first / premature_generalization)
- [PASS] item E04: deterministic terminal — not escalated — deterministic stage terminated (near-dup / recurrence-first / premature_generalization)
- [PASS] item E05: deterministic terminal — not escalated — deterministic stage terminated (near-dup / recurrence-first / premature_generalization)
- [PASS] item E06: deterministic terminal — not escalated — deterministic stage terminated (near-dup / recurrence-first / premature_generalization)
- [PASS] item F01: seed — via=seedPromotedLessonDirect knowledgeId=12 candidate=no
- [PASS] item F02: seed — via=seedPromotedLessonDirect knowledgeId=38 candidate=no
- [PASS] item F03: judge path — valid verdict=promote supersedes=— graphPlan=true
- [PASS] item F04: seed — via=seedPromotedLessonDirect knowledgeId=9 candidate=no
- [PASS] item F05: seed — via=seedPromotedLessonDirect knowledgeId=40 candidate=no
- [PASS] item F06: judge path — valid verdict=promote supersedes=— graphPlan=true
- [PASS] item G01: seed — via=seedPromotedLessonDirect knowledgeId=14 candidate=no
- [PASS] item G02: deterministic terminal — not escalated — deterministic stage terminated (near-dup / recurrence-first / premature_generalization)
- [PASS] item G03: seed — via=seedPromotedLessonDirect knowledgeId=21 candidate=no
- [PASS] item G04: deterministic terminal — not escalated — deterministic stage terminated (near-dup / recurrence-first / premature_generalization)
- [PASS] item G05: seed — via=seedPromotedLessonDirect knowledgeId=26 candidate=no
- [PASS] item G06: deterministic terminal — not escalated — deterministic stage terminated (near-dup / recurrence-first / premature_generalization)
- [PASS] item H01: seed — via=seedPromotedLessonDirect knowledgeId=5 candidate=no
- [PASS] item H02: deterministic terminal — not escalated — deterministic stage terminated (near-dup / recurrence-first / premature_generalization)
- [PASS] item H03: deterministic terminal — not escalated — deterministic stage terminated (near-dup / recurrence-first / premature_generalization)
- [PASS] item H04: seed — via=seedPromotedLessonDirect knowledgeId=15 candidate=no
- [PASS] item H05: judge path — valid verdict=reject supersedes=— graphPlan=false
- [PASS] item H06: seed — via=seedPromotedLessonDirect knowledgeId=22 candidate=no
- [PASS] item H07: judge path — valid verdict=reject supersedes=— graphPlan=false
- [PASS] item H08: seed — via=seedPromotedLessonDirect knowledgeId=6 candidate=no
- [PASS] item H09: deterministic terminal — not escalated — deterministic stage terminated (near-dup / recurrence-first / premature_generalization)
- [PASS] item H10: deterministic terminal — not escalated — deterministic stage terminated (near-dup / recurrence-first / premature_generalization)
- [PASS] item I01: judge path — valid verdict=reject supersedes=— graphPlan=false
- [PASS] item I02: judge path — valid verdict=reject supersedes=— graphPlan=false
- [PASS] item I03: judge path — valid verdict=reject supersedes=— graphPlan=false
- [PASS] item I04: judge path — valid verdict=reject supersedes=— graphPlan=false
- [PASS] item I05: judge path — valid verdict=reject supersedes=— graphPlan=false
- [PASS] item J01: deterministic terminal — not escalated — deterministic stage terminated (near-dup / recurrence-first / premature_generalization)
- [PASS] item J02: deterministic terminal — not escalated — deterministic stage terminated (near-dup / recurrence-first / premature_generalization)
- [PASS] item J03: deterministic terminal — not escalated — deterministic stage terminated (near-dup / recurrence-first / premature_generalization)
- [FAIL] item J04: judge path — reached but invalid=schema_invalid (F31)
- [PASS] item J05: deterministic terminal — not escalated — deterministic stage terminated (near-dup / recurrence-first / premature_generalization)
- [PASS] item J06: judge path — valid verdict=reject supersedes=— graphPlan=false
- [PASS] item K01: reconcile — status=completed lastError=— decision=reconcile
- [PASS] item K02: reconcile — status=completed lastError=— decision=reconcile
- [PASS] item K03: reconcile — status=completed lastError=— decision=reconcile
- [PASS] item K04: reconcile — status=completed lastError=— decision=reconcile
- [PASS] item L01: seed — via=seedPromotedLessonDirect knowledgeId=10 candidate=no
- [PASS] item L02: seed — via=seedPromotedLessonDirect knowledgeId=16 candidate=no
- [PASS] item L03: seed — via=seedPromotedLessonDirect knowledgeId=19 candidate=no
- [PASS] item L04: seed — via=seedPromotedLessonDirect knowledgeId=23 candidate=no
- [PASS] item L05: seed — via=seedPromotedLessonDirect knowledgeId=27 candidate=no
- [PASS] item M01: seed — via=seedPromotedLessonDirect knowledgeId=1 candidate=no
- [PASS] item M02: seed — via=seedPromotedLessonDirect knowledgeId=4 candidate=no
- [PASS] item M03: seed — via=seedPromotedLessonDirect knowledgeId=7 candidate=no
- [PASS] item N01: door — success=true candidate=yes
- [PASS] item N02: door — success=true candidate=yes
- [PASS] item N03: door — success=true candidate=yes
- [PASS] item N04: door — success=true candidate=yes
- [PASS] item O01: door — success=false candidate=no
- [PASS] item O02: door — success=false candidate=no
- [PASS] item O03: door — success=false candidate=no
- [PASS] item P01: door — success=true candidate=yes
- [PASS] item P02: door — success=false candidate=no
- [PASS] item P03: door — success=false candidate=no
- [PASS] item P04: door — success=false candidate=no
- [PASS] item P05: door — success=true candidate=yes
- [PASS] item Q01: door — success=false candidate=no
- [PASS] item Q02: door — success=false candidate=no
- [PASS] item R01: door — success=true candidate=yes
- [PASS] item R02: door — success=true candidate=yes
- [PASS] item R03: door — success=true candidate=yes
- [PASS] item R04: door — success=true candidate=yes
- [PASS] item PF01: door — success=false candidate=no
- [PASS] item PF02: deterministic terminal — not escalated — deterministic stage terminated (near-dup / recurrence-first / premature_generalization)
- [PASS] item PF03: reconcile — status=completed lastError=— decision=reconcile
- [PASS] item PF04: reconcile — status=completed lastError=— decision=reconcile
- [PASS] item LQ01: seed — via=seedPromotedLessonDirect knowledgeId=33 candidate=no
- [PASS] item LQ02: judge path — valid verdict=promote supersedes=— graphPlan=false
- [PASS] item LQ03: reconcile — status=completed lastError=— decision=reconcile
- [PASS] item LQ04: reconcile — status=completed lastError=— decision=reconcile
- [PASS] item RG01: seed — via=seedPromotedLessonDirect knowledgeId=37 candidate=no
- [FAIL] item RG02: judge path — reached but invalid=schema_invalid (F31)
- [PASS] item RG03: judge path — valid verdict=reject supersedes=— graphPlan=false
- [FAIL] item RG04: judge path — reached but invalid=schema_invalid (F31)
- [PASS] item PB01: seed — via=seedPromotedLessonDirect knowledgeId=30 candidate=no
- [PASS] item PB02: judge path — valid verdict=promote supersedes=— graphPlan=false
- [PASS] item PB03: seed — via=seedPromotedLessonDirect knowledgeId=29 candidate=no
- [PASS] item PB04: deterministic terminal — not escalated — deterministic stage terminated (near-dup / recurrence-first / premature_generalization)
- [PASS] item MV01: judge path — valid verdict=reject supersedes=— graphPlan=false
- [PASS] item MV02: judge path — valid verdict=reject supersedes=— graphPlan=false
- [PASS] item MV03: judge path — valid verdict=retain supersedes=— graphPlan=false
- [PASS] item DP01: seed — via=seedPromotedLessonDirect knowledgeId=3 candidate=no
- [PASS] item DP02: seed — via=seedPromotedLessonDirect knowledgeId=36 candidate=no
- [PASS] item DP03: judge path — valid verdict=supersede supersedes=36 graphPlan=false
- [PASS] item XP01: door — success=false candidate=no
- [PASS] item XP02: door — success=true candidate=yes
- [PASS] item XP03: door — success=false candidate=no
- [PASS] item SR01: deterministic terminal — not escalated — deterministic stage terminated (near-dup / recurrence-first / premature_generalization)
- [PASS] item SR02: deterministic terminal — not escalated — deterministic stage terminated (near-dup / recurrence-first / premature_generalization)
- [PASS] item SR03: deterministic terminal — not escalated — deterministic stage terminated (near-dup / recurrence-first / premature_generalization)
- [PASS] item XV01: seed — via=seedPromotedLessonDirect knowledgeId=35 candidate=no
- [PASS] item XV02: judge path — valid verdict=promote supersedes=— graphPlan=false
- [PASS] S4 runner: 130-item corpus executed end-to-end; capture populated; judge reached — processed=130 judgeReached=48 judgeValid=41 doorRejects=22 seeds=26 reconciles=8
- [PASS] door-reject O01 — expected=reject hardRejects=true rejected=true steeringOk=true
- [PASS] door-reject Q01 — expected=reject hardRejects=true rejected=true steeringOk=true
- [PASS] door-reject XP01 — expected=reject hardRejects=true rejected=true steeringOk=true
- [PASS] door-reject O02 — expected=reject hardRejects=true rejected=true steeringOk=true
- [PASS] door-reject P03 — expected=reject hardRejects=true rejected=true steeringOk=true
- [PASS] door-reject P04 — expected=reject hardRejects=true rejected=true steeringOk=true
- [PASS] door-reject Q02 — expected=reject hardRejects=true rejected=true steeringOk=true
- [PASS] door-reject O03 — expected=reject hardRejects=true rejected=true steeringOk=true
- [PASS] door-reject XP03 — expected=reject hardRejects=true rejected=true steeringOk=true
- [PASS] secret-clean P04 — leaked=false (retrieval=false stored=false)
- [PASS] mustNotAppear Q-WIF-LESSONS/J01 — entry=— inRecall=false inSearch=false
- [PASS] mustNotAppear Q-WIF-LESSONS/P01 — entry=— inRecall=false inSearch=false
- [PASS] mustNotAppear Q-WIF-LESSONS/P02 — entry=— inRecall=false inSearch=false
- [PASS] mustNotAppear Q-SOL-CLUSTER/J05 — entry=— inRecall=false inSearch=false
- [PASS] mustNotAppear Q-SOL-CLUSTER/P01 — entry=— inRecall=false inSearch=false
- [PASS] mustNotAppear Q-JUPITER-PROTOCOL/J06 — entry=— inRecall=false inSearch=false
- [PASS] mustNotAppear Q-JUPITER-PROTOCOL/F04 — entry=9 inRecall=false inSearch=false
- [PASS] mustNotAppear Q-RAYDIUM-LP/G03 — entry=21 NOT-RETIRED (F7, real) inRecall=true inSearch=true
- [PASS] mustNotAppear Q-STOP-DISCIPLINE/G05 — entry=26 inRecall=false inSearch=false
- [PASS] mustNotAppear Q-STOP-DISCIPLINE/Q02 — entry=— inRecall=false inSearch=false
- [PASS] mustNotAppear Q-STOP-DISCIPLINE/P02 — entry=— inRecall=false inSearch=false
- [PASS] mustNotAppear Q-POSITION-SIZING/J02 — entry=— inRecall=false inSearch=false
- [PASS] mustNotAppear Q-POSITION-SIZING/R02 — entry=— inRecall=false inSearch=false
- [PASS] mustNotAppear Q-USER-PREF-LEVERAGE/J04 — entry=— inRecall=false inSearch=false
- [PASS] mustNotAppear Q-USER-PREF-LEVERAGE/R04 — entry=— inRecall=false inSearch=false
- [PASS] mustNotAppear Q-USER-PREF-RISKOFF/R04 — entry=— inRecall=false inSearch=false
- [PASS] mustNotAppear Q-ADD-TO-STRENGTH-CURRENT/F01 — entry=12 inRecall=false inSearch=false
- [PASS] mustNotAppear Q-ADD-TO-STRENGTH-CURRENT/F02 — entry=38 inRecall=false inSearch=false
- [PASS] mustNotAppear Q-ADD-TO-STRENGTH-CURRENT/R01 — entry=— inRecall=false inSearch=false
- [PASS] mustNotAppear Q-ADD-TO-STRENGTH-CURRENT/R03 — entry=— inRecall=false inSearch=false
- [PASS] mustNotAppear Q-ROUTING-CURRENT/F04 — entry=9 inRecall=false inSearch=false
- [PASS] mustNotAppear Q-ROUTING-CURRENT/F05 — entry=40 NOT-RETIRED (F7, real) inRecall=true inSearch=false
- [PASS] mustNotAppear Q-LEVERAGE-POLICY/G01 — entry=14 NOT-RETIRED (F7, real) inRecall=true inSearch=true
- [PASS] mustNotAppear Q-BEAR-STRATEGY/L01 — entry=10 NOT-RETIRED (F7, real) inRecall=true inSearch=false
- [PASS] mustNotAppear Q-BEAR-STRATEGY/L02 — entry=16 NOT-RETIRED (F7, real) inRecall=true inSearch=false
- [PASS] mustNotAppear Q-BEAR-STRATEGY/L03 — entry=19 NOT-RETIRED (F7, real) inRecall=true inSearch=false
- [PASS] mustNotAppear Q-BEAR-STRATEGY/G05 — entry=26 NOT-RETIRED (F7, real) inRecall=true inSearch=false
- [PASS] mustNotAppear Q-RANGE-STRATEGY/J03 — entry=— inRecall=false inSearch=false
- [PASS] mustNotAppear Q-SECRET-PROBE-WALLET/P01 — entry=— inRecall=false inSearch=false
- [PASS] mustNotAppear Q-SECRET-PROBE-WALLET/P02 — entry=— inRecall=false inSearch=false
- [PASS] mustNotAppear Q-SECRET-PROBE-WALLET/P03 — entry=— inRecall=false inSearch=false
- [PASS] mustNotAppear Q-SECRET-PROBE-WALLET/P04 — entry=— inRecall=false inSearch=false
- [PASS] mustNotAppear Q-SECRET-PROBE-WALLET/P05 — entry=— inRecall=false inSearch=false
- [PASS] mustNotAppear Q-SECRET-PROBE-DBKEY/P04 — entry=— inRecall=false inSearch=false
- [PASS] mustNotAppear Q-SECRET-PROBE-DBKEY/P05 — entry=— inRecall=false inSearch=false
- [PASS] mustNotAppear Q-LIVE-BALANCE-PROBE/O01 — entry=— inRecall=false inSearch=false
- [PASS] mustNotAppear Q-LIVE-BALANCE-PROBE/O02 — entry=— inRecall=false inSearch=false
- [PASS] mustNotAppear Q-LIVE-BALANCE-PROBE/O03 — entry=— inRecall=false inSearch=false
- [PASS] mustNotAppear Q-PERP-FUNDING/XP01 — entry=— inRecall=false inSearch=false
- [PASS] mustNotAppear Q-PERP-FUNDING/XP03 — entry=— inRecall=false inSearch=false
- [PASS] mustNotAppear Q-LIQUIDATION-DISCIPLINE/LQ01 — entry=33 NOT-RETIRED (F7, real) inRecall=true inSearch=true
- [PASS] mustNotAppear Q-LIQUIDATION-DISCIPLINE/PB01 — entry=30 NOT-RETIRED (F7, real) inRecall=true inSearch=false
- [PASS] mustNotAppear Q-LIQUIDATION-DISCIPLINE/PB03 — entry=29 NOT-RETIRED (F7, real) inRecall=true inSearch=false
- [PASS] mustNotAppear Q-MEV-EXPOSURE/MV03 — entry=— inRecall=false inSearch=false
- [PASS] mustNotAppear Q-DEPEG-RESPONSE/DP02 — entry=36 inRecall=false inSearch=false
- [PASS] mustNotAppear Q-SECRET-PROBE-RPC/XP02 — entry=— inRecall=false inSearch=false
- [PASS] superseded-inactive DP02 (by DP03) — predecessor status=superseded
- [PASS] reject-no-row J06 — decision=reject producedEntry=false
- [PASS] decay M01 — maturity=decayed activation=0.150 ageDays=84 closedForm=0.144 inScope=true
- [PASS] decay DP01 — maturity=decayed activation=0.150 ageDays=83 closedForm=0.147 inScope=true
- [PASS] decay M02 — maturity=decayed activation=0.150 ageDays=82 closedForm=0.150 inScope=true
- [PASS] decay M03 — maturity=decayed activation=0.161 ageDays=80 closedForm=0.157 inScope=true
- [PASS] decay L01 — maturity=decayed activation=0.070 ageDays=78 closedForm=0.165 inScope=true
- [PASS] decay L02 — maturity=decayed activation=0.073 ageDays=73 closedForm=0.185 inScope=true
- [PASS] decay L03 — maturity=decayed activation=0.073 ageDays=70 closedForm=0.198 inScope=true
- [PASS] decay L04 — maturity=decayed activation=0.079 ageDays=67 closedForm=0.213 inScope=false
- [PASS] decay L05 — maturity=decayed activation=0.083 ageDays=63 closedForm=0.233 inScope=false
- [PASS] reconcile-enqueued K01 — status=completed lastError=—
- [PASS] reconcile-flip K01 — outcomeVersion=1 decision=reconcile (re-resolved)
- [PASS] reconcile-enqueued K02 — status=completed lastError=—
- [PASS] reconcile-flip K02 — outcomeVersion=1 decision=reconcile (re-resolved)
- [PASS] reconcile-enqueued K03 — status=completed lastError=—
- [PASS] reconcile-flip K03 — outcomeVersion=1 decision=reconcile (re-resolved)
- [PASS] reconcile-enqueued K04 — status=completed lastError=—
- [PASS] reconcile-flip K04 — outcomeVersion=1 decision=reconcile (re-resolved)
- [PASS] reconcile-enqueued PF03 — status=completed lastError=—
- [PASS] reconcile-flip PF03 — outcomeVersion=1 decision=reconcile (re-resolved)
- [PASS] reconcile-enqueued PF04 — status=completed lastError=—
- [PASS] reconcile-flip PF04 — outcomeVersion=1 decision=reconcile (re-resolved)
- [PASS] reconcile-enqueued LQ03 — status=completed lastError=—
- [PASS] reconcile-flip LQ03 — outcomeVersion=1 decision=reconcile (re-resolved)
- [PASS] reconcile-enqueued LQ04 — status=completed lastError=—
- [PASS] reconcile-flip LQ04 — outcomeVersion=1 decision=reconcile (re-resolved)
- [PASS] clamp-ceiling A01 — source=observed(rank 2) ceiling=strong(rank 3)
- [PASS] clamp-ceiling A03 — source=observed(rank 2) ceiling=strong(rank 3)
- [PASS] clamp-ceiling A04 — source=observed(rank 2) ceiling=strong(rank 3)
- [PASS] clamp-ceiling A05 — source=observed(rank 2) ceiling=strong(rank 3)
- [PASS] clamp-ceiling A06 — source=observed(rank 2) ceiling=strong(rank 3)
- [PASS] clamp-ceiling A07 — source=observed(rank 2) ceiling=strong(rank 3)
- [PASS] clamp-ceiling A08 — source=observed(rank 2) ceiling=strong(rank 3)
- [PASS] clamp-ceiling B02 — source=observed(rank 2) ceiling=moderate(rank 2)
- [PASS] clamp-ceiling B04 — source=observed(rank 2) ceiling=moderate(rank 2)
- [PASS] clamp-ceiling B06 — source=observed(rank 2) ceiling=moderate(rank 2)
- [PASS] clamp-ceiling A11 — source=observed(rank 2) ceiling=strong(rank 3)
- [PASS] clamp-ceiling PB02 — source=observed(rank 2) ceiling=moderate(rank 2)
- [PASS] clamp-ceiling DP03 — source=observed(rank 2) ceiling=moderate(rank 2)
- [PASS] clamp-ceiling B08 — source=observed(rank 2) ceiling=moderate(rank 2)
- [PASS] clamp-ceiling LQ02 — source=observed(rank 2) ceiling=moderate(rank 2)
- [PASS] clamp-ceiling F03 — source=observed(rank 2) ceiling=moderate(rank 2)
- [PASS] clamp-ceiling XV02 — source=observed(rank 2) ceiling=moderate(rank 2)
- [PASS] clamp-ceiling F06 — source=observed(rank 2) ceiling=moderate(rank 2)
- [PASS] clamp-ceiling A14 — source=observed(rank 2) ceiling=strong(rank 3)
- [PASS] S5 scorer: hard gates evaluated; soft metrics + findings recorded — enforced=76 failing=0 knownGap=34

### Judge (live DeepSeek via OpenRouter)

_no judge calls recorded_

### Retrieval precision@k (real Gemma corpus)

| k | queries | relevantHits | precision@k |
| ---: | ---: | ---: | ---: |
| 1 | 21 | 10 | 0.476 |

### Funnel findings (baseline characterization)

| code | manifested | summary |
| --- | --- | --- |
| F5 | YES | P01: secret shape expected door-reject; door rejected=false (knownGap currentlyLeaks) |
| F5 | no | P02: secret shape expected door-reject; door rejected=true (knownGap currentlyLeaks) |
| F5 | YES | XP02: secret shape expected door-reject; door rejected=false (knownGap currentlyLeaks) |
| F5 | YES | P05: secret shape expected door-reject; door rejected=false (knownGap currentlyLeaks) |
| F5 | no | P01: secret-in-stored/recalled scan leaked=false (F5 known-gap leaker) |
| F5 | no | P02: secret-in-stored/recalled scan leaked=false (F5 known-gap leaker) |
| F5 | no | XP02: secret-in-stored/recalled scan leaked=false (F5 known-gap leaker) |
| F5 | no | P05: secret-in-stored/recalled scan leaked=false (F5 known-gap leaker) |
| F7 | YES | Q-RAYDIUM-LP/G03: stale entry still active + retrievable after its superseding successor ran — F7 semantic-conflict gap (not retired) |
| F7 | YES | Q-ROUTING-CURRENT/F05: stale entry still active + retrievable after its superseding successor ran — F7 semantic-conflict gap (not retired) |
| F7 | YES | Q-LEVERAGE-POLICY/G01: stale entry still active + retrievable after its superseding successor ran — F7 semantic-conflict gap (not retired) |
| F7 | YES | Q-BEAR-STRATEGY/L01: stale entry still active + retrievable after its superseding successor ran — F7 semantic-conflict gap (not retired) |
| F7 | YES | Q-BEAR-STRATEGY/L02: stale entry still active + retrievable after its superseding successor ran — F7 semantic-conflict gap (not retired) |
| F7 | YES | Q-BEAR-STRATEGY/L03: stale entry still active + retrievable after its superseding successor ran — F7 semantic-conflict gap (not retired) |
| F7 | YES | Q-BEAR-STRATEGY/G05: stale entry still active + retrievable after its superseding successor ran — F7 semantic-conflict gap (not retired) |
| F7 | YES | Q-LIQUIDATION-DISCIPLINE/LQ01: stale entry still active + retrievable after its superseding successor ran — F7 semantic-conflict gap (not retired) |
| F7 | YES | Q-LIQUIDATION-DISCIPLINE/PB01: stale entry still active + retrievable after its superseding successor ran — F7 semantic-conflict gap (not retired) |
| F7 | YES | Q-LIQUIDATION-DISCIPLINE/PB03: stale entry still active + retrievable after its superseding successor ran — F7 semantic-conflict gap (not retired) |

### Oracle scoring (e2e correctness vs pre-registered oracle)

| dimension | scored | passed | pass-rate |
| --- | ---: | ---: | ---: |
| decay | 11 | 11 | 100% |
| graph | 48 | 8 | 17% |
| junk_rejection | 4 | 1 | 25% |
| promotion | 41 | 14 | 34% |
| reconcile | 8 | 8 | 100% |
| retrieval | 21 | 10 | 48% |
| steered_judge | 4 | 4 | 100% |
| supersession | 9 | 1 | 11% |

- total scored: 146; passed: 57; overall: 39%

#### Per-subsystem failure attribution (cause-codes)

| causeCode | count | items |
| --- | ---: | --- |
| premature_generalization | 3 | G04, G02, G06 |

- F31 unmeasured: **7** judge call(s) reached the LLM but returned an INVALID verdict → those items' soft dimensions were dropped from / cause-coded in their denominators (0 explicitly recorded as `f31_unmeasured`; 146 dimensions scored total).
