# S6 — Maturity FSM + activation decay + reinforcement (+ regime worker) — execution plan

Data: 2026-06-09
Status: `[~] PLAN — S6a (rdzeń) przed bramką Codexa (harness-memory-s6); S6b (regime) zaprojektowany, impl po S6a`
Stage w `memory-system-v2.md` §9: **S6** (po S0/S1a-d/S2/S3/S4/S5 DONE).
Sesja Codexa: `harness-memory-s6`.

Źródła: genesis `memory-system.md` (§282 maturity prose, §715-726 decay/reactivation, §814-827 S6 tasks, §950-976 closed decisions), v2 §9 S6 + OD-2, recon (`woguh61ow`: wiring + rerank + trigger + DeepResearch decay-model), decyzje właściciela (niżej).

---

## 0. PODZIAŁ (właściciel: S6 duży → dwa recenzowalne etapy)

- **S6a (TEN plan, implementacja teraz):** rdzeń replay-stabilny — maturity FSM + reinforcement (recurrence) + **decay czasowy** + **activation w reranku** + **audyt `knowledge_maturity_events`** (debug „dlaczego"). `regime_aware`/`outcome_aware` tymczasowo = decay czasowy (gated).
- **S6b (zaprojektowany w §12, impl po S6a GREEN):** osobny **dzienny regime worker** (Tavily/Twitter conditional) + `regime_snapshots` + regime-aware decay/reaktywacja. Jedyny nie-deterministyczny + poisoning-wrażliwy kawałek, izolowany.

---

## 1. DECYZJE ZAMKNIĘTE (właściciel)

- **D-MATURE (recurrence, nie retrieval).** Lekcja dojrzewa probationary→established gdy **2. realne potwierdzenie** (recurring/near-dup kandydat przy konsolidacji potwierdza istniejący wpis). **Samo PRZYWOŁANIE (recall) NIE wzmacnia** (recall ≠ prawda — bezpieczniej dla tradingu; genesis §950-976 „2. potwierdzenie, nie automat").
- **D-DECAY (influence erosion, NIGDY kasowanie).** `activation_strength` maleje jako f(czas od `last_reinforced_at`); reuse istniejącej wykładniczej pół-życia z `ranking.ts` (`0.5^(ageDays/half_life)` ≡ `e^(-λt)`). **Podłoga activation > 0** (np. 0.03 jak „silent" w paperze) — nigdy nie kasujemy wiersza (genesis §956, twardy inwariant). Decay = niższy wpływ.
- **D-CONST (tune, nie zamrażać).** Stałe (half-life, podłoga, próg dojrzewania) = **nazwane consty w JEDNYM module** z komentarzem „tune empirically, do not freeze" (genesis §1a + sam paper §8/§9.1 traktują λ/t_half jako strojone, nie kanon). Jednostka = **DNI** (jak istniejący reranker; nie mieszać z godzinami).
- **D-AUDIT (debug „dlaczego" — wymóg właściciela).** Append-only tabela `knowledge_maturity_events` rejestruje KAŻDĄ tranzycję maturity/activation z powodem + triggerem. Nie reuse `memory_decisions` (kotwiczona do kandydatów, nie do wpisów wiedzy).
- **D-RERANK (activation w score, inwariant zachowany).** `activation_strength` wchodzi do `scoreKnowledge` jako mnożnik PO boostach, ale **inwariant S3 musi trzymać** (confirmed knowledge > kandydat przy równym similarity). Wagi przeliczone (§7) — to nie jest naiwne `×activation`.
- **D-REGIME (S6b, osobny worker).** Reżim z Tavily/Twitter (jeśli konta podłączone), **raz dziennie**, osobny worker → `regime_snapshots`; manager czyta najnowszy. Advisory-only. Szczegóły §12.
- **D-SCOPE-GATE.** `regime_aware`/`outcome_aware` w S6a zachowują się jak **decay czasowy** (gated) — pełne dopiero z S6b (regime) i S7 (outcome). `none` = no-op (pinned/legacy, activation zamrożony 1.0).

---

## 2. ZAKRES S6a

| W S6a | DEFER |
|---|---|
| maturity FSM: probationary→established→reinforced→decayed (transycje) | regime snapshot worker (S6b) |
| reinforcement przy recurrence (2. potwierdzenie) | regime-aware decay/reaktywacja (S6b) |
| decay czasowy `activation_strength` (exp half-life, podłoga >0) | outcome-aware decay (S7 — outcome reconcile) |
| `activation_strength` + maturity w reranku (scoreKnowledge) | retrieval-based reinforcement (świadomie OUT — recall≠prawda) |
| audyt `knowledge_maturity_events` | |
| decay-sweep w executor maintenance cron-tick | |

---

## 3. SCHEMAT — JEDNA NOWA TABELA (EDIT-IN-PLACE w `001_initial.sql`)

S6a NIE jest code-only (audyt wymaga tabeli). Reuse istniejących kolumn `knowledge_entries` (activation_strength/maturity_state/decay_policy/last_reinforced_at/next_review_at — wszystkie istnieją, S4 ustawia probationary+0.5).

**Nowa tabela `knowledge_maturity_events`** (append-only audyt; dołożona do `001` po `knowledge_entries`, wzorzec `memory_decisions`):
```
id              BIGSERIAL PK
entry_id        INTEGER          -- ANCHOR (immutable, no FK — przeżywa delete; wzorzec memory_decisions)
event           TEXT CHECK IN ('matured','reinforced','decayed','reactivated')  -- closed enum + lockstep
from_state      TEXT CHECK maturity enum   -- probationary|established|reinforced|decayed
to_state        TEXT CHECK maturity enum
activation_before REAL CHECK 0..1
activation_after  REAL CHECK 0..1
reason_code     TEXT CHECK IN ('recurrence_confirmation','time_decay','regime_decay','outcome_change')  -- bounded
trigger_refs    JSONB DEFAULT '{}'  -- {candidateId?, executionId?, regimeSnapshotId?} — strukturalne, NIE raw
decided_by      TEXT CHECK IN ('system','manager')
rationale       TEXT             -- krótkie strukturalne „czemu", BEZ raw sekretów/kwot (redakcja jak memLog)
created_at      TIMESTAMPTZ DEFAULT NOW()
```
Enum `event`/`reason_code`/`decided_by` = `as const` + z.enum + named SQL CHECK + lockstep test (wzorzec memory-decision-enums). Mirror `vex-app/resources/migrations` regen.

**Gate-point:** czy `entry_id` ma być FK (CASCADE) czy immutable anchor (no FK, jak memory_decisions). Plan: **immutable anchor** (audyt przeżywa ewentualne usunięcie wpisu; spójne z doktryną append-only audit). Potwierdzić w bramce.

---

## 4. MODUŁ I PLIKI (FIX-3: internal funcs)

**Creates:**
- `memory/manager/maturity.ts` — `reinforceEntry(entryId, trigger, tx)` (recurrence: activation↑, maturity advance, last_reinforced_at=NOW, audit), `decayEntry(entry, now, tx)` (time-decay activation, maturity→decayed gdy poniżej progu, audit). Czyste decyzje + IO injectable.
- `memory/manager/maturity-policy.ts` — czyste stałe + funkcje: `decayedActivation(activation, daysSinceReinforced, policy)` (exp half-life, podłoga), `nextMaturityState(current, activation, confirmations)`, progi. WSZYSTKIE stałe „tune, do not freeze".
- `memory/schema/knowledge-maturity-event.ts` — Zod + enumy (event/reason_code/decided_by).
- `db/repos/knowledge-maturity-events/{crud,types,index}.ts` — `recordMaturityEvent(input, tx)` append-only.
- `engine/memory-manager/decay-sweep.ts` (lub w executor) — periodyczny sweep: lista wpisów z `decay_policy<>'none'` + `last_reinforced_at`/`first_promoted_at` starszy niż próg → `decayEntry`. Batch, idempotentny.

**Edits:**
- `db/repos/knowledge/recall.ts` — `recallLongMemoryTopK` SELECT **+`activation_strength`**.
- `db/repos/knowledge/types.ts` — `LongMemoryRecallCandidate` +`activationStrength`; mapper.
- `memory/long-memory-retrieval-policy.ts` — `scoreKnowledge` przyjmuje `activationStrength`, mnożnik PO boostach z zachowaniem inwariantu (§7).
- `tools/internal/long-memory/search.ts` — przekazuje activationStrength do scoreKnowledge.
- `memory/manager/consolidate.ts` — **reinforcement seam**: gdy deterministyczny etap wykryje near-dup/recurrence istniejącego ACTIVE wpisu (D4/D5/D6 już liczą cosine + exact-dup), zamiast samego `reject(duplicate)` → `reinforceEntry` (2. potwierdzenie). **Gate-point:** dokładny warunek (exact-dup vs near-dup+recurrence) i czy reinforcement zamiast czy obok reject.
- `engine/memory-manager/executor.ts` — maintenance cron-tick wywołuje decay-sweep (obok consolidate enqueue).
- `engine/memory-manager/policy.ts` — +stałe decay/maturity (albo w maturity-policy.ts).
- `memory/observability/logger.ts` — +klucze (maturityEvent, fromState, toState, activationBefore/After — number; reasonCode — enum-string).

**NIE dotykamy:** registry/tool-map (FIX-3), regime (S6b), reconcile branch (S7), prompty.

---

## 5. MATURITY FSM (transycje)

```
probationary --(2. potwierdzenie/recurrence)--> established --(kolejne potwierdzenie)--> reinforced
     |                                               |                                       |
     +----------------(time decay poniżej progu)-----+---------------------------------------+--> decayed
decayed --(nowe potwierdzenie/reaktywacja)--> established   [reaktywacja: S6b regime lub recurrence]
```
- Start: probationary, activation 0.5 (S4).
- Reinforcement (recurrence): activation += REINFORCE_STEP (cap 1.0), maturity advance o 1 poziom, last_reinforced_at=NOW, audit `reinforced`/`matured`.
- **Reaktywacja decayed (R1#7 — S6a, NIE czeka na S6b):** `reinforceEntry` na wpisie `maturity='decayed'` → **decayed→established** (activation bump, last_reinforced_at=NOW), audit `reactivated` reason `recurrence_confirmation`. Czyli nowe realne potwierdzenie WSKRZESZA osłabioną lekcję — decayed NIGDY nie jest martwym końcem (recurrence-driven; regime-driven reaktywacja = S6b).
- Decay (sweep): activation = `decayedActivation(...)`; jeśli < DECAY_FLOOR_TO_DECAYED → maturity='decayed' (ale activation podłoga >0, wpis zostaje), audit `decayed`.
- `none` policy: no-op. legacy (activation 1.0, established) bez zmian.

---

## 6. DECAY (czasowy; reuse exp half-life)

`decayedActivation(activation, daysSinceReinforced, policy)`:
- `policy==='none'` → activation (no-op).
- inaczej → `max(DECAY_FLOOR, activation * 0.5^(daysSinceReinforced / ACTIVATION_HALF_LIFE_DAYS))`.
- `ACTIVATION_HALF_LIFE_DAYS` startowo np. 30 (paper t_half≈29d) — **„tune, do not freeze"**. `DECAY_FLOOR` np. 0.03 (paper „silent").
- `regime_aware`/`outcome_aware` w S6a → traktowane jak `time` (gated; pełne w S6b/S7).
- `daysSinceReinforced` = (now − COALESCE(last_reinforced_at, first_promoted_at)) w dniach.
Decay-sweep: batch po wpisach z `decay_policy<>'none'` AND `status='active'`, idempotentny (ponowny sweep tego samego dnia ≈ no-op bo Δt mały). Sweep zapisuje activation tylko gdy zmiana znacząca (próg) — unika audit-spamu.

---

## 7. RERANK — activation w score BEZ łamania inwariantu S3

Problem (recon): naiwne `(sim+boosts)×tier×activation` z activation 0.5 łamie „confirmed > candidate".
Rozwiązanie (ZABLOKOWANE — bramka R1#1): activation jako **łagodny ograniczony mnożnik**, NIE liniowy:
- `scoreKnowledge = rerankScore × tierWeight × activationFactor`, gdzie `activationFactor = ACTIVATION_MIN_FACTOR + (1-ACTIVATION_MIN_FACTOR)×activation` (activation∈[0,1] → [MIN_FACTOR, 1.0]).
- **Bound dowodowy (Codex):** najgorszy przypadek = inferred/hypothesis (tierWeight 0.7), activation na podłodze. Inwariant `(sim+boosts)×0.7×activationFactor ≥ sim×0.6`; (sim+boosts)≥sim ⇒ wystarczy `0.7×activationFactor_min ≥ 0.6` ⇒ `activationFactor_min ≥ 0.857143`. **`ACTIVATION_MIN_FACTOR = 0.88`** (margines): nawet activation=0 → 0.7×0.88=0.616 ≥ 0.6. ✓
- **all-tier** (mnożnik na każdym tierze — bound trzyma dla najgorszego 0.7; observed/user_confirmed 1.0 tym bardziej).
- **Property-test OBOWIĄZKOWY:** dla wszystkich (tierWeight∈{0.7,1.0}) × (activation∈{0, DECAY_FLOOR, 0.5, 1.0}) i reprezentatywnych sim: `(sim+boosts)×tierWeight×activationFactor ≥ sim×CANDIDATE_DUAL_TRACE_WEIGHT(0.6)`. Runtime-assert MIN_FACTOR ≥ 0.857 (jak istniejący invariant-assert w retrieval-policy).
- activation = **retrieval rank only** (advisory; OD-1) — nigdy sizing/approval.

---

## 8. REINFORCEMENT SEAM (consolidate)

W `consolidateCandidate`: deterministyczny etap już liczy `exactDuplicate` (D4) + near-dup cosine (D5) + recurrenceCount (D7). Gdy kandydat = potwierdzenie istniejącego ACTIVE wpisu (exact-dup LUB near-dup wysokiego podobieństwa do konkretnego entry_id) → zamiast `reject(duplicate)` wywołaj `reinforceEntry(existingEntryId, {candidateId}, tx)` w atomowej transakcji + decision `retain`/nowy reason. **Gate-point:** D4 zwraca tylko bool (findByContentHash) — potrzeba entry_id do reinforce → rozszerzyć o `findActiveByContentHash`→entry, lub użyć near-dup match knowledgeId z D5. Doprecyzować w bramce.

---

## 9. OBSERWOWALNOŚĆ + TESTY

memLog +klucze (maturityEvent/fromState/toState enum, activationBefore/After/daysSinceReinforced num). Eventy: `maturity.reinforced`, `maturity.decayed`, `decay_sweep.completed {count}`. Zero raw kwot.
Testy non-DB: maturity-policy (decayedActivation exp + podłoga + none no-op; nextMaturityState); **rerank inwariant property-test** (wszystkie tier×activation); knowledge-maturity-event Zod/lockstep; reinforce/decay decyzje (pure).
Integracja (realny pgvector): reinforce na recurrence (activation↑, maturity advance, audit row); decay-sweep obniża activation bez kasowania (podłoga); decayed maturity; rerank z activation (established > probationary > candidate); audit append-only; legacy none = no-op.

---

## 10. DONE-WHEN (S6a)

- tsc clean; non-DB zielone (w tym rerank inwariant property-test); integracja na realnym pgvector zielona.
- probationary→established przy 2. potwierdzeniu (recurrence); activation rośnie przy reinforce, maleje przy decay (NIGDY kasowanie, podłoga >0).
- activation+maturity wpływają na rerank, inwariant „confirmed > candidate" zachowany.
- każda tranzycja audytowana w `knowledge_maturity_events` z powodem (debug „dlaczego").
- `regime_aware`/`outcome_aware` = decay czasowy (gated); `none` no-op; advisory-only zachowane.
- mirror migracji zsynchronizowany.

---

## 11. GATE-POINTS (S6a)

1. `knowledge_maturity_events.entry_id` FK-CASCADE vs immutable anchor → plan: anchor (append-only audyt przeżywa delete).
2. RERANK MIN_FACTOR — dobrać przez property-test by inwariant trzymał (0.7×factor ≥ 0.6 → factor ≥ ~0.857; activation-floor w score może wymagać innego mapowania). KLUCZOWE.
3. Reinforcement seam: entry_id z D4 (findActiveByContentHash) vs D5 near-dup knowledgeId; reinforce zamiast/obok reject.
4. Decay-sweep cadence + próg „znaczącej zmiany" (anti audit-spam).
5. ACTIVATION_HALF_LIFE_DAYS / DECAY_FLOOR / REINFORCE_STEP wartości startowe (tune, nie zamrażać).
6. ~~hot-context przepuszcza decayed~~ **ZABLOKOWANE (R1#6):** hot-context (`HOT_CONTEXT_SOURCE_SQL`) wyklucza `maturity_state NOT IN ('probationary','decayed')` — decayed NIE wraca do always-on prompt (reaktywacja przez recurrence przywraca do established → znów hot-context-eligible). +test.

---

## 12. S6b — REGIME WORKER (zaprojektowane; impl po S6a GREEN)

**Właściciel:** osobny worker, **raz dziennie**, odpala się **tylko gdy podłączone konta** (Tavily/Twitter), sprawdza obecny reżim → manager używa.
- Schema: `regime_snapshots` (id, regime_label CHECK closed enum np. bull|bear|chop|high_vol|low_vol, confidence REAL, source TEXT (tavily|twitter|heuristic|hybrid), rationale, created_at).
- Worker `engine/regime/regime-worker.ts`: daily scheduler; gate na obecność kluczy (Tavily/Twitter w secret-vault/env); reuse `tools/internal/web.ts` (Tavily) + `tools/internal/twitter-account.ts` (handlery — zweryfikować callable z background); LLM interpretuje wyniki → regime_label+confidence; zapis snapshot. Graceful: brak kont → brak snapshotu.
- Manager decay: `decayedActivation` policy `regime_aware` czyta najnowszy `regime_snapshots`; jeśli regime_tags lekcji NIE pasują do obecnego → szybszy decay; pasują → wolniejszy/reaktywacja (activation↑ z audytem `reactivated`, reason `regime_decay`/reaktywacja). Brak snapshotu → degrade do time-decay.
- **Replay/poisoning (świadome):** snapshot NIE jest replay-stabilny (zależy od web w danej chwili) → snapshotujemy label+source+czas (audytowalne). Tavily/Twitter niezaufane → reżim TYLKO advisory (rank), nigdy egzekucja; rozważyć wymóg confidence-threshold/korroboracji.
- Osobna bramka `harness-memory-s6b` + osobny commit.

---

## 13. ŚLAD BRAMEK

- **Plan-gate S6a R1 (harness-memory-s6, thread `019ead12`): BLOCKED-misframe.** Pkt 2/3/4/5 = prescribed Creates/Edits (potwierdzone poprawne, nie defekty). 3 realne refinementy WCIELONE: #1 RERANK `ACTIVATION_MIN_FACTOR=0.88` (bound ≥0.857 dowodowy) + property-test (§7); #6 hot-context wyklucza też `decayed` (§11.6); #7 `reinforceEntry` reaktywuje `decayed`→established w S6a (§5). Re-submit R2.
- **Plan-gate S6a R2 (thread `019ead12`): GREEN LIGHT — 0 defektów projektowych.** Codex: RERANK MIN_FACTOR=0.88 dowodowo poprawny (0.7×0.88=0.616≥0.6), FSM+reaktywacja decayed→established spójne, scope OK (regime=S6b/outcome=S7), hot-context wyklucza probationary+decayed. Start impl autoryzowany.
- **Impl-gate S6a (Phase 6, thread `019ead12`): R1 BLOCKED (decay floor-repair) → R2 GREEN LIGHT.** R1: `decayEntry` skip liczył delta przed flooringiem → wiersz poniżej podłogi nie naprawiany. Fix: floor up-front, skip tylko negligible-lowering, floor-repair (lowered<0) persistuje (anti-spam zachowany — odstępstwo od dokładnego wording Codexa, potwierdzone equivalent-or-better). 0 innych defektów.
- **Weryfikacja niezależna (parent): PASS, złapała 2 bugi.** tsc clean; non-DB 117+/38 (rerank invariant property-test ✓, enum lockstep ✓, maturity/decay ✓); **integracja na REALNYM pgvector 21/21** (S4 10 + S5 4 + S6a 7; zero regresji). Bugi złapane: (1) test-fixture invalid-variant UUID vs Zod4 `z.uuid()` RFC-strict → fix testu (schemat poprawny); (2) decay floor-repair (Codex R1) → fix kodu. Delete-safety: zero DELETE na knowledge_entries.
- **S6a: DONE + na main.** S6b: _osobny etap po compacie._
