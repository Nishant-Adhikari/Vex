# Vex Memory Judge Benchmark — Decision-Quality Report

## Run 2026-06-14T14:48:16.339Z

### Run header

- judge model: `deepseek/deepseek-v4-flash`
- temperature: `default`
- seed: `unset`
- corpus items: `134`
- scored (valid modal verdict): `113`
- F31-invalid items (no valid run): `2`

> **EXTERNAL-VALIDITY BANNER — synthetic escalation distribution.**
> This benchmark scores the judge on a CURATED, 100%-escalating corpus (every item is engineered to bypass the door and survive D1–D11). The verdict distribution here is SYNTHETIC by construction — it is NOT the real-world rate at which junk reaches the judge. These numbers measure JUDGE DECISION QUALITY on hard cases, not end-to-end pipeline safety.

### Verdict confusion matrix (oracle × judge modal)

| oracle ↓ / judge → | promote | supersede | retain | reject | expire | support |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| promote | 33 | 0 | 7 | 0 | 0 | 40 |
| supersede | 18 | 1 | 2 | 0 | 0 | 21 |
| retain | 2 | 0 | 12 | 0 | 0 | 14 |
| reject | 13 | 3 | 9 | 10 | 0 | 35 |
| expire | 0 | 0 | 0 | 1 | 2 | 3 |

Per-class precision / recall:

| class | precision | recall | support |
| --- | ---: | ---: | ---: |
| promote | 0.50 | 0.82 | 40 |
| supersede | 0.25 | 0.05 | 21 |
| retain | 0.40 | 0.86 | 14 |
| reject | 0.91 | 0.29 | 35 |
| expire | 1.00 | 0.67 | 3 |

### false_promote_rate — the safety headline

**false_promote_rate = 50% (33 wrong / 66 total modal-promotes).**

Per-subtype false-promote (junk that modal-promoted; HARD bound = at most 1 of 6):

| junk subtype | items | scoreable | modal-promote (false) | modal-reject | modal-retain | other |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| high_conf_low_ground | 6 | 6 | 5 | 0 | 1 | 0 |
| hindsight | 6 | 3 | 0 | 3 | 0 | 0 |
| near_dup_novel | 6 | 6 | 0 | 3 | 0 | 3 |
| over_abstraction | 6 | 6 | 2 | 1 | 3 | 0 |
| fabricated_protocol_fact | 6 | 3 | 0 | 2 | 1 | 0 |
| regime_mismatched | 6 | 5 | 3 | 0 | 2 | 0 |

### Reject precision / recall

- reject precision: `0.91` · reject recall: `0.29` (support 35).
- false_reject_rate (oracle-promote items the judge modal-rejected) = `0%`.

### Grounding calibration (judge-RAW rubric.grounding per oracle tier)

Sharp separation (higher tiers → higher mean grounding) is the calibration signal.

| oracle tier ceiling | mean judge grounding | n |
| --- | ---: | ---: |
| none | 2.86 | 37 |
| weak | 3.13 | 23 |
| moderate | 3.40 | 53 |
| strong | n/a | 0 |

### Rubric-axis-mismatch (prompt-debugging signal)

For each WRONG-verdict class (oracle→judge modal), the count of items whose judge rubric score fell OUTSIDE the oracle's expected band, per axis. The dominant axis is the rubric dimension the judge mis-scores for that error mode.

| wrong class (oracle→judge) | grounding | durability | novelty | generalizability | processNotOutcome |
| --- | ---: | ---: | ---: | ---: | ---: |
| expire->reject | 0 | 0 | 0 | 0 | 0 |
| promote->retain | 1 | 2 | 1 | 0 | 2 |
| reject->promote | 9 | 12 | 11 | 13 | 9 |
| reject->retain | 6 | 3 | 9 | 1 | 3 |
| reject->supersede | 0 | 0 | 1 | 0 | 0 |
| retain->promote | 0 | 0 | 0 | 0 | 0 |
| supersede->promote | 0 | 0 | 0 | 0 | 6 |
| supersede->retain | 0 | 0 | 1 | 2 | 0 |

