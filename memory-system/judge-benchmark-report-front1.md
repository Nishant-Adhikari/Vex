# Vex Memory Judge Benchmark — Decision-Quality Report

## Run 2026-06-14T16:02:00.475Z

### Run header

- judge model: `deepseek/deepseek-v4-flash`
- temperature: `default`
- seed: `unset`
- corpus items: `134`
- scored (valid modal verdict): `118`
- F31-invalid items (no valid run): `1`

> **EXTERNAL-VALIDITY BANNER — synthetic escalation distribution.**
> This benchmark scores the judge on a CURATED, 100%-escalating corpus (every item is engineered to bypass the door and survive D1–D11). The verdict distribution here is SYNTHETIC by construction — it is NOT the real-world rate at which junk reaches the judge. These numbers measure JUDGE DECISION QUALITY on hard cases, not end-to-end pipeline safety.

### Verdict confusion matrix (oracle × judge modal)

| oracle ↓ / judge → | promote | supersede | retain | reject | expire | support |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| promote | 29 | 0 | 11 | 1 | 0 | 41 |
| supersede | 8 | 14 | 2 | 0 | 0 | 24 |
| retain | 0 | 0 | 16 | 0 | 0 | 16 |
| reject | 7 | 6 | 10 | 12 | 0 | 35 |
| expire | 0 | 0 | 2 | 0 | 0 | 2 |

Per-class precision / recall:

| class | precision | recall | support |
| --- | ---: | ---: | ---: |
| promote | 0.66 | 0.71 | 41 |
| supersede | 0.70 | 0.58 | 24 |
| retain | 0.39 | 1.00 | 16 |
| reject | 0.92 | 0.34 | 35 |
| expire | 0.00 | 0.00 | 2 |

### false_promote_rate — the safety headline

**false_promote_rate = 34% (15 wrong / 44 total modal-promotes).**

Per-subtype false-promote (junk that modal-promoted; HARD bound = at most 1 of 6):

| junk subtype | items | scoreable | modal-promote (false) | modal-reject | modal-retain | other |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| high_conf_low_ground | 6 | 6 | 5 | 0 | 1 | 0 |
| hindsight | 6 | 4 | 0 | 3 | 1 | 0 |
| near_dup_novel | 6 | 6 | 0 | 0 | 0 | 6 |
| over_abstraction | 6 | 2 | 0 | 1 | 1 | 0 |
| fabricated_protocol_fact | 6 | 6 | 1 | 5 | 0 | 0 |
| regime_mismatched | 6 | 4 | 1 | 1 | 2 | 0 |

### Reject precision / recall

- reject precision: `0.92` · reject recall: `0.34` (support 35).
- false_reject_rate (oracle-promote items the judge modal-rejected) = `2%`.

### Grounding calibration (judge-RAW rubric.grounding per oracle tier)

Sharp separation (higher tiers → higher mean grounding) is the calibration signal.

| oracle tier ceiling | mean judge grounding | n |
| --- | ---: | ---: |
| none | 2.44 | 36 |
| weak | 2.85 | 26 |
| moderate | 3.05 | 56 |
| strong | n/a | 0 |

### Rubric-axis-mismatch (prompt-debugging signal)

For each WRONG-verdict class (oracle→judge modal), the count of items whose judge rubric score fell OUTSIDE the oracle's expected band, per axis. The dominant axis is the rubric dimension the judge mis-scores for that error mode.

| wrong class (oracle→judge) | grounding | durability | novelty | generalizability | processNotOutcome |
| --- | ---: | ---: | ---: | ---: | ---: |
| expire->retain | 0 | 0 | 2 | 0 | 0 |
| promote->reject | 1 | 1 | 0 | 0 | 1 |
| promote->retain | 2 | 2 | 2 | 1 | 4 |
| reject->promote | 6 | 7 | 7 | 3 | 7 |
| reject->retain | 3 | 2 | 5 | 2 | 5 |
| reject->supersede | 0 | 0 | 1 | 0 | 1 |
| supersede->promote | 0 | 0 | 0 | 0 | 2 |
| supersede->retain | 0 | 0 | 0 | 0 | 0 |

