# S8 — Graph v1: ekstrakcja encji + ekspansja w retrieval — execution plan

Spec wykonawczy etapu S8. Zakres: LLM-ekstrakcja encji/krawędzi przy promocji,
deterministyczne aliasy, wypełnienie hooka `expandViaGraph` w `long_memory_search`
(bounded, 1 skok), wiring inwalidacji krawędzi przy supersede/invalidate.
Po S7 (na main `9d6f8f1`). Substrat S1d ISTNIEJE i jest zamknięty: 3 tabele
(memory_entities/memory_entry_entities/memory_edges, FULL bi-temporal edges),
repo (xmax `upsertEntity` po (type, normalized_name), `addEntityAliases`,
`findActiveEntity`, `linkEntryEntity` GREATEST-on-conflict, atomowy
`supersedeEdge`, `invalidateEdge/Entity`), zamknięte enumy (entity_type ×8:
token|protocol|wallet|strategy|market_regime|concept|person|event; relation ×8:
traded_on|uses|holds|competes_with|correlates_with|part_of|supersedes|related_to),
`normalizeEntityName` repo-owned (anty-poisoning), parametr `expand_graph`
w schemacie search (długo `default false` — F3 to zmienia), pusty stub
`expandViaGraph` (`search.ts:104-106`, wołany post-blend pre-cap `:311-313`).

---

## 0. FORKI WŁAŚCICIELA (rozstrzygnięte 2026-06-10, AskUserQuestion)

- **F1 — drugi call LLM TYLKO przy promocji:** sędzia zostaje sędzią; gdy
  werdykt = promote/supersede, osobny call ekstrakcyjny PRZED transakcją
  (D-ORDER: LLM nigdy nie trzyma locków), zapisy grafu atomowo z promocją.
  Brak promote = zero kosztu.
- **F2 — aliasy deterministycznie + od LLM, ZERO fuzzy-merge:** sklejanie tylko
  po identycznym kluczu znormalizowanym + aliasach jawnie wyemitowanych przez
  LLM przy ekstrakcji. Automatyczne łączenie po podobieństwie embeddingów
  WYŁĄCZONE (scam-tokeny żerują na podobnych nazwach — sklejenie zatruwa graf).
- **F3 — ekspansja domyślnie WŁĄCZONA:** `expand_graph` default `true`
  (zmiana w schemacie + opis narzędzia); wyniki z grafu ograniczone, oznaczone,
  ważone poniżej trafień bezpośrednich; agent może jawnie wyłączyć.

---

## 1. DECYZJE ZAMKNIĘTE (engineering, z recon)

- **D-SCOPE:** ekstrakcja dla KAŻDEJ promowanej lekcji (nie tylko trade-family)
  — encje (protokoły, koncepty) występują też w preferencjach/faktach.
- **D-FAIL-OPEN (graf = pomoc, nie źródło prawdy):** błąd calla ekstrakcji /
  embeddingu nazwy NIE blokuje promocji — memLog warn, lekcja promuje się BEZ
  encji (bez retry-maszynerii w S8). Asymetria świadoma: wiedza > graf.
- **D-EMB:** embeddingi NAZW encji liczone PRE-TX (`embedDocument`, ten sam
  model/dim co kandydaci — spójność z filtrami recall; stempel
  model+dim z odpowiedzi). **Krawędzie BEZ fact-embeddingów w S8**
  (kolumny nullable all-or-none zostają NULL; wektorowe szukanie po krawędziach
  odroczone — ekspansja ich nie potrzebuje).
