# S7 — Outcome reconciliation + ledger wakes — execution plan

Spec wykonawczy etapu S7. Zakres: szew `enqueueLedgerWake` (ledger→memory),
gałąź `processReconcileJob` w memory-manager, deterministyczna mapa konsekwencji
+ LLM-re-sąd przy odwróceniu sygnału, bump `outcome_version`. Po S6 (na main
`185149c`). Substrat S1c/S5 już istnieje: `memory_jobs.reconcile_*` + partial
unique `uniq_mj_reconcile`, `enqueueReconcileJob` (crud.ts:93-121),
`memory_decisions` z dyskryminantą `reconcile` (XOR CHECKi), executor stub
(`executor.ts:131-135`), `MATURITY_REASON_CODES.outcome_change`,
`knowledge_entries.outcome_version=0` (nikt nie bumpuje).

---

## 0. FORKI WŁAŚCICIELA (rozstrzygnięte 2026-06-09, AskUserQuestion)

- **F1 — mapa deterministyczna + LLM przy odwróceniu:** zwykłe zmiany załatwia
  matematyka (zysk→wzmocnienie, strata→mocne wygaszenie, doszły dane→bump+audyt);
  LLM-sędzia TYLKO gdy sygnał się ODWRACA (zysk↔strata) — dostaje deltę
  starych/nowych faktów. Każda zmiana: `outcome_version+1` + audyt.
- **F2 — re-sąd może awansować tier:** gdy outcome zamyka się z pełnymi danymi
  (sufit dowodowy rośnie do `strong`), sędzia może podnieść `source_tier`
  (np. inferred→observed). Wyłącznie po faktach; `clampSourceTier` z S4 dalej
  pilnuje sufitu.
- **F3 — wallet_intents POZA S7:** świadome odstępstwo od litery master-planu —
  resolver outcome czyta wyłącznie proj_* (recon: wake od intencji = martwe
  sprzężenie bez czego przeliczyć). Realne dane i tak lądują w proj_* przez sync.

---

## 1. DECYZJE ZAMKNIĘTE (engineering, z recon)

- **D-SEAM — JEDEN szew, strukturalnie odporny na replay.** `enqueueLedgerWake`
  woła się WYŁĄCZNIE na końcu `populateCaptureItems`
  (`tools/protocols/capture-pipeline.ts:61-92`) — pokrywa trady agenta ORAZ
  settlement sync (`prediction-settlement-sync.ts` → `recordSyntheticCapture` →
  `populateCaptureItems`; zweryfikowane `synthetic-capture.ts:161`). Replay
  (`replayActivityFromCapture`) NIE przechodzi przez ten punkt → burza wake'ów
  przy replayu niemożliwa BEZ żadnej flagi. Balance-sync pisze proj_balances —
  resolver ich nie czyta → bez wake.
- **D-MAP — mapowanie wake→lekcje przez kotwice FIX-1.** Wake niesie klucze
  z capture-itemów: `{executionId, instrumentKey?, positionKey?}` (settlement
  zamykający pozycję ma NOWY executionId — lekcję znajduje positionKey/
  instrumentKey, dokładnie po to FIX-1 trzyma klucze semantyczne). Zapytanie:
  `memory_candidates` `status='promoted'` AND `evidence_refs` zawiera kotwicę
  zgodną po executionId LUB positionKey LUB instrumentKey → `promoted_knowledge_id`
  → aktywne wpisy → `enqueueReconcileJob(entryId, entry.outcome_version)`.
  Fałszywie-pozytywny wake jest tani (reconcile = no-op gdy outcome bez zmian).
  **Nowy GIN index** (EDIT-IN-PLACE 001):
  `CREATE INDEX idx_mc_evidence_refs ON memory_candidates USING GIN (evidence_refs jsonb_path_ops);`