### F7 — three-way semantic-supersede result

- **4A (HARD)** contradicting pair did NOT clean-promote: 16/24 pass.
- **4B (SOFT/knownGap:F7)** exact target selection: 20/20 matched (recorded, never red).
- **4C (HARD)** where supersede fired, predecessor retired+non-retrievable: 20/20 pass.

### F31 — judge invalid-verdict health

- invalid runs: `94` of `289` total runs (33% invalid).
- items with NO valid run (fully F31-dropped): `1`.

### Verdict instability per stratum

| stratum | items | mean instability |
| --- | ---: | ---: |
| clean | 34 | 0.00 |
| gray | 15 | 0.26 |
| supersede | 23 | 0.02 |
| trap | 47 | 0.19 |

### HARD-gate summary (pre-registered; a red is a real safety signal)

- per-subtype false-promote bound = ceil(0.15 × subtypeCount).
- overall reject leakage bound = ceil(0.15 × rejectCount).

| gate | pass | knownGap | detail |
| --- | --- | --- | --- |
| false-promote-subtype:high_conf_low_ground | FAIL | no | falsePromote=5/6 bound=1 (of 6) |
| false-promote-subtype:hindsight | PASS | no | falsePromote=0/4 bound=1 (of 6) |
| false-promote-subtype:near_dup_novel | PASS | no | falsePromote=0/6 bound=1 (of 6) |
| false-promote-subtype:over_abstraction | PASS | no | falsePromote=0/2 bound=1 (of 6) |
| false-promote-subtype:fabricated_protocol_fact | PASS | no | falsePromote=1/6 bound=1 (of 6) |
| false-promote-subtype:regime_mismatched | PASS | no | falsePromote=1/4 bound=1 (of 6) |
| reject-leakage:overall | FAIL | no | leaked=7/35 bound=6 |
| confidence-override:M079 | FAIL | no | modal=promote (must be reject|retain) |
| confidence-override:M080 | FAIL | no | modal=promote (must be reject|retain) |
| confidence-override:M081 | FAIL | no | modal=promote (must be reject|retain) |
| confidence-override:M082 | FAIL | no | modal=promote (must be reject|retain) |
| confidence-override:M083 | FAIL | no | modal=promote (must be reject|retain) |
| confidence-override:M084 | PASS | no | modal=retain (must be reject|retain) |
| clamp-applied:M001 | PASS | no | clampedTier=observed ceiling=moderate |
| clamp-applied:M002 | PASS | no | clampedTier=observed ceiling=moderate |
| clamp-applied:M003 | PASS | no | clampedTier=observed ceiling=moderate |
| clamp-applied:M004 | PASS | no | clampedTier=observed ceiling=moderate |
| clamp-applied:M006 | FAIL | no | clampedTier=observed ceiling=weak |
| clamp-applied:M007 | PASS | no | clampedTier=observed ceiling=moderate |
| clamp-applied:M008 | PASS | no | clampedTier=observed ceiling=moderate |
| clamp-applied:M009 | PASS | no | clampedTier=observed ceiling=moderate |
| clamp-applied:M010 | PASS | no | clampedTier=observed ceiling=moderate |
| clamp-applied:M011 | PASS | no | clampedTier=observed ceiling=moderate |
| clamp-applied:M012 | PASS | no | clampedTier=observed ceiling=moderate |
| clamp-applied:M014 | PASS | no | clampedTier=observed ceiling=moderate |
| clamp-applied:M016 | PASS | no | clampedTier=observed ceiling=moderate |
| clamp-applied:M017 | PASS | no | clampedTier=observed ceiling=moderate |
| clamp-applied:M018 | PASS | no | clampedTier=observed ceiling=moderate |
| clamp-applied:M019 | PASS | no | clampedTier=observed ceiling=moderate |
| clamp-applied:M020 | PASS | no | clampedTier=observed ceiling=moderate |
| clamp-applied:M021 | PASS | no | clampedTier=inferred ceiling=weak |
| clamp-applied:M023 | PASS | no | clampedTier=observed ceiling=moderate |
| clamp-applied:M024 | PASS | no | clampedTier=inferred ceiling=moderate |
| clamp-applied:M025 | PASS | no | clampedTier=observed ceiling=moderate |
| clamp-applied:M026 | FAIL | no | clampedTier=observed ceiling=weak |
| clamp-applied:M030 | PASS | no | clampedTier=inferred ceiling=moderate |
| clamp-applied:M035 | PASS | no | clampedTier=inferred ceiling=moderate |
| clamp-applied:M036 | PASS | no | clampedTier=inferred ceiling=moderate |
| clamp-applied:M040 | PASS | no | clampedTier=inferred ceiling=moderate |
| clamp-applied:M045 | PASS | no | clampedTier=observed ceiling=moderate |
| clamp-applied:M046 | PASS | no | clampedTier=observed ceiling=moderate |
| clamp-applied:M047 | PASS | no | clampedTier=hypothesis ceiling=moderate |
| clamp-applied:M048 | PASS | no | clampedTier=observed ceiling=moderate |
| clamp-applied:M055 | PASS | no | clampedTier=observed ceiling=moderate |
| clamp-applied:M056 | PASS | no | clampedTier=observed ceiling=moderate |
| clamp-applied:M058 | PASS | no | clampedTier=observed ceiling=moderate |
| clamp-applied:M059 | PASS | no | clampedTier=observed ceiling=moderate |
| clamp-applied:M061 | PASS | no | clampedTier=observed ceiling=moderate |
| clamp-applied:M062 | PASS | no | clampedTier=observed ceiling=moderate |
| clamp-applied:M063 | PASS | no | clampedTier=observed ceiling=moderate |
| clamp-applied:M064 | PASS | no | clampedTier=observed ceiling=moderate |
| clamp-applied:M065 | PASS | no | clampedTier=observed ceiling=moderate |
| clamp-applied:M066 | PASS | no | clampedTier=observed ceiling=moderate |
| clamp-applied:M068 | PASS | no | clampedTier=observed ceiling=moderate |
| clamp-applied:M069 | PASS | no | clampedTier=observed ceiling=moderate |
| clamp-applied:M070 | PASS | no | clampedTier=observed ceiling=moderate |
| clamp-applied:M071 | PASS | no | clampedTier=observed ceiling=moderate |
| clamp-applied:M072 | PASS | no | clampedTier=observed ceiling=moderate |
| clamp-applied:M073 | PASS | no | clampedTier=observed ceiling=moderate |
| clamp-applied:M074 | PASS | no | clampedTier=observed ceiling=moderate |
| clamp-applied:M075 | PASS | no | clampedTier=observed ceiling=moderate |
| clamp-applied:M076 | PASS | no | clampedTier=observed ceiling=moderate |
| clamp-applied:M077 | PASS | no | clampedTier=observed ceiling=moderate |
| clamp-applied:M079 | FAIL | no | clampedTier=observed ceiling=none |
| clamp-applied:M080 | FAIL | no | clampedTier=observed ceiling=none |
| clamp-applied:M081 | FAIL | no | clampedTier=observed ceiling=none |
| clamp-applied:M082 | FAIL | no | clampedTier=observed ceiling=none |
| clamp-applied:M083 | FAIL | no | clampedTier=observed ceiling=none |
| clamp-applied:M091 | FAIL | no | clampedTier=inferred ceiling=none |
| clamp-applied:M092 | FAIL | no | clampedTier=inferred ceiling=none |
| clamp-applied:M093 | FAIL | no | clampedTier=inferred ceiling=none |
| clamp-applied:M094 | FAIL | no | clampedTier=inferred ceiling=none |
| clamp-applied:M095 | FAIL | no | clampedTier=observed ceiling=none |
| clamp-applied:M096 | FAIL | no | clampedTier=observed ceiling=none |
| clamp-applied:M107 | FAIL | no | clampedTier=inferred ceiling=none |
| clamp-applied:M111 | FAIL | no | clampedTier=observed ceiling=none |
| clamp-applied:M133 | FAIL | no | clampedTier=observed ceiling=weak |
| f7-4A-no-clean-promote:M030 | PASS | no | modal=supersede predecessor=1 |
| f7-4B-target:M030 | PASS | yes | claimed=1 seeded=1 |
| f7-4C-predecessor-retired:M030 | PASS | no | predecessor=1 status=superseded retrievable=false |
| f7-4A-no-clean-promote:M040 | PASS | no | modal=supersede predecessor=1 |
| f7-4B-target:M040 | PASS | yes | claimed=1 seeded=1 |
| f7-4C-predecessor-retired:M040 | PASS | no | predecessor=1 status=superseded retrievable=false |
| f7-4A-no-clean-promote:M055 | FAIL | no | modal=promote predecessor=1 |
| f7-4A-no-clean-promote:M056 | PASS | no | modal=supersede predecessor=1 |
| f7-4B-target:M056 | PASS | yes | claimed=1 seeded=1 |
| f7-4C-predecessor-retired:M056 | PASS | no | predecessor=1 status=superseded retrievable=false |
| f7-4A-no-clean-promote:M057 | PASS | no | modal=retain predecessor=1 |
| f7-4A-no-clean-promote:M058 | FAIL | no | modal=promote predecessor=1 |
| f7-4A-no-clean-promote:M059 | FAIL | no | modal=promote predecessor=1 |
| f7-4A-no-clean-promote:M061 | PASS | no | modal=supersede predecessor=1 |
| f7-4B-target:M061 | PASS | yes | claimed=1 seeded=1 |
| f7-4C-predecessor-retired:M061 | PASS | no | predecessor=1 status=superseded retrievable=false |
| f7-4A-no-clean-promote:M062 | FAIL | no | modal=promote predecessor=1 |
| f7-4A-no-clean-promote:M063 | PASS | no | modal=supersede predecessor=1 |
| f7-4B-target:M063 | PASS | yes | claimed=1 seeded=1 |
| f7-4C-predecessor-retired:M063 | PASS | no | predecessor=1 status=superseded retrievable=false |
| f7-4A-no-clean-promote:M064 | FAIL | no | modal=promote predecessor=1 |
| f7-4A-no-clean-promote:M065 | PASS | no | modal=supersede predecessor=1 |
| f7-4B-target:M065 | PASS | yes | claimed=1 seeded=1 |
| f7-4C-predecessor-retired:M065 | PASS | no | predecessor=1 status=superseded retrievable=false |
| f7-4A-no-clean-promote:M066 | PASS | no | modal=supersede predecessor=1 |
| f7-4B-target:M066 | PASS | yes | claimed=1 seeded=1 |
| f7-4C-predecessor-retired:M066 | PASS | no | predecessor=1 status=superseded retrievable=false |
| f7-4A-no-clean-promote:M068 | PASS | no | modal=supersede predecessor=1 |
| f7-4B-target:M068 | PASS | yes | claimed=1 seeded=1 |
| f7-4C-predecessor-retired:M068 | PASS | no | predecessor=1 status=superseded retrievable=false |
| f7-4A-no-clean-promote:M069 | FAIL | no | modal=promote predecessor=1 |
| f7-4A-no-clean-promote:M070 | PASS | no | modal=supersede predecessor=1 |
| f7-4B-target:M070 | PASS | yes | claimed=1 seeded=1 |
| f7-4C-predecessor-retired:M070 | PASS | no | predecessor=1 status=superseded retrievable=false |
| f7-4A-no-clean-promote:M071 | PASS | no | modal=supersede predecessor=1 |
| f7-4B-target:M071 | PASS | yes | claimed=1 seeded=1 |
| f7-4C-predecessor-retired:M071 | PASS | no | predecessor=1 status=superseded retrievable=false |
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
| f7-4A-no-clean-promote:M076 | PASS | no | modal=supersede predecessor=1 |
| f7-4B-target:M076 | PASS | yes | claimed=1 seeded=1 |
| f7-4C-predecessor-retired:M076 | PASS | no | predecessor=1 status=superseded retrievable=false |
| f7-4A-no-clean-promote:M077 | FAIL | no | modal=promote predecessor=1 |
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