- **D-WRITE (atomowość):** flow per promowany kandydat:
  pre-tx: ekstrakcja (LLM) → redact() defensywnie na name/aliases/summary/fact
  → **kanonizacja symbolu** (krytyka L3: `normalizeEntityName` NIE zdejmuje
  `$` — nazwa zaczynająca się od `$` jest deterministycznie strippowana do
  nazwy kanonicznej, a wariant `$XXX` ląduje w aliasach; czysta funkcja w
  warstwie ekstrakcji, substrat S1d NIETKNIĘTY; prompt dodatkowo instruuje
  kanoniczną nazwę bez `$`) → embed nazw (`embedDocument(name, summary ?? "")`,
  stempel model+dim z odpowiedzi) → plan zapisów.
  W TX `applyDecisionAtomically`, PO `applyDecision`, PRZED `recordDecision`:
  **`entryId = decisionInput.promotedKnowledgeId`** (krytyka L1:
  `applyDecision` zwraca `{decisionInput}` — id JEST w środku dla
  promote/supersede; null → brak grafu, np. retain) →
  per encja `upsertEntity` (idempotentny xmax) → `addEntityAliases` →
  `linkEntryEntity(entryId, entityId)` → per krawędź `upsertEdge` z
  `originEntryId=entryId`. `findActiveEntity` pre-tx tylko jako optymalizacja
  pominięcia embed; race nieszkodliwy (xmax upsert).
- **D-SAVEPOINT (krytyka L1: fail-open vs atomowość):** zapisy grafu w tx są
  owinięte SAVEPOINT-em: `SAVEPOINT graph_plan` → applyGraphPlan → `RELEASE`;
  błąd → `ROLLBACK TO SAVEPOINT graph_plan` + memLog warn + promocja
  KONTYNUUJE (commit bez grafu). To domyka doktrynę „graf = pomoc, nie źródło
  prawdy" end-to-end: żaden błąd grafu (pre-tx ani in-tx) nie blokuje promocji
  i nie wywraca tx. Pre-walidacja (Zod/enum/dim) i tak czyni in-tx błąd
  anomalią — savepoint to pas bezpieczeństwa, nie ścieżka oczekiwana.
- **D-EDGE-OWNERSHIP (krytyka L3, świadomy kompromis v1):** arbiter konfliktu
  `upsertEdge` to (source,target,relation) active — druga lekcja twierdząca tę
  samą krawędź dostaje istniejącą (origin zostaje przy pierwszej).
  `invalidateEdgesForOrigin(poprzednik)` może więc unieważnić krawędź, na
  której „polega" też inna żywa lekcja. AKCEPTOWANE w v1: krawędzie to słaby
  sygnał asocjacyjny; linki entry↔entity przeżywają (ekspansja przez encje
  działa dalej), a następna promocja twierdząca tę relację re-asertuje krawędź
  świeżym originem. Bez zmian DDL (śledzenie wielu originów = S8.2 jeśli
  praktyka pokaże potrzebę).
- **D-SUPERSEDE-WIRING (luka z recon):** krawędzie są twierdzeniami LEKCJI —
  gdy lekcja przestaje obowiązywać, jej krawędzie też:
  - supersede (S4 path): w tx supersede → `invalidateEdgesForOrigin(predecessorId)`
    (NOWY helper repo, bulk, idempotentny); następca dostaje świeżą ekstrakcję.
  - S7 reconcile-invalidate: w tej samej tx → `invalidateEdgesForOrigin(entryId)`.
  - Linki entry↔entity ZOSTAJĄ (zapis historyczny, nieszkodliwy — ekspansja
    filtruje po `ke.status='active'`).
