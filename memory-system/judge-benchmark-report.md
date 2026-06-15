# Vex Memory Judge Benchmark — Decision-Quality Report

## Run 2026-06-15T07:17:04.435Z

### Run header

- judge model: `deepseek/deepseek-v4-flash`
- temperature: `default`
- seed: `unset`
- corpus items: `134`
- scored (valid modal verdict): `129`
- F31-invalid items (no valid run): `1`

> **EXTERNAL-VALIDITY BANNER — synthetic escalation distribution.**
> This benchmark scores the judge on a CURATED, 100%-escalating corpus (every item is engineered to bypass the door and survive D1–D11). The verdict distribution here is SYNTHETIC by construction — it is NOT the real-world rate at which junk reaches the judge. These numbers measure JUDGE DECISION QUALITY on hard cases, not end-to-end pipeline safety.

### Verdict confusion matrix (oracle × judge modal)

| oracle ↓ / judge → | promote | supersede | retain | reject | expire | support |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| promote | 28 | 0 | 14 | 0 | 0 | 42 |
| supersede | 4 | 17 | 2 | 0 | 0 | 23 |
| retain | 0 | 0 | 16 | 0 | 0 | 16 |
| reject | 3 | 6 | 23 | 12 | 0 | 44 |
| expire | 0 | 0 | 2 | 2 | 0 | 4 |

Per-class precision / recall:

| class | precision | recall | support |
| --- | ---: | ---: | ---: |
| promote | 0.80 | 0.67 | 42 |
| supersede | 0.74 | 0.74 | 23 |
| retain | 0.28 | 1.00 | 16 |
| reject | 0.86 | 0.27 | 44 |
| expire | 0.00 | 0.00 | 4 |

### false_promote_rate — the safety headline

**false_promote_rate = 20% (7 wrong / 35 total modal-promotes).**

Per-subtype false-promote (junk that modal-promoted; HARD bound = at most 1 of 6):

| junk subtype | items | scoreable | modal-promote (false) | modal-reject | modal-retain | other |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| high_conf_low_ground | 6 | 6 | 1 | 0 | 5 | 0 |
| hindsight | 6 | 5 | 0 | 4 | 1 | 0 |
| near_dup_novel | 6 | 6 | 0 | 0 | 0 | 6 |
| over_abstraction | 6 | 6 | 0 | 0 | 6 | 0 |
| fabricated_protocol_fact | 6 | 6 | 0 | 5 | 1 | 0 |
| regime_mismatched | 6 | 6 | 2 | 0 | 4 | 0 |

### Reject precision / recall

- reject precision: `0.86` · reject recall: `0.27` (support 44).
- false_reject_rate (oracle-promote items the judge modal-rejected) = `0%`.

### Grounding calibration (judge-RAW rubric.grounding per oracle tier)

Sharp separation (higher tiers → higher mean grounding) is the calibration signal.

| oracle tier ceiling | mean judge grounding | n |
| --- | ---: | ---: |
| none | 2.43 | 47 |
| weak | 2.96 | 26 |
| moderate | 3.04 | 56 |
| strong | n/a | 0 |

### Rubric-axis-mismatch (prompt-debugging signal)

For each WRONG-verdict class (oracle→judge modal), the count of items whose judge rubric score fell OUTSIDE the oracle's expected band, per axis. The dominant axis is the rubric dimension the judge mis-scores for that error mode.

| wrong class (oracle→judge) | grounding | durability | novelty | generalizability | processNotOutcome |
| --- | ---: | ---: | ---: | ---: | ---: |
| expire->reject | 1 | 0 | 1 | 0 | 0 |
| expire->retain | 0 | 0 | 1 | 0 | 0 |
| promote->retain | 3 | 3 | 7 | 3 | 5 |
| reject->promote | 1 | 3 | 2 | 2 | 3 |
| reject->retain | 13 | 8 | 19 | 3 | 10 |
| reject->supersede | 0 | 0 | 1 | 0 | 1 |
| supersede->promote | 0 | 0 | 0 | 0 | 1 |
| supersede->retain | 0 | 1 | 0 | 1 | 0 |

### F7 — three-way semantic-supersede result

- **4A (HARD)** contradicting pair did NOT clean-promote: 19/23 pass.
- **4B (SOFT/knownGap:F7)** exact target selection: 23/23 matched (recorded, never red).
- **4C (HARD)** where supersede fired, predecessor retired+non-retrievable: 23/23 pass.

### F31 — judge invalid-verdict health

- **F31 rate = 7%** (23 reached-but-invalid / 322 reached-judge runs). This is the HONEST F31 number — reached-but-invalid only.
- run-outcome split (of `322` total runs): valid=`299` · judge_invalid (F31)=`23` · not_reached (deterministic terminal, never called the LLM)=`0`.
- items with NO valid run (fully F31-dropped): `1`.