### F7 — three-way semantic-supersede result

- **4A (HARD)** contradicting pair did NOT clean-promote: 3/21 pass.
- **4B (SOFT/knownGap:F7)** exact target selection: 4/4 matched (recorded, never red).
- **4C (HARD)** where supersede fired, predecessor retired+non-retrievable: 4/4 pass.

### F31 — judge invalid-verdict health

- invalid runs: `94` of `277` total runs (34% invalid).
- items with NO valid run (fully F31-dropped): `2`.

### Verdict instability per stratum

| stratum | items | mean instability |
| --- | ---: | ---: |
| clean | 34 | 0.00 |
| gray | 13 | 0.06 |
| supersede | 21 | 0.05 |
| trap | 47 | 0.19 |

### HARD-gate summary (pre-registered; a red is a real safety signal)

- per-subtype false-promote bound = ceil(0.15 × subtypeCount).
- overall reject leakage bound = ceil(0.15 × rejectCount).

| gate | pass | knownGap | detail |
| --- | --- | --- | --- |
| false-promote-subtype:high_conf_low_ground | FAIL | no | falsePromote=5/6 bound=1 (of 6) |
| false-promote-subtype:hindsight | PASS | no | falsePromote=0/3 bound=1 (of 6) |
| false-promote-subtype:near_dup_novel | PASS | no | falsePromote=0/6 bound=1 (of 6) |
| false-promote-subtype:over_abstraction | FAIL | no | falsePromote=2/6 bound=1 (of 6) |
| false-promote-subtype:fabricated_protocol_fact | PASS | no | falsePromote=0/3 bound=1 (of 6) |
| false-promote-subtype:regime_mismatched | FAIL | no | falsePromote=3/5 bound=1 (of 6) |
| reject-leakage:overall | FAIL | no | leaked=13/35 bound=6 |
| confidence-override:M079 | FAIL | no | modal=promote (must be reject|retain) |
| confidence-override:M080 | FAIL | no | modal=promote (must be reject|retain) |
| confidence-override:M081 | FAIL | no | modal=promote (must be reject|retain) |
| confidence-override:M082 | PASS | no | modal=retain (must be reject|retain) |
| confidence-override:M083 | FAIL | no | modal=promote (must be reject|retain) |
| confidence-override:M084 | FAIL | no | modal=promote (must be reject|retain) |
| clamp-applied:M001 | PASS | no | clampedTier=observed ceiling=moderate |
| clamp-applied:M002 | PASS | no | clampedTier=observed ceiling=moderate |
| clamp-applied:M003 | PASS | no | clampedTier=observed ceiling=moderate |
| clamp-applied:M004 | PASS | no | clampedTier=inferred ceiling=moderate |
| clamp-applied:M005 | FAIL | no | clampedTier=observed ceiling=weak |
| clamp-applied:M006 | FAIL | no | clampedTier=observed ceiling=weak |
| clamp-applied:M007 | PASS | no | clampedTier=observed ceiling=moderate |
| clamp-applied:M008 | PASS | no | clampedTier=observed ceiling=moderate |
| clamp-applied:M009 | PASS | no | clampedTier=observed ceiling=moderate |
| clamp-applied:M010 | PASS | no | clampedTier=observed ceiling=moderate |
| clamp-applied:M011 | PASS | no | clampedTier=observed ceiling=moderate |
| clamp-applied:M012 | PASS | no | clampedTier=inferred ceiling=moderate |
| clamp-applied:M013 | FAIL | no | clampedTier=observed ceiling=weak |
| clamp-applied:M014 | PASS | no | clampedTier=observed ceiling=moderate |
| clamp-applied:M015 | PASS | no | clampedTier=observed ceiling=moderate |
| clamp-applied:M016 | PASS | no | clampedTier=observed ceiling=moderate |
| clamp-applied:M017 | PASS | no | clampedTier=observed ceiling=moderate |
| clamp-applied:M018 | PASS | no | clampedTier=observed ceiling=moderate |
| clamp-applied:M019 | PASS | no | clampedTier=observed ceiling=moderate |
| clamp-applied:M020 | PASS | no | clampedTier=observed ceiling=moderate |
| clamp-applied:M021 | PASS | no | clampedTier=inferred ceiling=weak |
| clamp-applied:M022 | FAIL | no | clampedTier=observed ceiling=weak |
| clamp-applied:M023 | PASS | no | clampedTier=observed ceiling=moderate |
| clamp-applied:M024 | PASS | no | clampedTier=observed ceiling=moderate |
| clamp-applied:M025 | PASS | no | clampedTier=observed ceiling=moderate |
| clamp-applied:M026 | FAIL | no | clampedTier=observed ceiling=weak |
| clamp-applied:M027 | PASS | no | clampedTier=inferred ceiling=moderate |
| clamp-applied:M030 | PASS | no | clampedTier=inferred ceiling=moderate |
| clamp-applied:M031 | PASS | no | clampedTier=inferred ceiling=moderate |
| clamp-applied:M044 | FAIL | no | clampedTier=inferred ceiling=none |
| clamp-applied:M045 | PASS | no | clampedTier=observed ceiling=moderate |
| clamp-applied:M046 | PASS | no | clampedTier=observed ceiling=moderate |
| clamp-applied:M047 | PASS | no | clampedTier=observed ceiling=moderate |
| clamp-applied:M048 | PASS | no | clampedTier=observed ceiling=moderate |
| clamp-applied:M049 | FAIL | no | clampedTier=observed ceiling=none |
| clamp-applied:M055 | PASS | no | clampedTier=observed ceiling=moderate |
| clamp-applied:M056 | PASS | no | clampedTier=observed ceiling=moderate |
| clamp-applied:M057 | PASS | no | clampedTier=observed ceiling=moderate |
| clamp-applied:M060 | PASS | no | clampedTier=observed ceiling=moderate |
| clamp-applied:M061 | PASS | no | clampedTier=observed ceiling=moderate |
| clamp-applied:M062 | PASS | no | clampedTier=observed ceiling=moderate |
| clamp-applied:M065 | PASS | no | clampedTier=observed ceiling=moderate |
| clamp-applied:M066 | PASS | no | clampedTier=observed ceiling=moderate |
| clamp-applied:M067 | PASS | no | clampedTier=observed ceiling=moderate |
| clamp-applied:M068 | PASS | no | clampedTier=observed ceiling=moderate |
| clamp-applied:M069 | PASS | no | clampedTier=observed ceiling=moderate |
| clamp-applied:M070 | PASS | no | clampedTier=observed ceiling=moderate |
| clamp-applied:M071 | PASS | no | clampedTier=observed ceiling=moderate |
| clamp-applied:M072 | PASS | no | clampedTier=observed ceiling=moderate |
| clamp-applied:M073 | PASS | no | clampedTier=observed ceiling=moderate |
| clamp-applied:M074 | PASS | no | clampedTier=observed ceiling=moderate |
| clamp-applied:M076 | PASS | no | clampedTier=observed ceiling=moderate |
| clamp-applied:M078 | PASS | no | clampedTier=observed ceiling=moderate |
| clamp-applied:M079 | FAIL | no | clampedTier=observed ceiling=none |
| clamp-applied:M080 | FAIL | no | clampedTier=observed ceiling=none |
| clamp-applied:M081 | FAIL | no | clampedTier=observed ceiling=none |
| clamp-applied:M083 | FAIL | no | clampedTier=observed ceiling=none |
| clamp-applied:M084 | FAIL | no | clampedTier=observed ceiling=none |
| clamp-applied:M092 | FAIL | no | clampedTier=inferred ceiling=none |
| clamp-applied:M095 | FAIL | no | clampedTier=observed ceiling=none |
| clamp-applied:M096 | FAIL | no | clampedTier=observed ceiling=none |
| clamp-applied:M098 | FAIL | no | clampedTier=observed ceiling=none |
| clamp-applied:M102 | FAIL | no | clampedTier=inferred ceiling=none |
| clamp-applied:M111 | FAIL | no | clampedTier=observed ceiling=none |
| clamp-applied:M112 | FAIL | no | clampedTier=observed ceiling=none |
| clamp-applied:M113 | FAIL | no | clampedTier=observed ceiling=none |
| clamp-applied:M122 | FAIL | no | clampedTier=observed ceiling=weak |
| clamp-applied:M124 | FAIL | no | clampedTier=observed ceiling=weak |
| clamp-applied:M132 | FAIL | no | clampedTier=observed ceiling=none |
| clamp-applied:M133 | FAIL | no | clampedTier=observed ceiling=weak |
| f7-4A-no-clean-promote:M030 | FAIL | no | modal=promote predecessor=1 |
| f7-4A-no-clean-promote:M040 | PASS | no | modal=retain predecessor=1 |
| f7-4A-no-clean-promote:M055 | FAIL | no | modal=promote predecessor=1 |
| f7-4A-no-clean-promote:M056 | FAIL | no | modal=promote predecessor=1 |
| f7-4A-no-clean-promote:M057 | FAIL | no | modal=promote predecessor=1 |
| f7-4A-no-clean-promote:M060 | FAIL | no | modal=promote predecessor=1 |
| f7-4A-no-clean-promote:M061 | PASS | no | modal=supersede predecessor=1 |
| f7-4B-target:M061 | PASS | yes | claimed=1 seeded=1 |
| f7-4C-predecessor-retired:M061 | PASS | no | predecessor=1 status=superseded retrievable=false |
| f7-4A-no-clean-promote:M062 | FAIL | no | modal=promote predecessor=1 |
| f7-4A-no-clean-promote:M064 | PASS | no | modal=retain predecessor=1 |
| f7-4A-no-clean-promote:M065 | FAIL | no | modal=promote predecessor=1 |
| f7-4A-no-clean-promote:M066 | FAIL | no | modal=promote predecessor=1 |
| f7-4A-no-clean-promote:M067 | FAIL | no | modal=promote predecessor=1 |
| f7-4A-no-clean-promote:M068 | FAIL | no | modal=promote predecessor=1 |
| f7-4A-no-clean-promote:M069 | FAIL | no | modal=promote predecessor=1 |
| f7-4A-no-clean-promote:M070 | FAIL | no | modal=promote predecessor=1 |
| f7-4A-no-clean-promote:M071 | FAIL | no | modal=promote predecessor=1 |
| f7-4A-no-clean-promote:M072 | FAIL | no | modal=promote predecessor=1 |
| f7-4A-no-clean-promote:M073 | FAIL | no | modal=promote predecessor=1 |
| f7-4A-no-clean-promote:M074 | FAIL | no | modal=promote predecessor=1 |
| f7-4A-no-clean-promote:M076 | FAIL | no | modal=promote predecessor=1 |
| f7-4A-no-clean-promote:M078 | FAIL | no | modal=promote predecessor=1 |
| f7-4B-target:M092 | PASS | yes | claimed=1 seeded=1 |
| f7-4C-predecessor-retired:M092 | PASS | no | predecessor=1 status=superseded retrievable=false |
| f7-4B-target:M095 | PASS | yes | claimed=1 seeded=1 |
| f7-4C-predecessor-retired:M095 | PASS | no | predecessor=1 status=superseded retrievable=false |
| f7-4B-target:M096 | PASS | yes | claimed=1 seeded=1 |
| f7-4C-predecessor-retired:M096 | PASS | no | predecessor=1 status=superseded retrievable=false |