- **D-EXPAND (wypełnienie hooka, 1 skok, twarde limity):**
  seeds = top `GRAPH_EXPANSION_MAX_SEEDS` (5) ENTRY-wyników po blendzie →
  encje seedów (cap `GRAPH_EXPANSION_MAX_ENTITIES` 8) → aktywne krawędzie
  (obie strony, valid-time, cap per encja) → encje sąsiednie → wpisy sąsiadów
  (`ke.status='active'`, dedupe vs już zwrócone, cap
  `GRAPH_EXPANSION_MAX_RESULTS` 5) — wszystko w 2-3 batchowych zapytaniach
  (NOWE prymitywy §3), zero N+1.
  **Scoring (doprecyzowane po krytyce L2 — bez podwójnego liczenia):**
  `seed.score` JUŻ zawiera tier×activation SEEDA (`scoreKnowledge`,
  retrieval-policy:186-190). Formuła kompozycji pewności ścieżki:
  `graphScore = seed.score × GRAPH_HOP_DECAY × tierWeight(neighbor) ×
  activationFactor(neighbor)` — czynniki SĄSIADA (jego wiarygodność), nie
  ponowne czynniki seeda. `GRAPH_HOP_DECAY = 0.5` (ZMIANA z 0.6 — odsunięcie
  od przypadkowej kolizji z CANDIDATE_DUAL_TRACE_WEIGHT=0.6; tune do not
  freeze) + import-assert `< 1`. Property-testy: graphScore < seed.score
  ZAWSZE; worst-case (hypothesis-seed × hypothesis-neighbor ≈ 0.19×sim)
  poniżej kandydatów — zgodne z „graf wzbogaca, nie dominuje" (graf to
  najsłabszy sygnał z trzech). Inwariant S3 nietknięty.
  **Sygnatura hooka (krytyka L2):** `expandViaGraph(seedResults, 
  alreadyReturnedIds, remainingSlots, deps)` — stub i call-site
  (`search.ts:104/:312`) do aktualizacji: przekazujemy pełne wyniki (score!),
  zbiór zwróconych id (dedupe) i wolne sloty (dopełnianie bez wypierania;
  `droppedCount` rozdzielony: bezpośrednie vs ekspansja).
  Wynik oznaczony `via:'graph'` + `viaEntity` (nazwa encji ≤50 znaków) —
  ADDYTYWNE opcjonalne pola na LongMemoryKnowledgeResult (union stabilny);
  formattery toConcise/toDetailed emitują marker.
- **D-DEFAULT-ON (F3):** `expandGraph` default `true` w
  `memory/schema/long-memory-search.ts` + aktualizacja opisu ToolDef (parametr
  istnieje — bez zmian registry poza opisem). Pusty graf → ekspansja zwraca []
  (zachowanie sprzed S8, koszt ~2 szybkie zapytania).
- **Advisory-only (OD-1):** graf wpływa WYŁĄCZNIE na retrieval. FIX-3: ekstrakcja
  to funkcje wewnętrzne managera. FIX-4: jedyna treść w grafie pochodzi z JUŻ
  zredagowanej lekcji + defensywny redact() na outputach LLM.

---

## 2. SCHEMAT

ZERO zmian DDL — substrat S1d wystarcza w całości. (Mirror bez zmian.)

---

## 3. NOWE PRYMITYWY REPO (ekspansja + wiring)

- `memory-entry-entities`: `listEntityIdsForEntries(entryIds)` (batch,
  `= ANY($1)`); `listEntryIdsForEntities(entityIds, limit)` (batch, JOIN
  knowledge_entries `status='active'`).
- `memory-edges`: `listActiveEdgesForEntities(entityIds, limitPerSide)`
  (obie strony, `invalidated_at IS NULL` + valid-time, indeksy idx_med_source/
  target); `invalidateEdgesForOrigin(entryId, client?)` (bulk UPDATE
  `origin_entry_id=$1 AND invalidated_at IS NULL`, zwraca count, idempotentny).
- `knowledge`: `getActiveEntriesByIds(ids)` w kształcie recall-DTO
  (id/kind/title/summary/source/maturity/activation — bez embeddingu; do
  zbudowania LongMemoryResult ekspansji).

---

## 4. EKSTRAKCJA — `memory/manager/entity-extraction.ts` (+schema)

- `memory/manager/entity-extraction-schema.ts` (Zod strict, bounded —
  anty-poisoning): `entities: [{name ≤120, type ∈ entity_type×8,
  aliases: string[≤64] ≤8, summary? ≤500}] ≤8`; `edges: [{source/target =
  nazwa encji Z LISTY entities (refine), relation ∈ relation×8, fact? ≤300}] ≤8`;
  refine: source≠target (self-loop), edge endpoints muszą wskazywać
  zadeklarowane encje.