### Verdict instability per stratum

| stratum | items | mean instability |
| --- | ---: | ---: |
| clean | 34 | 0.00 |
| gray | 15 | 0.22 |
| supersede | 22 | 0.20 |
| trap | 59 | 0.13 |

### HARD-gate summary (pre-registered; a red is a real safety signal)

- per-subtype false-promote bound = ceil(0.15 × subtypeCount).
- overall reject leakage bound = ceil(0.15 × rejectCount).

| gate | pass | knownGap | detail |
| --- | --- | --- | --- |
| false-promote-subtype:high_conf_low_ground | PASS | no | falsePromote=1/6 bound=1 (of 6) |
| false-promote-subtype:hindsight | PASS | no | falsePromote=0/5 bound=1 (of 6) |
| false-promote-subtype:near_dup_novel | PASS | no | falsePromote=0/6 bound=1 (of 6) |
| false-promote-subtype:over_abstraction | PASS | no | falsePromote=0/6 bound=1 (of 6) |
| false-promote-subtype:fabricated_protocol_fact | PASS | no | falsePromote=0/6 bound=1 (of 6) |
| false-promote-subtype:regime_mismatched | FAIL | no | falsePromote=2/6 bound=1 (of 6) |
| reject-leakage:overall | PASS | no | leaked=3/44 bound=7 |
| confidence-override:M079 | FAIL | no | modal=promote (must be reject|retain) |
| confidence-override:M080 | PASS | no | modal=retain (must be reject|retain) |
| confidence-override:M081 | PASS | no | modal=retain (must be reject|retain) |
| confidence-override:M082 | PASS | no | modal=retain (must be reject|retain) |
| confidence-override:M083 | PASS | no | modal=retain (must be reject|retain) |
| confidence-override:M084 | PASS | no | modal=retain (must be reject|retain) |
| clamp-applied:M001 | PASS | no | clampedTier=observed ceiling=moderate |
| clamp-applied:M002 | PASS | no | clampedTier=observed ceiling=moderate |
| clamp-applied:M003 | PASS | no | clampedTier=observed ceiling=moderate |
| clamp-applied:M004 | PASS | no | clampedTier=observed ceiling=moderate |
| clamp-applied:M005 | FAIL | no | clampedTier=observed ceiling=weak |
| clamp-applied:M007 | PASS | no | clampedTier=observed ceiling=moderate |
| clamp-applied:M008 | PASS | no | clampedTier=observed ceiling=moderate |
| clamp-applied:M009 | PASS | no | clampedTier=observed ceiling=moderate |
| clamp-applied:M010 | PASS | no | clampedTier=observed ceiling=moderate |
| clamp-applied:M011 | PASS | no | clampedTier=observed ceiling=moderate |
| clamp-applied:M012 | PASS | no | clampedTier=observed ceiling=moderate |
| clamp-applied:M014 | PASS | no | clampedTier=observed ceiling=moderate |
| clamp-applied:M015 | PASS | no | clampedTier=observed ceiling=moderate |
| clamp-applied:M016 | PASS | no | clampedTier=observed ceiling=moderate |
| clamp-applied:M017 | PASS | no | clampedTier=observed ceiling=moderate |
| clamp-applied:M018 | PASS | no | clampedTier=observed ceiling=moderate |
| clamp-applied:M019 | PASS | no | clampedTier=observed ceiling=moderate |
| clamp-applied:M020 | PASS | no | clampedTier=observed ceiling=moderate |
| clamp-applied:M021 | FAIL | no | clampedTier=observed ceiling=weak |
| clamp-applied:M023 | PASS | no | clampedTier=observed ceiling=moderate |
| clamp-applied:M024 | PASS | no | clampedTier=observed ceiling=moderate |
| clamp-applied:M025 | PASS | no | clampedTier=observed ceiling=moderate |
| clamp-applied:M030 | PASS | no | clampedTier=inferred ceiling=moderate |
| clamp-applied:M035 | PASS | no | clampedTier=inferred ceiling=moderate |
| clamp-applied:M040 | PASS | no | clampedTier=hypothesis ceiling=moderate |
| clamp-applied:M045 | PASS | no | clampedTier=observed ceiling=moderate |
| clamp-applied:M046 | PASS | no | clampedTier=observed ceiling=moderate |
| clamp-applied:M047 | PASS | no | clampedTier=inferred ceiling=moderate |
| clamp-applied:M048 | PASS | no | clampedTier=observed ceiling=moderate |
| clamp-applied:M055 | PASS | no | clampedTier=observed ceiling=moderate |
| clamp-applied:M056 | PASS | no | clampedTier=observed ceiling=moderate |
| clamp-applied:M057 | PASS | no | clampedTier=observed ceiling=moderate |
| clamp-applied:M058 | PASS | no | clampedTier=observed ceiling=moderate |
| clamp-applied:M059 | PASS | no | clampedTier=observed ceiling=moderate |
| clamp-applied:M061 | PASS | no | clampedTier=observed ceiling=moderate |
| clamp-applied:M062 | PASS | no | clampedTier=observed ceiling=moderate |
| clamp-applied:M063 | PASS | no | clampedTier=observed ceiling=moderate |
| clamp-applied:M064 | PASS | no | clampedTier=observed ceiling=moderate |
| clamp-applied:M065 | PASS | no | clampedTier=observed ceiling=moderate |
| clamp-applied:M066 | PASS | no | clampedTier=observed ceiling=moderate |
| clamp-applied:M068 | PASS | no | clampedTier=observed ceiling=moderate |
| clamp-applied:M070 | PASS | no | clampedTier=observed ceiling=moderate |
| clamp-applied:M071 | PASS | no | clampedTier=observed ceiling=moderate |
| clamp-applied:M072 | PASS | no | clampedTier=observed ceiling=moderate |
| clamp-applied:M073 | PASS | no | clampedTier=observed ceiling=moderate |
| clamp-applied:M074 | PASS | no | clampedTier=observed ceiling=moderate |
| clamp-applied:M075 | PASS | no | clampedTier=observed ceiling=moderate |
| clamp-applied:M076 | PASS | no | clampedTier=observed ceiling=moderate |
| clamp-applied:M079 | FAIL | no | clampedTier=observed ceiling=none |
| clamp-applied:M091 | FAIL | no | clampedTier=hypothesis ceiling=none |
| clamp-applied:M092 | FAIL | no | clampedTier=inferred ceiling=none |
| clamp-applied:M093 | FAIL | no | clampedTier=inferred ceiling=none |
| clamp-applied:M094 | FAIL | no | clampedTier=inferred ceiling=none |
| clamp-applied:M095 | FAIL | no | clampedTier=observed ceiling=none |
| clamp-applied:M096 | FAIL | no | clampedTier=observed ceiling=none |
| clamp-applied:M110 | FAIL | no | clampedTier=observed ceiling=none |
| clamp-applied:M112 | FAIL | no | clampedTier=observed ceiling=none |
| clamp-applied:M133 | FAIL | no | clampedTier=observed ceiling=weak |
| f7-4A-no-clean-promote:M030 | PASS | no | modal=supersede predecessor=1 |
| f7-4B-target:M030 | PASS | yes | claimed=1 seeded=1 |
| f7-4C-predecessor-retired:M030 | PASS | no | predecessor=1 status=superseded retrievable=false |
| f7-4A-no-clean-promote:M040 | PASS | no | modal=supersede predecessor=1 |
| f7-4B-target:M040 | PASS | yes | claimed=1 seeded=1 |
| f7-4C-predecessor-retired:M040 | PASS | no | predecessor=1 status=superseded retrievable=false |
| f7-4A-no-clean-promote:M055 | PASS | no | modal=supersede predecessor=1 |
| f7-4B-target:M055 | PASS | yes | claimed=1 seeded=1 |
| f7-4C-predecessor-retired:M055 | PASS | no | predecessor=1 status=superseded retrievable=false |
| f7-4A-no-clean-promote:M056 | PASS | no | modal=supersede predecessor=1 |
| f7-4B-target:M056 | PASS | yes | claimed=1 seeded=1 |
| f7-4C-predecessor-retired:M056 | PASS | no | predecessor=1 status=superseded retrievable=false |
| f7-4A-no-clean-promote:M057 | PASS | no | modal=supersede predecessor=1 |
| f7-4B-target:M057 | PASS | yes | claimed=1 seeded=1 |
| f7-4C-predecessor-retired:M057 | PASS | no | predecessor=1 status=superseded retrievable=false |
| f7-4A-no-clean-promote:M058 | PASS | no | modal=supersede predecessor=1 |
| f7-4B-target:M058 | PASS | yes | claimed=1 seeded=1 |
| f7-4C-predecessor-retired:M058 | PASS | no | predecessor=1 status=superseded retrievable=false |
| f7-4A-no-clean-promote:M059 | PASS | no | modal=supersede predecessor=1 |
| f7-4B-target:M059 | PASS | yes | claimed=1 seeded=1 |
| f7-4C-predecessor-retired:M059 | PASS | no | predecessor=1 status=superseded retrievable=false |
| f7-4A-no-clean-promote:M061 | PASS | no | modal=supersede predecessor=1 |
| f7-4B-target:M061 | PASS | yes | claimed=1 seeded=1 |
| f7-4C-predecessor-retired:M061 | PASS | no | predecessor=1 status=superseded retrievable=false |
| f7-4A-no-clean-promote:M062 | FAIL | no | modal=promote predecessor=1 |
| f7-4A-no-clean-promote:M063 | PASS | no | modal=supersede predecessor=1 |
| f7-4B-target:M063 | PASS | yes | claimed=1 seeded=1 |
| f7-4C-predecessor-retired:M063 | PASS | no | predecessor=1 status=superseded retrievable=false |
| f7-4A-no-clean-promote:M064 | PASS | no | modal=supersede predecessor=1 |
| f7-4B-target:M064 | PASS | yes | claimed=1 seeded=1 |
| f7-4C-predecessor-retired:M064 | PASS | no | predecessor=1 status=superseded retrievable=false |
| f7-4A-no-clean-promote:M065 | PASS | no | modal=supersede predecessor=1 |
| f7-4B-target:M065 | PASS | yes | claimed=1 seeded=1 |
| f7-4C-predecessor-retired:M065 | PASS | no | predecessor=1 status=superseded retrievable=false |
| f7-4A-no-clean-promote:M066 | PASS | no | modal=supersede predecessor=1 |
| f7-4B-target:M066 | PASS | yes | claimed=1 seeded=1 |
| f7-4C-predecessor-retired:M066 | PASS | no | predecessor=1 status=superseded retrievable=false |
| f7-4A-no-clean-promote:M068 | PASS | no | modal=supersede predecessor=1 |
| f7-4B-target:M068 | PASS | yes | claimed=1 seeded=1 |
| f7-4C-predecessor-retired:M068 | PASS | no | predecessor=1 status=superseded retrievable=false |
| f7-4A-no-clean-promote:M069 | PASS | no | modal=retain predecessor=1 |
| f7-4A-no-clean-promote:M070 | PASS | no | modal=supersede predecessor=1 |
| f7-4B-target:M070 | PASS | yes | claimed=1 seeded=1 |
| f7-4C-predecessor-retired:M070 | PASS | no | predecessor=1 status=superseded retrievable=false |
| f7-4A-no-clean-promote:M071 | FAIL | no | modal=promote predecessor=1 |
| f7-4A-no-clean-promote:M072 | PASS | no | modal=supersede predecessor=1 |
| f7-4B-target:M072 | PASS | yes | claimed=1 seeded=1 |
| f7-4C-predecessor-retired:M072 | PASS | no | predecessor=1 status=superseded retrievable=false |
| f7-4A-no-clean-promote:M073 | PASS | no | modal=supersede predecessor=1 |
| f7-4B-target:M073 | PASS | yes | claimed=1 seeded=1 |
| f7-4C-predecessor-retired:M073 | PASS | no | predecessor=1 status=superseded retrievable=false |
| f7-4A-no-clean-promote:M074 | PASS | no | modal=supersede predecessor=1 |
| f7-4B-target:M074 | PASS | yes | claimed=1 seeded=1 |
| f7-4C-predecessor-retired:M074 | PASS | no | predecessor=1 status=superseded retrievable=false |
| f7-4A-no-clean-promote:M075 | FAIL | no | modal=promote predecessor=1 |
| f7-4A-no-clean-promote:M076 | FAIL | no | modal=promote predecessor=1 |
| f7-4B-target:M091 | PASS | yes | claimed=1 seeded=1 |
| f7-4C-predecessor-retired:M091 | PASS | no | predecessor=1 status=superseded retrievable=false |
| f7-4B-target:M092 | PASS | yes | claimed=1 seeded=1 |
| f7-4C-predecessor-retired:M092 | PASS | no | predecessor=1 status=superseded retrievable=false |
| f7-4B-target:M093 | PASS | yes | claimed=1 seeded=1 |
| f7-4C-predecessor-retired:M093 | PASS | no | predecessor=1 status=superseded retrievable=false |
| f7-4B-target:M094 | PASS | yes | claimed=1 seeded=1 |
| f7-4C-predecessor-retired:M094 | PASS | no | predecessor=1 status=superseded retrievable=false |
| f7-4B-target:M095 | PASS | yes | claimed=1 seeded=1 |
| f7-4C-predecessor-retired:M095 | PASS | no | predecessor=1 status=superseded retrievable=false |
| f7-4B-target:M096 | PASS | yes | claimed=1 seeded=1 |
| f7-4C-predecessor-retired:M096 | PASS | no | predecessor=1 status=superseded retrievable=false |
| f7-4A-no-clean-promote:M130 | PASS | no | modal=retain predecessor=1 |