- **D-KEY/D-REARM — klucz idempotencji z re-armem + flaga wake_pending
  (krytyka L4: okno zgubionego wake'a).** Job keyed `(entry_id, AKTUALNY
  outcome_version)`; worker waliduje wersję. **Pułapka 1:** completed job
  `(entry,v)` w unique index blokowałby KAŻDY przyszły wake przy niezmienionej
  wersji. **Pułapka 2 (L4):** wake przychodzący PODCZAS `running` byłby
  zgubiony — in-flight resolve czytał ledger sprzed jego zapisu, a po
  `completed` nikt nie wie, że coś przyszło. Fix łączny:
  - NOWA kolumna `memory_jobs.wake_pending BOOLEAN NOT NULL DEFAULT false`
    (EDIT-IN-PLACE 001; jedyny dodatek kolumnowy S7).
  - `enqueueReconcileJob` `ON CONFLICT`: `completed` → RE-ARM
    (`status='pending', attempt_count=0, next_attempt_at=NOW(),
    wake_pending=false`); `running` → `SET wake_pending=true`;
    `pending`/`failed` → no-op (i tak pobiegnie i przeczyta świeży ledger);
    `permanently_failed` → no-op (jawny `resetReconcileJob`).
  - **Konsumpcja flagi przy zakończeniu:** `markCompleted` (lub wariant dla
    reconcile) — gdy `wake_pending=true` → zamiast `completed` ustawia
    `pending, attempt_count=0, wake_pending=false` (jeszcze jeden przebieg
    z post-wake'owym stanem ledgera).
  - **Stale-version domknięcie:** gdy re-armowany job `(entry, v_stare)` trafia
    na `entry.outcome_version > v_stare` → przed `completed` no-op robi
    idempotentne `enqueueReconcileJob(entry, currentVersion)` — informacja
    nigdy nie ginie, pętla zawsze dogania ledger.
- **D-ORDER (wzór consolidate):** resolve + (ewentualny) sąd PRZED atomową tx;
  tx re-waliduje wersję optymistycznie (`UPDATE ... WHERE outcome_version=$v`).
- **D-OUTCOME-AWARE:** policy `outcome_aware` = decay czasowy MIĘDZY
  reconcile'ami; outcome to ZDARZENIE aplikowane przy reconcile (mapa F1), nie
  ciągła modulacja. Aktualizacja komentarza w maturity-policy (gate S7 znika).
- **Nowy outcome żyje na kandydacie** (doktryna S5: candidate = żywy rekord
  outcome). `updateCandidateOutcome` wymaga `status='pending'` → NOWY setter
  `updateReconciledCandidateOutcome` (guard `status='promoted' AND
  promoted_knowledge_id=$entry`); decyzja `reconcile` niesie wersję+evidence_refs
  (audyt), maturity-event niesie przyczynę.
- **Advisory-only (OD-1) bez zmian:** reconcile dotyka activation/maturity/
  status/tier — nigdy sizing/approval/wallet. FIX-3: wszystko internal.

---

## 2. SCHEMAT (EDIT-IN-PLACE `001_initial.sql`, minimalnie)

- `idx_mc_evidence_refs` GIN (jsonb_path_ops) na `memory_candidates.evidence_refs` (D-MAP).
- `memory_jobs.wake_pending BOOLEAN NOT NULL DEFAULT false` (D-REARM, pułapka 2).
- Hardening przy okazji (S7 pisze `invalidated`): nazwany CHECK `ke_status_valid`
  `(status IN ('active','superseded','invalidated','archived'))` na
  knowledge_entries — luka legacy wykryta przez krytykę (inne tabele mają CHECKi
  statusów, ta nie); wartości z istniejącej dokumentacji kolumny.
- Poza tym ŻADNYCH nowych tabel/kolumn — substrat S1c wystarcza
  (`knowledge_entries.source` ISTNIEJE — migracja `018_knowledge_source.sql:20`
  z inline CHECK; krytyka L1 myliła się patrząc tylko na 001). Mirror regen +
  dev reset.

---

## 3. SZEW — `memory/ledger-wake.ts` (NOWY, cienki)

`enqueueLedgerWake(keys: ReadonlyArray<{executionId: number; instrumentKey?: string; positionKey?: string}>): Promise<{matchedEntries: number; enqueued: number}>`
- Dedupe kluczy wejściowych; jedno zapytanie: `status='promoted' AND
  promoted_knowledge_id IS NOT NULL AND (evidence_refs @> '[{"executionId":X}]'
  OR @> '[{"positionKey":"Y"}]' OR @> '[{"instrumentKey":"Z"}]')` — klucze
  kotwic camelCase wg `evidenceAnchorSchema` (memory-candidate.ts:67-74);
  planner łączy OR-y @> na jednym GIN przez BitmapOr (EXPLAIN-sanity w
  integracji); per trafiony AKTYWNY wpis
  `enqueueReconcileJob(entryId, currentVersion)`.
- Best-effort: błąd NIE wywraca sync (try/catch w caller; memLog warn) — ledger
  jest źródłem prawdy, pamięć dogania.
- Call-site: koniec `populateCaptureItems` — klucze zebrane z itemów
  (executionId + instrumentKey/positionKey z tradeCapture; `activity-populator.ts:111`
  pokazuje ekstrakcję). JEDYNY punkt (D-SEAM).

---

## 4. WORKER — `engine/memory-manager/reconcile.ts` (NOWY) + executor branch

`processReconcileJob(job, workerId, deps)` zastępuje stub (`executor.ts:131-135`):
1. Load entry (aktywny? nie → complete no-op `entry_inactive`) + kandydat
   (`findCandidateByPromotedKnowledgeId` — NOWE query w memory-candidates/crud).
   Brak kandydata → complete no-op (lekcja bez żywego rekordu outcome — np.
   import). Walidacja `entry.outcome_version === job.reconcileOutcomeVersion`
   (stale → complete no-op `stale_version`).
2. `resolveOutcome(candidate, deps)` (REUSE S5; deps injectable) → NEW summary
   (null → complete no-op `unresolvable`).
3. `outcomeDelta(oldOutcome, newOutcome)` — pure (NOWY
   `memory/manager/reconcile-policy.ts`):
   - porównanie semantyczne: `status`, `lessonSignal`, `evidenceQuality`,
     `pnlSource`, `needsReconciliation` → `unchanged | changed`.
   - `consequenceFor(old, new, entry)` — **REGUŁY UPORZĄDKOWANE (krytyka L2/L3:
     wyczerpujące przez konstrukcję, pierwsza pasująca wygrywa; macierz 4×4
     sygnałów domknięta defaultem):**
     1. **FLIP → sąd:** (`old=positive ∧ new=negative`) ∨ (`old=negative ∧
        new=positive`), nowy status terminalny (closed/settled/failed) → LLM.
     2. **REINFORCE:** `new=positive ∧ status∈{closed,settled}` (stary ≠ negative
        — reguła 1 już zjadła flip; mixed→positive i neutral→positive TU,
        positive→positive przy open→closed = potwierdzenie) → FSM jak recurrence:
        `+REINFORCE_STEP` cap 1.0, awans tieru maturity, decayed→established
        reaktywacja, bump last_reinforced_at — event wg `reinforceEventFor`,
        reason `outcome_change`, trigger_refs `{executionId}`.
     3. **QUENCH:** `new=negative ∧ status∈{closed,settled,failed}` (stary ≠
        positive; mixed→negative i neutral→negative TU — częściowo-błędna/
        bezsygnałowa lekcja rozstrzygnięta stratą gaśnie, intencja F1) →
        `activation = max(DECAY_FLOOR, min(current, OUTCOME_QUENCH_ACTIVATION))`,
        `OUTCOME_QUENCH_ACTIVATION = 0.15` (< DECAY_TO_DECAYED_THRESHOLD 0.2 →
        zwykle tier `decayed`; tune do not freeze), bump `last_decayed_at`
        (kotwica przyrostowa S6b), event `decayed`, reason `outcome_change`.
     4. **BOOKKEEP (default):** wszystko inne — `new∈{mixed,neutral}`,
        statusy nieterminalne, `invalidated` outcome, quality-up bez zmiany
        sygnału, needsReconciliation cleared → tylko bump+audyt+decyzja
        (zero zmian aktywacji; konserwatywnie).
   - **F2 tier-raise trigger (ORTOGONALNY do mapy):**
     `deriveEvidenceStrengthCeiling` (ISTNIEJE — `evidence-deref.ts:120`, S5)
     dla NEW = `strong` AND `entry.source ∈ {hypothesis, inferred}` → sąd
     konsultowany o tier (przy kind deterministycznym sąd orzeka TYLKO tier;
     akcja kind wykonuje się deterministycznie). Observed/user_confirmed nie
     zyskują → bez LLM.
4. **Sąd reconcile** (tylko `flip_judge`/tier-raise): NOWY
   `memory/manager/reconcile-judge.ts` (wzór judge.ts: provider injectable,
   timeout, JSON, Zod strict `.strict()` — akcja spoza enum = throw → retry).
   Kontekst: lekcja (title/summary/kind/tier) + OLD outcome + NEW outcome
   (bez kwot — MemoryOutcomeSummary już ich nie ma).
   Verdict Zod: `{action: 'invalidate'|'quench'|'retain', sourceTier?: knowledgeSource,
   rationale: max 500}` — sędzia NIE pisze treści (brak kandydata → brak
   supersede z nową treścią; invalidate = bi-temporalna uczciwość, zgodne z
   FIX-4: jedyna droga treści do knowledge = promote).
   **Mapowanie verdict→wykonanie (krytyka L4: akcje sądu NIE przechodzą przez
   kind — aplikowane wprost):** `invalidate` → status+valid_until;
   `quench` → jak reguła 3; `retain` → jak bookkeep; `sourceTier` (opcjonalny
   przy KAŻDEJ akcji) → `UPDATE source` tylko w górę,
   `clampSourceTier(verdict.sourceTier, ceiling)` (REUSE S4). Błąd LLM → throw
   → retry joba (fail-closed).
5. **Atomowa tx** (`withTransaction`, wzór applyDecisionAtomically):
   - `SELECT ... FOR UPDATE` na entry NAJPIERW; re-check `outcome_version=$v`
     (race → rollback, complete no-op `stale_version` + idempotentne
     re-enqueue na currentVersion — D-REARM domknięcie).
   - **Lock-order (analiza L4, bez cyklu):** reconcile: entry → promoted-candidate;
     consolidate: job_items/jobs → pending-candidate → entry. Zbiory kandydatów
     ROZŁĄCZNE (pending vs promoted), reconcile nie dotyka items/jobs
     consolidate'a → brak krawędzi zwrotnej → deadlock niemożliwy. Decay-sweep
     nie trzyma locków (optimistic guarded UPDATE) → najwyżej spurious
     precondition-miss (akceptowane, jak w S6a).
   - Konsekwencja: `applyMaturityTransition` + `recordMaturityEvent`
     (reason `outcome_change`, trigger_refs `{executionId}`) wg reguły/akcji;
     `invalidate` → bezpośredni `UPDATE status='invalidated',
     valid_until=NOW()` W TX (istniejący `updateStatus` NIE ustawia
     valid_until — crud.ts:385-405; recall i tak filtruje `status='active'`,
     valid_until = bi-temporalny audyt); tier-raise → `UPDATE source`
     (tylko w górę, clamped).
   - `updateReconciledCandidateOutcome(candidateId, newSummary{outcomeVersion: v+1, outcomeLastChangedAt})`.
   - `UPDATE knowledge_entries SET outcome_version = $v+1 WHERE id AND outcome_version=$v`.
   - `recordDecision` typu `reconcile` (reconcile_entry_id, outcome_version=v+1,
     evidence_refs snapshot, decision_hash — post-f2fb940 koduje reconcile przez
     anchorKind='reconcile'; decided_by `manager` gdy sąd, `system` gdy mapa).
   - `unchanged` → BEZ tx, complete no-op. **Świadomy wybór audytowy (L4):**
     unchanged zostawia TYLKO memLog + completed job, ZERO decision-row
     (decyzje = realne zmiany; wake przy tej samej wersji ponownie uzbroi job
     przez D-REARM, gdy ledger znów drgnie).
6. **BEZ memory_job_items (krytyka L4):** reconcile = 1 entry / 1 job,
   single-pass; `markCompleted`/`markFailed` job-level (istnieją —
   crud.ts:252/281); heartbeat job-level w trakcie wywołania LLM; zero
   reserveCandidates/markItemDone (items są keyed po candidate_id —
   strukturalnie nie pasują i nie są potrzebne).

---

## 5. OBSERWOWALNOŚĆ (memLog; zero kwot/treści)

Eventy domeny `reconcile`: `claimed/completed/noop (errorCode: stale_version|
entry_inactive|no_candidate|unresolvable|unchanged)/consequence_applied/
judge_failed/failed`. Nowe klucze MemoryLogMeta+META_KEY_CATEGORY (lockstep):
`reconcileAction` (enum: reinforce|quench|invalidate|retain|bookkeep|tier_raise),
`matchedEntries`/`enqueuedJobs` (num). REUSE istniejących outcome* kluczy.

---

## 6. TESTY (rule 13)

**non-DB:** `outcomeDelta`/`consequenceFor` PEŁNA macierz 4×4 sygnałów ×
statusy (reguły uporządkowane: flip oba kierunki przed reinforce/quench;
mixed→negative=quench, mixed→positive=reinforce, positive→mixed=bookkeep,
invalidated/nieterminalne=bookkeep; F2 trigger przy tier hypothesis/inferred
vs observed); quench respektuje FLOOR i bumpuje kotwicę S6b; reconcile-judge
schema strict (akcja spoza enum → odrzucona, clamp tieru, tier tylko w górę);
ledger-wake dedupe kluczy + mapping (deps stub; promoted_knowledge_id NOT NULL);
enqueue re-arm semantics (completed→pending; running→wake_pending=true;
pending/failed → no-op; permanently_failed nietknięty); markCompleted konsumuje
wake_pending (true → pending zamiast completed); stale_version → re-enqueue na
currentVersion; executor branch z deps stub (stale/unchanged/happy/flip).
**Integracja (realny pgvector, temp-harness `_s7_tmp`):** e2e: seed execution+
capture+activity → promote lekcji (outcome open) → zamknięcie w proj_pnl_matches
→ `enqueueLedgerWake` → job → reconcile → reinforce/quench + version=1 + decyzja
+ maturity event; flip → judge stub → invalidate (status+valid_until); replay
(`replayActivityFromCapture`) NIE tworzy jobów; idempotencja (2× wake → 1 job;
completed re-arm przy kolejnym wake); race wersji (równoległy bump → no-op);
GIN index used (EXPLAIN sanity opcjonalnie).
**S6a/S6b regresja:** maturity testy bez zmian zachowania (reason outcome_change
nowy, reszta nietknięta).

---

## 7. DONE-WHEN

- tsc + vex-app lint clean; non-DB zielone; integracja na realnym pgvector zielona.
- Zamknięcie/rozstrzygnięcie trade'u budzi rekonsolidację powiązanej lekcji
  (event-driven, nie polling); replay nie generuje wake'ów.
- Mapa F1 działa (zysk wzmacnia, strata wygasza, flip → sąd, dane → bump);
  F2 awans tieru po faktach z clampem; F3 wallet_intents poza zakresem.
- Każdy reconcile: outcome_version+1 (przy zmianie), decyzja `reconcile`,
  maturity event `outcome_change`; idempotencja po (entry, version) z re-armem.
- `needsReconciliation` z S5 domknięte: thin→full przelicza się samo.
- Advisory-only/FIX-1..4 zachowane; zero zmian registry/ToolDefs.

---

## 7a. KRYTYKA WORKFLOW (4 soczewki, 2026-06-09) — wcielone / odrzucone

**Wcielone:** lost-wake window (L4 blocker → `wake_pending` + konsumpcja przy
markCompleted + stale→re-enqueue, §1/§2/§4); macierz konsekwencji uporządkowana
i domknięta defaultem (L2/L3 → §4.3); invalidate = bezpośredni UPDATE w tx
(updateStatus nie ustawia valid_until — L1 → §4.5); reconcile BEZ job_items
(L4 → §4.6); lock-order analiza (L4 → §4.5); mapping query + promoted NOT NULL
i BitmapOr zamiast „UNION wymagane" (L2 → §3); verdict→wykonanie wprost
(L4 → §4.4); `ke_status_valid` hardening (L1 → §2); audyt unchanged = świadomy
wybór A (L4 → §4.5).

**Odrzucone z faktem:** „brak kolumny knowledge_entries.source" — istnieje
(`018_knowledge_source.sql:20-21`, inline CHECK; lens patrzył tylko na 001);
„deriveEvidenceStrengthCeiling nie istnieje" — istnieje (`evidence-deref.ts:120`,
S5); wszystkie „blokery" typu „seam/worker/moduł nie zaimplementowany" —
prescribed Creates planu (misframe).

---

## 8. GATE-POINTS (do bramki harness-memory-s7)

1. D-REARM+wake_pending: pełny cykl (running→flag→complete→pending→stale→
   re-enqueue) — czy nie ma stanu, w którym informacja ginie albo job
   wiruje w nieskończoność?
2. Mapa konsekwencji: reguły uporządkowane — potwierdzić intencję
   mixed→negative=quench / mixed→positive=reinforce / positive→mixed=bookkeep.
3. F2 trigger: ceiling strong + tier {hypothesis,inferred} — wystarczający
   warunek? (observed nie zyskuje — potwierdzić.)
4. Quench 0.15 + bump last_decayed_at — interakcja z S6b incremental anchor.
5. Wake matching po instrumentKey — szerokie (każdy trade tokena budzi lekcje
   o tokenie); akceptowalne bo no-op tani? Czy zawęzić do positionKey+executionId?
6. reconcile-judge bez supersede-z-treścią (invalidate zamiast) — zgodne z
   FIX-4 (jedyna droga treści = promote)? Potwierdzić.
7. Decyzja unchanged: zero śladu w memory_decisions (tylko memLog + completed
   job) — wystarczający audyt?
8. `ke_status_valid` — dodać przy okazji (hardening) czy poza zakresem S7?

---

- **Wymóg z bramki (R1):** `recoverStaleRunning` (reset zawieszonych `running`)
  MUSI zachować `wake_pending` nietknięte (flaga przeżywa recovery — sygnał nie
  ginie po crashu workera). +test jednostkowy.

---

## 9. ŚLAD BRAMEK

- **Krytyka workflow (4 soczewki): wcielona/odrzucona** — patrz §7a.
- **Plan-gate S7 R1 (harness-memory-s7, thread `019eadf6`): GREEN LIGHT —
  0 defektów projektowych.** Wszystkie pytania (a)–(g) potwierdzone: D-SEAM
  kompletny (settlement→synthetic-capture→populateCaptureItems; replay omija
  strukturalnie), cykl wake_pending bez utraty informacji i bez pętli, macierz
  konsekwencji jednoznaczna i zgodna z F1, judge {invalidate,quench,retain}+tier
  zgodny z FIX-4, lock-order bez cyklu, schemat minimalny, OD-1/FIX-1/FIX-3/F3
  zachowane. Gate-points §8 1–8: wszystkie TAK. 1 zastrzeżenie WCIELONE:
  stale-recovery respektuje wake_pending (wyżej). Start implementacji
  autoryzowany.
- **Implementacja: 2× subagent Fable 5 (xhigh).** Pierwszy padł w połowie
  (wynik utracony; zdążył: schemat §2, D-REARM w memory-jobs, settery
  candidates/decisions/knowledge, reconcile-policy z 2 błędami tsc). Drugi
  (kontynuator) zweryfikował i zachował tę pracę, naprawił reconcile-policy
  (ODWRÓCENIE importu: ReconcileVerdict Zod w policy/core, judge importuje),
  zbudował resztę (ledger-wake, reconcile-judge, engine/reconcile, szew,
  logger, testy). Zatwierdzone dewiacje: enqueued=świeże inserty;
  decyzja reconcile_outcome_version=v-1 (koherencja z job key); usunięty
  martwy UNSUPPORTED_JOB_KIND_BACKOFF_MS.
- **Weryfikacja niezależna (parent): PASS.** root tsc clean; non-DB 709/709
  (59 plików); **integracja na REALNYM pgvector 57/57 za pierwszym razem**
  (reconcile.int e2e: reinforce+v1+decyzja+maturity event / quench /
  flip→invalidate+poza recall / replay zero jobów / 2×wake→1 job / completed
  re-arm / wake-during-running→flaga→drugi pass / recovery zachowuje flagę;
  + regresja S6: regime-snapshots 10/10, knowledge-maturity-events).
  Grepy: OD-1 czysty, F3 czysty, FIX-3 zero zmian registry. Spot-checki:
  szew D-SEAM, D-REARM SQL, markCompleted, findPromotedWakeTargets,
  outcomeDelta anty-pętla. Temp-harness `_s7_tmp` usunięty, zero stray
  kontenerów. Werdykt parenta: JEST GIT.
- **Phase-6 impl-gate (świeży wątek `019eb05f` — `019eadf6` przepełnił context
  window): GREEN LIGHT — 0 defektów.** Potwierdzone wprost: pełny cykl D-REARM
  bez gubienia sygnału, processReconcileJob zgodny z §4 (kolejność, stale
  re-enqueue, unchanged bez tx/decyzji, no job-items), mapa reguł + anty-pętla
  outcomeDelta, szew best-effort + replay nietknięty, wake-targets SQL,
  memLog allowlist.
- **S7: DONE (working tree; commit na wyraźną prośbę właściciela).**