- `extractEntities(lesson, deps)` — wzór judge.ts (provider injectable,
  timeout `JUDGE_TIMEOUT_MS` reuse, brace-JSON, safeParse strict, throw na
  malformed → caller łapie i FAIL-OPEN). Prompt: TASK (wyciągnij encje
  handlowe z lekcji) + zamknięte słowniki (dokładne stringi) + reguły
  (tylko encje istotne dla odnajdywania lekcji; aliasy = symbole/warianty
  TEGO SAMEGO bytu, nigdy podobnych; bez osób prywatnych; UNTRUSTED-data
  rama jak regime-prompt) + OUTPUT_CONTRACT JSON. Input: title+summary+
  contentMd (już zredagowane) + kind + regimeTags.
- Wynik przechodzi `redact()` per pole (defense-in-depth) przed planem zapisów.

---

## 5. SEAM W KONSOLIDACJI (consolidate.ts)

Po werdykcie promote/supersede, PRZED `applyDecisionAtomically`:
`buildGraphPlan(candidate, verdict)` → `{upserts, links, edges}` (z embeddingami)
albo `null` (fail-open po błędzie). W `applyDecisionAtomically`, po
`applyDecision` (entryId znane), przed `recordDecision`: `applyGraphPlan(plan,
entryId, tx)`. Supersede dodatkowo: `invalidateEdgesForOrigin(predecessorId, tx)`.
S7 `engine/memory-manager/reconcile.ts`: w gałęzi invalidate dorzucić
`invalidateEdgesForOrigin(entryId, tx)`.

---

## 6. EKSPANSJA — `tools/internal/long-memory/search.ts` + retrieval-policy

- `expandViaGraph(seedResults, alreadyReturnedIds, deps)` zastępuje stub:
  batch-prymitywy §3, mapowanie na LongMemoryResult z `via:'graph'`/`viaEntity`,
  scoring wg D-EXPAND (stałe w retrieval-policy: `GRAPH_HOP_DECAY=0.5`,
  `GRAPH_EXPANSION_MAX_SEEDS=5`, `MAX_ENTITIES=8`, `MAX_RESULTS=5` — tune
  do not freeze; import-assert `GRAPH_HOP_DECAY < 1`). Guard brzegowy
  (Codex R1): seedy ze score ≤ 0 pomijane w ekspansji (ścisła nierówność
  `graphScore < seed.score` ma sens tylko dla dodatnich seedów; property-test
  na dodatnich, guard na zero).
- Hook pozostaje post-blend pre-cap; dopełnia do inline-cap; `droppedCount`
  uwzględnia odrzucone wyniki ekspansji (bez cichego ucinania).
- `memory/schema/long-memory-search.ts`: `expandGraph` default `true`;
  opis parametru w ToolDef zaktualizowany.
- Format odpowiedzi: marker `via_graph(entity)` w linii wyniku (concise i
  detailed), spójny z istniejącym formatowaniem.

---

## 7. OBSERWOWALNOŚĆ

memLog: `manager`/`graph_extracted` {entityCount, edgeCount, linkCount},
`graph_extraction_failed` {errorCode} (fail-open ślad), `search`/`graph_expanded`
{expandedCount, seedCount}; edge-invalidation przy supersede/invalidate loguje
count. Nowe klucze num: `entityCount/edgeCount/linkCount/expandedCount/seedCount`
(lockstep MemoryLogMeta + META_KEY_CATEGORY). Zero nazw encji w logach (id/enum/num only).

---

## 8. TESTY (rule 13)

**non-DB:** extraction-schema (vocab/self-loop/endpoint-refine/cap/bounded);
extraction fail-open (LLM error → null-plan, promocja idzie dalej — stub deps);
alias plan (istniejąca encja → aliasy, nowa → upsert; F2: zero fuzzy);
expansion scoring property (zawsze < seed; tier/activation factors; import-assert
decay<1); expansion caps + dedupe + dopełnianie slotów; schema default-on;
seam: graph plan trafia do tx po applyDecision (stub deps przez consolidate
testy); supersede/invalidate woła invalidateEdgesForOrigin.
**integracja (realny pgvector, temp-harness `_s8_tmp`):** e2e promote z
ekstrakcją (stub LLM) → encje+linki+krawędzie atomowo z lekcją; drugi promote
z tą samą encją → alias-merge bez duplikatu (uniq_me_active_identity);
ekspansja e2e: seed → sąsiad przez encję z markerem via_graph, bounded,
nie wypiera bezpośrednich; pusty graf → []; supersede unieważnia krawędzie
poprzednika (successor fresh); reconcile-invalidate unieważnia krawędzie;
ekstrakcja-fail → lekcja promowana bez grafu.
**Regresja:** search/retrieval-policy testy S3 (inwarianty), consolidate S4,
reconcile S7 — aktualizacja sygnatur gdzie trzeba, zachowanie bez grafu
identyczne.

---

## 9. DONE-WHEN

- tsc clean; non-DB + integracja na realnym pgvector zielone; temp-harness
  usunięty.
- Promocja lekcji tworzy encje/aliasy/linki/krawędzie atomowo; błąd ekstrakcji
  nie blokuje promocji (fail-open, audytowany).
- `long_memory_search` domyślnie dopełnia wyniki sąsiadami z grafu (1 skok,
  twarde limity, marker, score < seed); inwarianty S3 nietknięte
  (property-test); lekcje o tokenie wypływają przy zapytaniach o token przez
  encję, nie tylko wektor.
- Supersede/invalidate lekcji unieważnia jej krawędzie (bi-temporalnie,
  bez kasowania).
- F2: zero automatycznego fuzzy-merge; aliasy tylko deterministyczne+LLM.
- OD-1/FIX-3/FIX-4 zachowane; zero zmian DDL; zero nowych ToolDefs.

---

## 9a. KRYTYKA WORKFLOW (3 soczewki, 2026-06-10) — wcielone / odrzucone

**Wcielone:** entryId z `decisionInput.promotedKnowledgeId` (L1 blocker — 
applyDecision nie zwraca id wprost, ale niesie je w decisionInput);
**D-SAVEPOINT** na zapisach grafu w tx (L1 — fail-open domknięty end-to-end,
błąd in-tx nie wywraca promocji); scoring bez podwójnego liczenia + 
`GRAPH_HOP_DECAY=0.5` zamiast 0.6 (L2 — kolizja z wagą kandydatów);
sygnatura `expandViaGraph` z seedResults/alreadyReturnedIds/remainingSlots +
rozdzielony droppedCount (L2); pola `via`/`viaEntity` addytywne na DTO +
formattery (L2); **D-EDGE-OWNERSHIP** świadomy kompromis współdzielonych
krawędzi (L3); kanonizacja `$`-symbolu w warstwie ekstrakcji, substrat
nietknięty (L3); blast-radius default-flip w §8 (L2).

**Odrzucone z faktem:** „bounds ekstrakcji luźniejsze od substratu" (L3) —
odwrotnie: 120<256 (name), 8<64 (aliasy), 64<256 (alias), 500<4000 (summary),
300<4000 (fact) — ekstrakcja jest WSZĘDZIE ciaśniejsza, jak nakazuje
anty-poisoning; „brakujące funkcje repo/moduły" — prescribed Creates §3/§4
(misframe).

---

## 10. GATE-POINTS (do bramki harness-memory-s8)

1. D-WRITE: zapisy grafu w tx applyDecisionAtomically wydłużają tx o kilka
   INSERT-ów (bez LLM/sieci — te pre-tx) — potwierdzić akceptowalność vs
   fail-open alternatywę (graf poza tx).
2. Ekstrakcja przy supersede: następca dostaje świeżą ekstrakcję — czy
   przenosić COKOLWIEK z poprzednika (plan: nie, świeża prawda)?
3. ROZSTRZYGNIĘTE (Codex R1): `GRAPH_HOP_DECAY=0.5` WSZĘDZIE (kolizja z 0.6
   usunięta u źródła); property-test graphScore<seed.score (dodatnie seedy) +
   guard seedów score≤0.
4. `via`/`viaEntity` w DTO — dodatkowe pole vs trzeci typ source union
   (plan: pole, union stabilny dla agenta).
5. Limity 5/8/5 + 1 skok — wystarczające na start (tune do not freeze)?
6. Linki entry↔entity poprzednika zostają po supersede (historyczne; filtr
   active na wpisach wystarcza) — potwierdzić.
7. Default-on (F3) bez zmiany promptu agenta (STRUCTURE+CACHE później) —
   opis ToolDef wystarczy?

---

## 11. ŚLAD BRAMEK

- (uzupełniane w trakcie)

---

## 11. ŚLAD BRAMEK (cd.)

- **Krytyka workflow (3 soczewki): wcielona/odrzucona** — patrz §9a.
- **Plan-gate S8 R1 (harness-memory-s8, thread `019eb092`): BLOCKED — 1 REALNY
  defekt (P1):** wewnętrzna niespójność planu `GRAPH_HOP_DECAY` 0.5 (scoring)
  vs 0.6 (lista stałych §6 + gate-point 3) — moja własna, po częściowej edycji
  krytyki. + zastrzeżenie brzegowe seed.score≤0 (ścisła nierówność).
  Pozostałe oceny (a/b/d/e/f) i gate-points 1/2/4/5/6/7: TAK.
- **Plan-gate S8 R2: GREEN LIGHT — 0 nowych defektów.** P1 naprawione
  (0.5 wszędzie, gate-point 3 rozstrzygnięty), guard seedów ≤0 dodany.
  Wszystkie punkty (a)–(g) domknięte z cytatami. Start implementacji
  autoryzowany.
- **Implementacja: 2× subagent Fable 5 (xhigh)** (pierwszy padł w połowie
  search.ts — wynik utracony; kontynuator zweryfikował/zachował prymitywy repo,
  ekstrakcję, seam z SAVEPOINT, policy/logger; naprawił call-site expandViaGraph,
  flip defaultu, opis ToolDef, wszystkie testy). Dewiacje zatwierdzone:
  SAVEPOINT-test przez FK-violation+bad-dim; dropped-split dwoma eventami;
  hardening: wpisy bez via-path pomijane zamiast score 0.
- **Weryfikacja niezależna (parent): PASS.** root tsc clean; non-DB 809/809;
  **integracja realny pgvector 47/47 za pierwszym razem** (graph-v1 e2e:
  atomowość, alias-merge, ClaimLost→zero graph rows, extraction-fail→promocja
  bez grafu, 2× SAVEPOINT→promocja commit, supersede/reconcile unieważniają
  krawędzie, ekspansja z markerem + negatywne + pusty graf; regresja reconcile
  S7 + 3 suity S1d). Grepy OD-1/FIX czyste; zero DDL. Temp-harness `_s8_tmp`
  usunięty, zero stray kontenerów. Werdykt parenta: JEST GIT.
- **Phase-6 impl-gate (ten sam wątek `019eb092`): GREEN LIGHT — 0 defektów.**
  Potwierdzone: D-SAVEPOINT spójny (recordDecision poza zakresem rollbacku),
  fail-open kompletny, scoring po P1 jednolity, dedupe/guardy ekspansji,
  default-on + opis, memLog allowlist bez nazw encji.
- **S8: DONE (working tree; commit na wyraźną prośbę właściciela).**
