# Vex Memory System - propozycja przebudowy

Data: 2026-06-05
Status: plan architektoniczny, bez implementacji; zakładamy breaking replacement przed pierwszym użyciem produkcyjnym

## Cel

Przebudować pamięć agenta tak, aby:

- agent główny nie musiał sam zarządzać trwałością, TTL i supersession,
- narzędzia pamięci były łatwe do rozróżnienia po nazwach i opisach,
- trwała wiedza powstawała po konsolidacji, a nie po impulsywnym zapisie w trakcie rozmowy,
- sprawdzone elementy `knowledge_entries`, `session_memories` i `compact_jobs` zostały użyte jako fundament, ale publiczna powierzchnia pamięci może zostać zastąpiona,
- retrieval łączył RAG, elementy knowledge graph, lifecycle status, źródło i świeżość,
- świeże wysokosygnałowe kandydaty były widoczne natychmiast przez dual-trace retrieval,
- lekcje tradingowe były konsolidowane zdarzeniowo po zmianach w lokalnym ledgerze, nie tylko zegarowo,
- promowane wspomnienia miały probację, aktywację i warunkowy zanik zamiast natychmiastowej pełnej siły,
- dane wrażliwe, portfele, sekrety, live balances i transient market state nie trafiały do embeddings ani trwałej pamięci.

Plan bazuje na analizie obecnego repo, artykule `https://arxiv.org/html/2605.08538v1`, Mem0, Graphiti/Zep, LangGraph memory oraz zaleceniach Anthropic z `https://www.anthropic.com/engineering/writing-tools-for-agents`.

## Wniosek

Proponowany kierunek jest lepszy od obecnego bezpośredniego zapisu przez `knowledge_write` i powinien zastąpić obecną publiczną powierzchnię pamięci przed pierwszym użyciem produkcyjnym aplikacji.

Skoro aplikacja nie ma jeszcze użytkowników, nie musimy utrzymywać kompatybilności nazw tooli ani migracji zachowujących cudze dane pamięci. Nadal nie warto wyrzucać dobrych elementów wewnętrznych: `knowledge_entries`, lifecycle, pgvector, `session_memories` i wzorzec `compact_jobs` są sensownymi klockami do ponownego użycia.

Najważniejsza zmiana: agent główny powinien tylko zgłaszać kandydatów do pamięci, a nie decydować, czy coś jest trwałą wiedzą. Decyzję powinien podejmować osobny `memory_manager`, który widzi więcej kontekstu, potrafi poczekać na powtarzające się wzorce, wykrywa konflikty i promuje tylko sprawdzone informacje.

## Co istnieje dziś

### Trwała pamięć

Obecna trwała pamięć mieszka w `knowledge_entries`.

Ważne cechy:

- pgvector embeddings,
- `kind`, `title`, `summary`, `content_md`, `tags`, `source_refs`,
- `confidence`, `status`, `pinned`,
- `valid_from`, `valid_until`,
- `source_surface`, `source_session`,
- `source` jako `observed`, `user_confirmed`, `inferred`, `hypothesis`,
- `supersedes_id`, `status_reason`, `change_summary`, `what_failed`,
- content-hash dedupe,
- lifecycle przez supersession i statusy.

To jest dobra baza i nie należy jej wyrzucać.

### Pamięć sesyjna

Obecna pamięć sesyjna mieszka w `session_memories`.

Powstaje z compaction Track 2, nie przez bezpośredni zapis agenta. Jest epizodyczna i scoped do sesji. Zawiera tematy, encje, protokoły, rzeczy zrobione, rzeczy próbowane i outstanding items.

Ważne ograniczenie: `session_memories` nie ma dziś TTL ani expiry. To nie jest long-term memory, tylko skondensowana narracja sesji.

### Kolejka async

Obecny `compact_jobs` jest dobrym wzorcem dla przyszłego managera pamięci:

- pending/running/completed/failed/permanently_failed,
- `next_attempt_at`,
- ownership/lock,
- heartbeat,
- retry,
- stale recovery,
- audit kosztów/modelu/providerów.

Nie trzeba wymyślać osobnego task managera od zera. Dla memory managera warto stworzyć analogiczny outbox albo rozszerzyć wzorzec, ale nie mieszać tego z `loop_defer`, bo `loop_defer` służy do runtime wake/mission, nie do zarządzania pamięcią.

### Obecne tool'e

Dziś są między innymi:

- `knowledge_write`,
- `knowledge_supersede`,
- `knowledge_recall`,
- `knowledge_recall_overflow`,
- `knowledge_get`,
- `knowledge_update_status`,
- `knowledge_lineage`,
- `knowledge_history`,
- `memory_recall`,
- `mark_outstanding_resolved`.

Problem nie polega tylko na nazwach. Problemem jest też to, że agent widzi za dużo mechaniki lifecycle i może zapisać trwałą wiedzę za wcześnie.

## Główne problemy obecnego modelu

1. `knowledge_write` wymaga od agenta głównego decyzji, czy dana informacja zasługuje na trwały zapis.
2. Nazwy `knowledge_*` i `memory_*` nie mówią jasno, czy chodzi o pamięć sesyjną, trwałą, lifecycle, czy retrieval.
3. Brakuje stagingu: między rozmową a `knowledge_entries` powinien istnieć bufor kandydatów.
4. Brakuje okresowej konsolidacji z szerszym kontekstem.
5. Brakuje jawnej warstwy graph links między encjami, faktami i wspomnieniami.
6. Direct write zwiększa ryzyko zapisania efemerycznej informacji, niepotwierdzonego wniosku albo danych live.
7. Retrieval powinien być narzędziem wysokiego poziomu, a nie wyborem "vector vs graph vs history" po stronie agenta.
8. Tool'e nie mają jeszcze spójnego trybu odpowiedzi typu `concise` / `detailed`, który według Anthropic pomaga agentom kontrolować ilość kontekstu.

## Postawa migracyjna

To jest replacement, nie kompatybilna ewolucja dla istniejących użytkowników.

Konsekwencje:

- możemy usunąć stare nazwy z LLM-visible Tool Map od razu,
- nie potrzebujemy 1-2 release'y publicznych aliasów,
- `knowledge_write` nie powinien zostać widoczny dla zwykłego agenta,
- jeśli stare nazwy zostaną chwilowo w kodzie, to tylko jako wewnętrzne adaptery techniczne do czasu przepięcia dispatcherów i testów,
- lokalne developerskie DB mogą wymagać resetu albo jednorazowej migracji roboczej,
- nie projektujemy jeszcze skomplikowanego importu starej pamięci użytkownika.

Replacement nie oznacza braku dyscypliny. Nadal traktujemy schemat DB, IPC, prompt Tool Map, redakcję danych i lifecycle jako stabilne kontrakty wewnętrzne, bo błędy tutaj będą trudne do debugowania po starcie aplikacji.

## Docelowy model pamięci

Nowa pamięć powinna mieć pięć warstw:

1. Live state
2. Session memory
3. Memory candidates
4. Dual-trace retrieval
5. Long-term memory plus knowledge graph

### 1. Live state

Live state to aktualny stan aplikacji i świata:

- portfele,
- balances,
- pozycje,
- ceny,
- gas,
- pending transactions,
- runtime permissions,
- provider state.

Live state nie jest pamięcią. Może być używany jako dowód podczas konsolidacji, ale nie powinien być embeddingowany ani zapisywany jako trwałe wspomnienie w surowej formie.

Przykład dozwolonego wniosku:

> Użytkownik preferuje konserwatywną ekspozycję na ryzyko w strategiach DeFi.

Przykład niedozwolonego wspomnienia:

> Wallet 0x... miał 12.345 ETH o 14:03, gas wynosił X, pending tx hash Y.

### 2. Session memory

`session_memories` zostaje epizodyczną pamięcią sesji.

Rola:

- odtworzyć kontekst tej samej rozmowy po compaction,
- przypomnieć outstanding items,
- zachować narrację "co było robione i próbowane",
- dostarczyć evidence dla memory managera.

Nie należy z niej robić trwałej wiedzy o użytkowniku. Manager może ją czytać i wyciągać kandydatów, ale nie każdy chunk sesyjny powinien zostać long-term memory.

### 3. Memory candidates

Nowa tabela robocza, np. `memory_candidates`.

To bufor między agentem a trwałą pamięcią. Agent może tam zgłosić "chęć zapisu", ale nie decyduje o finalnym TTL, pinningu ani supersession.

Proponowane pola:

```ts
type MemoryCandidate = {
  id: string;
  sessionId: string | null;
  conversationId: string | null;
  proposedBy: "main_agent" | "subagent" | "compaction" | "memory_manager";
  candidateKind:
    | "preference"
    | "fact"
    | "procedure"
    | "project_context"
    | "decision"
    | "constraint"
    | "warning"
    | "open_question"
    | "trade_outcome"
    | "strategy_lesson"
    | "risk_lesson";
  title: string;
  summary: string;
  contentMd: string;
  entities: string[];
  tags: string[];
  sourceRefs: SourceRef[];
  evidenceRefs: MemoryEvidenceRef[];
  outcome?: MemoryOutcomeSummary;
  source: "observed" | "user_confirmed" | "inferred" | "hypothesis";
  confidence: number;
  importance: number;
  sensitivity: "normal" | "private" | "secret_or_live_state";
  evidenceStrength: "single_observation" | "repeated_pattern" | "explicit_user_statement" | "system_fact";
  retrievalVisibility: "hidden" | "dual_trace";
  retrievalUntil?: string;
  status: "pending" | "retained" | "merged" | "promoted" | "rejected" | "expired" | "failed";
  retainUntil: string;
  rejectReason?: string;
  promotedKnowledgeId?: string;
  mergedIntoCandidateId?: string;
  mergedIntoKnowledgeId?: string;
  duplicateOfCandidateId?: string;
  similarKnowledgeId?: string;
  eventTime?: string;
  observedAt?: string;
  recordedAt?: string;
  availableAtDecisionTime?: boolean;
  createdAt: string;
  updatedAt: string;
};

type MemoryEvidenceRef =
  | { type: "protocol_execution"; executionId: number; role: "decision" | "failure" | "outcome" | "context" }
  | { type: "capture_item"; captureItemId: number; executionId: number; role: "outcome" | "context" }
  | { type: "activity"; activityId: number; executionId: number; captureItemId?: number | null; role: "fill" | "close" | "context" }
  | { type: "pnl_match"; pnlMatchId: number; sellActivityId: number; role: "realized_outcome" }
  | { type: "pnl_lot"; pnlLotId: number; activityId: number; role: "cost_basis" | "open_exposure" }
  | { type: "lp_event"; lpEventId: number; executionId: number; role: "lp_cashflow" }
  | { type: "wallet_intent"; intentId: string; role: "transfer_attempt" | "transfer_outcome" };

type MemoryOutcomeSummary = {
  status: "open" | "closed" | "settled" | "failed" | "invalidated";
  productType?: "spot" | "perps" | "prediction" | "bridge" | "order" | "lp" | "lend" | "stake" | "reward";
  lessonSignal: "positive" | "negative" | "mixed" | "neutral";
  evidenceQuality: "weak" | "medium" | "strong";
  pointInTimeChecked: boolean;
  outcomeComputedBy: "memory_manager" | "deterministic_replay";
  outcomeVersion: number;
  outcomeLastChangedAt?: string;
  needsReconciliation?: boolean;
};
```

TTL dla kandydatów ustawia system, nie agent. Przykładowo:

- default 7 dni dla pojedynczej obserwacji,
- 30 dni dla explicit user statement,
- krócej dla `hypothesis`,
- natychmiastowe odrzucenie dla `secret_or_live_state`.

### 4. Dual-trace retrieval

Dual-trace rozwiązuje read-after-write gap.

Problem:

- `memory_manager` działa asynchronicznie,
- ważna informacja może być zgłoszona teraz,
- następna sesja może wystartować przed promocją do `knowledge_entries`,
- zwykłe `long_memory_search` byłoby ślepe na świeżą lekcję.

Rozwiązanie:

- `long_memory_search` domyślnie szuka w `knowledge_entries` oraz w wybranych `memory_candidates`,
- kandydat jest widoczny tylko gdy ma `retrievalVisibility = "dual_trace"`,
- widoczne są wyłącznie wysokosygnałowe kandydaty, np. `explicit_user_statement`, `risk_lesson`, mocny `trade_outcome`,
- wynik z kandydata musi być oznaczony jako `pending`, `not_consolidated` albo `fresh_signal`,
- kandydat ma niższą wagę niż promowane wspomnienie,
- kandydat nie może być użyty jako twarda execution constraint bez promocji albo policy gate,
- `retrievalUntil` ogranicza czas widoczności, żeby dual-trace nie stał się drugim trwałym magazynem.

Przykład:

> Fresh signal: ostatni podobny setup zaliczył obsunięcie; manager jeszcze nie skonsolidował lekcji. Traktuj jako ostrzeżenie, nie jako potwierdzoną regułę.

To jest szczególnie ważne dla tradingu: świeża `risk_lesson` po dużym obsunięciu powinna być dostępna od razu, nawet jeśli semantyczna konsolidacja nastąpi później.

### 5. Long-term memory plus knowledge graph

`knowledge_entries` zostaje źródłem prawdy dla trwałej wiedzy.

Do `knowledge_entries` albo do powiązanej tabeli lifecycle należy dodać politykę wpływu:

```ts
type LongMemoryInfluence = {
  maturityState: "probationary" | "active" | "reinforced" | "decayed" | "archived";
  activationStrength: number; // 0..1, używane w rerankingu i hot context
  influenceScope: "advisory" | "retrieval_boost" | "sizing_hint" | "execution_constraint";
  decayPolicy: "none" | "time" | "regime_aware" | "outcome_aware";
  regimeTags: string[];
  firstPromotedAt: string;
  lastReinforcedAt?: string;
  nextReviewAt?: string;
};
```

Zasady:

- świeżo promowana lekcja startuje jako `probationary`,
- `activationStrength` zaczyna nisko, np. 0.25-0.5 zależnie od evidence,
- lekcja tradingowa nie powinna od razu sterować sizingiem,
- awans do `active`/`reinforced` wymaga drugiego niezależnego potwierdzenia, mocnego explicit evidence albo ręcznej decyzji,
- `decayed` obniża wpływ w retrieval, ale nie musi usuwać historii,
- pinned explicit facts i decyzje architektoniczne mogą mieć `decayPolicy = "none"`.

Dodajemy lekką warstwę graph:

- `memory_entities`,
- `memory_entry_entities`,
- `memory_edges`.

Proponowany minimalny model:

```sql
memory_entities(
  id,
  canonical_name,
  entity_type,
  aliases,
  created_at,
  updated_at
)

memory_entry_entities(
  entry_id,
  entity_id,
  role,
  confidence
)

memory_edges(
  id,
  from_entity_id,
  to_entity_id,
  edge_type,
  source_entry_id,
  confidence,
  status,
  valid_from,
  valid_until,
  created_at,
  updated_at
)
```

Graph nie powinien zastąpić `knowledge_entries`. Ma pomagać w retrieval i konflikcie, np. "ta preferencja dotyczy tego projektu", "ta procedura superseduje poprzednią", "ten byt jest aliasem tamtego".

## Nowe nazwy tooli

Nie rekomenduję nazwy `your_memory`. Jest przyjazna dla człowieka, ale za mało precyzyjna dla agenta. Anthropic słusznie podkreśla, że narzędzia dla agentów powinny być projektowane jak UX: nazwa powinna mówić, co narzędzie robi, na jakim substracie działa i kiedy go używać.

### Tool'e widoczne dla zwykłego agenta

| Nowa nazwa | Zastępuje | Rola |
| --- | --- | --- |
| `session_memory_search` | `memory_recall` | Szuka tylko w pamięci bieżącej sesji po compaction. |
| `session_memory_resolve_item` | `mark_outstanding_resolved` | Oznacza outstanding item z sesji jako rozwiązany. |
| `long_memory_search` | `knowledge_recall` | Szuka w trwałej pamięci przez hybrid retrieval. |
| `long_memory_get` | `knowledge_get` | Pobiera konkretny wpis trwałej pamięci po id. |
| `long_memory_history` | `knowledge_history`, `knowledge_lineage` | Pokazuje historię, supersession i zmiany danego wpisu. |
| `long_memory_suggest` | część `knowledge_write` | Zgłasza kandydata do pamięci, bez finalnego zapisu. |

### Tool'e ukryte albo manager-only

| Nazwa | Rola |
| --- | --- |
| `memory_candidate_list` | Pobiera kandydatów dla managera. |
| `memory_candidate_update` | Retain/reject/expire kandydatów. |
| `long_memory_promote` | Promuje kandydata do `knowledge_entries`. |
| `long_memory_supersede` | Superseduje istniejącą wiedzę. |
| `long_memory_archive` | Archiwizuje lub zmienia status trwałej wiedzy. |
| `long_memory_graph_link` | Dodaje/aktualizuje encje i krawędzie graph. |

Stare `knowledge_*` i `memory_*` nie muszą zostać jako publiczne aliasy. Przy replacement najlepiej usunąć je z LLM-visible registry i promptowego Tool Map w tym samym etapie, w którym dodajemy nowe nazwy.

Jeśli utrzymamy adaptery typu `knowledge_recall -> long_memory_search`, powinny być krótkotrwałe, niewidoczne dla agenta i oznaczone jako techniczna pomoc w refaktorze, nie jako wspierany kontrakt.

## Response format tooli

Tool'e retrieval powinny dostać `response_format`:

```ts
type MemoryResponseFormat = "concise" | "detailed";
```

Domyślne:

- `concise` dla zwykłego planowania i kontynuowania pracy,
- `detailed` dla debugowania, lineage, source refs, konfliktów i cytowania dowodów.

Przykład dla `long_memory_search`:

```ts
type LongMemorySearchInput = {
  query: string;
  scope?: "current" | "historical" | "all";
  includeSources?: boolean;
  responseFormat?: "concise" | "detailed";
};
```

Agent nie powinien wybierać, czy szuka po vector, BM25 czy graph. `long_memory_search` powinien ukrywać tę decyzję i zwracać gotowe, rankingowane wyniki.

## Przepływ zapisu

### Dziś

```text
agent -> knowledge_write -> knowledge_entries
```

### Docelowo

```text
agent -> long_memory_suggest -> memory_candidates
                                      |
                                      v
                           memory_manager worker
                                      |
                    +-----------------+------------------+
                    |                 |                  |
                 reject            retain             promote
                                      |                  |
                                      v                  v
                              retry later       knowledge_entries
                                                        |
                                                        v
                                                 graph links
```

Agent główny może powiedzieć:

> To może być ważne do zapamiętania.

Ale manager decyduje:

- czy to jest prawdziwa pamięć,
- czy to tylko szum,
- czy trzeba poczekać na więcej dowodów,
- czy istniejący wpis trzeba supersedować,
- jaki TTL i status nadać,
- jakie encje i relacje dopiąć.

## Memory manager

`memory_manager` powinien być background workerem zbudowanym podobnie do `compact_jobs`.

Uruchamianie:

- po zdarzeniach lokalnego ledgeru: `protocol_execution` recorded, `capture_item` recorded, `activity` projected, `pnl_match` created, `position` closed, `lp_event` recorded, `wallet_intent` executed/failed/audit_failed,
- po zmianie outcome powiązanego z istniejącym kandydatem albo wpisem `knowledge_entries`,
- po dużym negatywnym sygnale ryzyka, np. stratny close, drawdown, failed execution po policy/risk issue,
- po zamknięciu sesji/misji,
- po starcie aplikacji, jeśli są zaległe kandydaty albo reconciliation jobs,
- po przekroczeniu progu liczby pending candidates,
- co około 3h jako konserwacyjny sweep,
- opcjonalnie po explicit user action typu "organize memory".

Stały zegar nie może być jedyną kadencją. Dla tradingu naturalny rytm konsolidacji wynika ze zdarzeń ledgeru, zwłaszcza zamknięcia/settlementu pozycji i realizacji PnL.

Manager powinien działać w dwóch etapach.

### Etap deterministyczny

Bez LLM:

1. Walidacja Zod.
2. Redakcja sekretów i danych live.
3. Odrzucenie `secret_or_live_state`.
4. Hash dedupe.
5. Similarity search do istniejących `knowledge_entries`.
6. Sprawdzenie statusu i `valid_until`.
7. Sprawdzenie source tier.
8. Sprawdzenie `eventTime`, `observedAt`, `recordedAt`, `availableAtDecisionTime`.
9. Dereferencja `evidenceRefs` do lokalnego ledgeru.
10. Outcome resolver dla `trade_outcome`/`strategy_lesson`/`risk_lesson`.
11. Ustalenie dual-trace visibility dla świeżych wysokosygnałowych kandydatów.
12. Ustalenie, czy kandydat może być promowany bez LLM, np. explicit user statement.

### Etap LLM

Z LLM tylko dla przypadków nieoczywistych:

- konflikt z istniejącą pamięcią,
- powtarzający się wzorzec,
- kilka podobnych kandydatów,
- potrzeba zwięzłego scalenia,
- decyzja o supersession,
- klasyfikacja graph edges.

LLM nie powinien dostać surowych danych wrażliwych. Kontekst powinien być zredagowany tak jak compaction Track 2.

## Decyzje managera

Manager może wykonać:

| Decyzja | Znaczenie |
| --- | --- |
| `promote` | Utwórz wpis w `knowledge_entries`. |
| `supersede` | Utwórz nowy wpis i oznacz poprzedni jako zastąpiony. |
| `merge` | Połącz kilka kandydatów w jeden wpis. |
| `retain` | Zostaw kandydata na później, wydłuż lub skróć `retainUntil`. |
| `reject` | Odrzuć jako szum, duplikat, live state albo niepewne. |
| `expire` | Wygaszony kandydat bez wystarczających dowodów. |
| `archive` | Zmień status istniejącej wiedzy bez tworzenia następcy. |
| `reconcile` | Ponownie oceń wpis po zmianie outcome albo reżimu. |

Status końcowy kandydata:

- `promoted` - kandydat utworzył nowy `knowledge_entries`; `promotedKnowledgeId` wymagane.
- `merged` - kandydat został scalony z innym kandydatem albo istniejącą wiedzą; `mergedIntoCandidateId` albo `mergedIntoKnowledgeId` wymagane.
- `rejected` - kandydat nie powinien wracać w dual-trace ani promocji; `rejectReason` wymagane.
- `retained` - kandydat czeka na więcej evidence; `retainUntil` wymagane.
- `expired` - kandydat wygasł bez wystarczającego evidence.
- `failed` - manager nie zakończył decyzji z powodu błędu technicznego; retry zależy od statusu joba.

## Retrieval

`long_memory_search` powinien robić hybrid retrieval:

1. Vector search po `knowledge_entries`.
2. Lexical search po tytułach, tagach, summary i content.
3. Dual-trace candidate search po `memory_candidates` z `retrievalVisibility = "dual_trace"`.
4. Entity extraction z query.
5. Bounded graph expansion przez `memory_entry_entities` i `memory_edges`.
6. Reranking.
7. Filtrowanie przez `status`, `valid_until`, `source`, `confidence`, `pinned`, `maturityState`, `activationStrength`.
8. Formatowanie wyniku w `concise` albo `detailed`.

Domyślnie retrieval powinien zwracać tylko aktualne i aktywne fakty:

- `status = active`,
- nie historyczne/superseded,
- źródła `observed` i `user_confirmed` preferowane nad `inferred` i `hypothesis`,
- `probationary` widoczne jako soft guidance,
- `dual_trace` widoczne jako fresh signal, nie confirmed memory,
- expired entries widoczne tylko w trybie historycznym lub debug.

Reranking powinien brać pod uwagę:

- semantic similarity,
- lexical score,
- entity match,
- graph distance,
- confidence,
- source tier,
- recency,
- pinned,
- maturity state,
- activation strength,
- regime match,
- outcome freshness,
- czy wpis jest superseded,
- czy query wymaga historii.

Dual-trace results muszą mieć oddzielny typ wyniku:

```ts
type LongMemorySearchResult =
  | { source: "long_memory"; id: string; maturityState: string; activationStrength: number; summary: string }
  | { source: "memory_candidate"; id: string; freshness: "pending" | "not_consolidated"; summary: string };
```

Agent może używać `memory_candidate` jako ostrzeżenia i kontekstu, ale nie jako trwałej reguły.

## Supersession i status

Obecny model lifecycle w `knowledge_entries` jest wartościowy i powinien zostać.

Zasady:

- nie edytować starego faktu po cichu, jeśli zmieniło się znaczenie,
- dla zmiany znaczenia używać supersession,
- stary wpis zachować dla historii,
- nowy wpis dostaje `supersedes_id`,
- `knowledge_history` i `knowledge_lineage` łączymy w `long_memory_history`,
- manager powinien wymagać evidence dla supersession, szczególnie przy danych użytkownika.

Rubryka konfliktu:

- `supersede`: ten sam subject/predicate/scope, sprzeczna treść, mocniejsze albo nowsze evidence, brak istotnej różnicy reżimu/timeframe.
- `coexist`: lekcje są pozornie sprzeczne, ale dotyczą różnych reżimów, instrumentów, timeframe, strategii, wallet policy albo product type.
- `retain`: konflikt jest realny, ale nowe evidence jest za słabe; kandydat czeka na kolejne wystąpienie.
- `reject`: kandydat ma słabe źródło, wygląda jak memory poisoning, nie przechodzi point-in-time albo opiera się na danych live/transient.
- `archive`: stara wiedza nie jest fałszywa, ale nie powinna wpływać na aktualne decyzje.

Przy lekcjach tradingowych scope musi uwzględniać co najmniej:

- `productType`,
- `instrumentKey` albo klasa instrumentu,
- timeframe,
- market/regime tags,
- strategy/setup,
- direction/side,
- evidence outcome version.

## Źródła prawdy i prywatność

Nigdy nie zapisujemy do trwałej pamięci:

- seedów,
- private keys,
- tokenów,
- credentials,
- pełnych connection stringów,
- raw wallet balances,
- raw tx hashes jako treści trwałej wiedzy o użytkowniku,
- chwilowych cen,
- transient market state,
- provider signing state,
- danych, które powinny pozostać tylko w live state.

Manager może zapisać uogólnienie, jeśli jest użyteczne i bezpieczne:

- preferencja użytkownika,
- trwały kontekst projektu,
- decyzja architektoniczna,
- procedura,
- ograniczenie,
- znany błąd lub workaround,
- potwierdzony fakt o repo.

## Relacja do lokalnego portfolio

Manager może opcjonalnie inspectować portfolio/live state jako evidence, ale tylko w trybie read-only i z redakcją.

Portfolio może odpowiedzieć na pytanie:

> Czy kandydat jest nadal prawdziwy?

Nie powinno samo tworzyć embeddingów ani trwałych wpisów typu:

> Użytkownik ma X tokenów.

Wpisy długoterminowe powinny opisywać stabilne preferencje albo zasady, nie chwilowy stan portfela.

### Co już storujemy lokalnie

Vex ma już lokalny portfolio/trading ledger i nie należy go dublować w pamięci.

Istniejące źródła prawdy:

- `protocol_executions` - audit log każdego mutującego protocol tool call, sukcesów i porażek. Ma `tool_id`, `namespace`, `session_id`, zredagowane `params`/`result`, `success`, `trade_capture`, `external_refs`, `duration_ms`, `created_at`.
- `protocol_capture_items` - per-trade/per-position items dla batchy, np. kilka zamknięć w jednym execution. To lepsza kotwica niż sam execution, gdy jeden tool call produkuje wiele pozycji.
- `proj_activity` - business truth dla udanych mutacji: product type, trade side, chain, wallet, input/output tokeny i kwoty, USD/native valuation fields, fees, unit price, valuation source, benchmark/settlement assets, status capture, `position_key`, `instrument_key`, `external_refs`, `meta`.
- `proj_balances` - lokalna projekcja token balances per wallet/chain/token z `balance_raw`, `balance_usd`, `price_usd`, `decimals`, `synced_at`.
- `proj_portfolio_snapshots` - time-series snapshotów portfolio. Po migracji per-wallet ma `wallet_family`, `wallet_address`, `snapshot_group_id`, total USD, positions JSON, active chains, PnL vs previous.
- `proj_open_positions` - cross-protocol open/closed position state dla perps, predictions, orders i LP. Ma entry/current values, unrealized PnL, notional, fees, contracts, settlement asset, status, opened/closed timestamps.
- `proj_pnl_lots` - FIFO spot cost-basis lots. Buy tworzy lot, sell redukuje lot.
- `proj_pnl_matches` - canonical realized PnL ledger dla matched sells, z cost basis, proceeds i realized PnL w USD/native.
- `proj_lp_events` i `proj_lp_event_legs` - LP cashflow tracking dla deposit/withdraw/fees/refunds, z legs per token.
- `wallet_intents` - durable prepare/confirm lifecycle dla transferów, z `intent_id`, session ownership, statusami, expiry, `tx_hash` i strukturalnym failure reason.
- `portfolio` tool - read-only DB-backed surface nad tymi projekcjami: `summary`, `balances`, `snapshots`, `open_positions`, `closed_positions`, `lots`, `profits`, `unrealized`, `activity`, `executions`, `transactions`, `orders`, `bridges`, `lp_history`, `non_trading_history`.

Ważne: `protocol_executions` i `protocol_capture_items` są immutable audit trail, a projekcje (`proj_activity`, positions, lots, PnL, LP) są odtwarzalne przez `replayProjections`. To jest dokładnie właściwa baza dla memory quality harness i dla memory managera.

### Co pamięć ma zapisywać z trade'ów

Pamięć zapisuje learning artifact, nie ledger.

Dobre trwałe wspomnienie:

> Setup breakout po news-driven spike miał negatywny wynik w high-volatility regime; przy podobnych warunkach obniż confidence albo wymagaj dodatkowego potwierdzenia. Evidence: `activityId=...`, `pnlMatchId=...`, `executionId=...`.

Niedobre trwałe wspomnienie:

> Wallet miał saldo X, kupił Y po cenie Z, tx hash był H, aktualna wartość pozycji to V.

Dozwolone kotwice evidence:

- internal IDs: `executionId`, `captureItemId`, `activityId`, `pnlMatchId`, `pnlLotId`, `lpEventId`, `walletIntentId`,
- semantic keys: `instrumentKey`, `positionKey`,
- bounded external refs: `txHash`, `orderId`, `positionPubkey`, `conditionId`, ale tylko jako evidence metadata i najlepiej w `detailed` mode, nie jako embeddingowany content.

Manager może dereferencjować te ID do lokalnego portfolio, policzyć outcome score i zbudować lekcję. `long_memory_search` domyślnie zwraca lekcję i bezpieczne referencje, nie raw portfolio rows.

### Point-in-time dla lokalnego portfolio

Kandydat powiązany z wynikiem musi rozdzielać:

- `eventTime` - kiedy zdarzenie/trade faktycznie zaszło,
- `observedAt` - kiedy Vex je zobaczył,
- `recordedAt` - kiedy trafiło do lokalnego DB,
- `availableAtDecisionTime` - czy dana była dostępna agentowi w chwili decyzji.

Memory manager nie może tworzyć lekcji, która używa informacji niedostępnej w momencie decyzji. To zabezpiecza przed lookahead bias i fałszywą przyczynowością.

### Rekonsolidacja outcome

Outcome learning nie jest jednorazowy.

Problem:

- pozycja może być `open`,
- potem `closed`,
- potem `settled`,
- potem może zostać `invalidated` albo skorygowana przez replay/projection repair,
- lekcja promowana na podstawie wcześniejszego statusu może stać się za mocna, za słaba albo fałszywa.

Rozwiązanie:

- każdy `strategy_lesson`, `risk_lesson` i `trade_outcome` przechowuje `outcomeVersion`,
- ledger/projection update tworzy reconciliation wake dla powiązanych kandydatów i wpisów,
- manager ponownie dereferencjuje `evidenceRefs`,
- jeśli wynik się wzmocnił, zwiększa `activationStrength` albo `maturityState`,
- jeśli wynik osłabł, obniża `activationStrength`, oznacza `decayed` albo tworzy supersession,
- jeśli outcome został `invalidated`, wpis przechodzi do `archived` albo dostaje successor z `what_failed`,
- rekonsolidacja musi być idempotentna po `(entry_id, outcomeVersion)`.

Źródła wake:

- nowy `proj_pnl_matches`,
- zmiana `proj_open_positions.status`,
- nowy `proj_lp_events`,
- replay projections,
- wallet intent `executed`, `failed`, `audit_failed`,
- ręczna korekta/audit operatora.

### Zanik i reaktywacja

Decay nie powinien usuwać wartościowej wiedzy, tylko zmniejszać jej wpływ, gdy przestaje pasować do aktualnego kontekstu.

Polityka:

- explicit user preferences, decyzje architektoniczne i potwierdzone fakty mogą mieć `decayPolicy = "none"`,
- lekcje tradingowe domyślnie mają `decayPolicy = "regime_aware"` albo `"outcome_aware"`,
- decay obniża `activationStrength`, nie kasuje wpisu,
- wpis może się reaktywować, gdy wraca podobny market/regime tag,
- decayed wpis może być widoczny w `historical`/`detailed`, ale nie powinien dominować hot context,
- sprzeczne lekcje z różnych reżimów współistnieją, jeśli scope jest różny.

Przykład:

> Lekcja z high-volatility bear market może być słaba w normalnym reżimie, ale ponownie dostać boost, gdy retrieval wykryje podobny regime context.

## Implementacja etapami

### Etap 1 - replacement powierzchni tooli

Cel: zastąpić starą powierzchnię tooli nowymi nazwami i opisami, zanim aplikacja trafi do użytkowników.

Prace:

- dodać nowe nazwy do registry,
- usunąć stare nazwy z promptowego Tool Map,
- usunąć stare nazwy z LLM-visible OpenAI tools,
- zostawić adaptery tylko tam, gdzie chwilowo upraszczają refaktor wewnętrzny,
- dodać test, że OpenAI tools i Tool Map widzą spójny zestaw,
- dodać test, że `knowledge_write` nie jest widoczny dla zwykłego agenta,
- opisy tooli napisać tak, aby agent rozumiał różnicę między session i long memory.

Pliki do sprawdzenia:

- `src/vex-agent/tools/registry/knowledge.ts`,
- `src/vex-agent/tools/registry/memory.ts`,
- `src/vex-agent/tools/dispatcher.ts`,
- `src/vex-agent/engine/prompts/tool-usage.ts`,
- `src/vex-agent/engine/core/turn-loop-prompt-stack.ts`.

### Etap 2 - memory candidates

Cel: zablokować bezpośrednie zapisy trwałej wiedzy przez zwykłego agenta i zapewnić dual-trace dla świeżych wysokosygnałowych kandydatów.

Prace:

- migracja `memory_candidates`,
- repo CRUD,
- Zod schemas,
- redakcja i live-state exclusion,
- `long_memory_suggest`,
- statusy kandydatów,
- TTL zarządzany przez system,
- `retrievalVisibility` i `retrievalUntil`,
- `long_memory_search` czyta świeże `dual_trace` candidates jako `not_consolidated`,
- result typing odróżnia `source: "memory_candidate"` od `source: "long_memory"`.

`knowledge_write` nie zostaje jako zwykły agent-facing tool. Może zostać użyty tylko jako wewnętrzna operacja promocji albo zostać zastąpiony przez `long_memory_promote`.

### Etap 3 - memory manager worker

Cel: okresowa i zdarzeniowa konsolidacja.

Prace:

- worker podobny do `compact_jobs`,
- claim/heartbeat/retry/stale recovery,
- deterministic candidate filters,
- event-driven wake z lokalnego ledgeru,
- startup sweep i konserwacyjny sweep co około 3h,
- queue depth/status metrics,
- LLM decision call dla trudnych przypadków,
- promocja przez istniejące `insertEntry` i lifecycle,
- audit decisions.

Schedule:

- ledger events: execution/capture/activity/PnL/position/LP/wallet-intent changes,
- startup sweep,
- threshold based wake,
- co około 3h jako fallback maintenance.

### Etap 4 - trading outcome learning i point-in-time

Cel: uczyć się z lokalnego portfolio ledgeru bez dublowania portfolio w pamięci.

Prace:

- dodać `trade_outcome`, `strategy_lesson`, `risk_lesson` do kandydatów,
- dodać `evidenceRefs` wskazujące na `protocol_executions`, `protocol_capture_items`, `proj_activity`, `proj_pnl_matches`, `proj_pnl_lots`, `proj_lp_events`, `wallet_intents`,
- dodać deterministic outcome resolver dla memory managera,
- liczyć `importance` i `confidence` po stronie managera z lokalnych danych, nie z deklaracji agenta,
- wymagać point-in-time check przed promocją lekcji tradingowej,
- dodać reconciliation wake, gdy outcome zmieni status albo wersję,
- powiązać wpisy `knowledge_entries` z `outcomeVersion`,
- rekonsolidować `activationStrength`/status/supersession po zmianie outcome,
- nie embeddingować raw portfolio values, raw tx payloads ani pełnych wallet state.

### Etap 5 - probacja, activation strength i decay

Cel: świeżo promowane lekcje mają wpływ stopniowany, a stare lekcje nie zaśmiecają hot context.

Prace:

- dodać `maturityState`,
- dodać `activationStrength`,
- dodać `influenceScope`,
- dodać `decayPolicy`,
- dodać `regimeTags`, `lastReinforcedAt`, `nextReviewAt`,
- reranking uwzględnia activation i maturity,
- hot context nie podaje `probationary` jako twardych reguł wykonania,
- regime-aware decay i reaktywacja podobnych lekcji.

### Etap 6 - graph v1

Cel: dodać relacje bez uzależniania całego retrieval od graph.

Prace:

- migracje `memory_entities`, `memory_entry_entities`, `memory_edges`,
- entity normalization,
- graph edge validation,
- bounded expansion w `long_memory_search`,
- testy konfliktów, entity aliases i supersession.

### Etap 7 - hybrid retrieval i response formats

Cel: jedno wysokopoziomowe narzędzie retrieval dla agenta.

Prace:

- `responseFormat`,
- concise/detailed renderery,
- vector + lexical + entity + graph reranking,
- tryb `current`/`historical`/`all`,
- testy rankingu i filtrów.

### Etap 8 - UI/inspection

Cel: użytkownik i developer mogą zrozumieć, co pamięć robi.

Prace:

- sanitized memory inspector,
- pending candidates,
- promoted/rejected decisions,
- manual forget/archive,
- export/import z provenance,
- brak surowych sekretów i live state w rendererze.

Renderer może dostać tylko bezpieczne DTO przez preload/shared IPC, nigdy bezpośredni dostęp do DB.

## Minimalny zestaw testów

Unit:

- walidacja `long_memory_suggest`,
- redakcja sekretów,
- odrzucenie live state,
- TTL kandydatów,
- status transitions,
- widoczność nowych tooli i brak starego agent-facing `knowledge_write`,
- walidacja `evidenceRefs` dla lokalnych portfolio/trade ids,
- `retrievalVisibility = "dual_trace"` tylko dla wysokosygnałowych kandydatów,
- odrzucenie kandydata tradingowego bez point-in-time metadata.

Repo/integration:

- insert/list/update candidates,
- claim race managera,
- heartbeat i stale recovery,
- retry i permanent failure,
- promote candidate do `knowledge_entries`,
- supersede race,
- event-driven wake po `proj_pnl_matches`, zmianie `proj_open_positions.status`, `proj_lp_events`, `wallet_intents`,
- dereferencja `executionId`/`captureItemId`/`activityId`/`pnlMatchId` do lokalnego ledgeru,
- outcome resolver nie duplikuje raw portfolio values w embedding content,
- reconciliation jest idempotentne po `(entry_id, outcomeVersion)`,
- point-in-time check blokuje lookahead bias,
- `maturityState` i `activationStrength` wpływają na reranking,
- regime-aware decay obniża influence bez kasowania wpisu,
- pgvector filter po `embedding_model` i `embedding_dim`,
- graph edge creation.

Engine:

- agent zgłasza candidate,
- manager promuje candidate,
- manager odrzuca live wallet state,
- manager promuje `strategy_lesson` tylko z poprawnym evidence i outcome,
- `long_memory_search` zwraca świeży `memory_candidate` jako `not_consolidated`,
- hot context nie traktuje `probationary` jako twardej reguły wykonania,
- zmiana outcome budzi rekonsolidację powiązanej lekcji,
- manager superseduje stary fakt,
- `long_memory_search` zwraca aktualny fakt zamiast superseded.

Quality harness:

- replay z `protocol_executions` i `protocol_capture_items`,
- porównanie lekcji z realized PnL / risk-adjusted outcome bez użycia danych z przyszłości,
- retention precision dla kandydatów tradingowych,
- contradiction rate między świeżą lekcją a aktywną pamięcią,
- retrieval hit@k dla pytań o podobne setupy.

UI/IPC, jeśli dodamy inspector:

- renderer widzi tylko sanitized DTO,
- brak raw wallet/DB/secrets,
- boundary schemas Zod.

## Proponowane komendy weryfikacji

Po implementacji etapów:

```bash
pnpm test -- src/__tests__/vex-agent/tools/registry.test.ts
pnpm test -- src/__tests__/vex-agent/tools/dispatcher-knowledge-recall.test.ts
pnpm test:integration -- src/__tests__/integration/repos/session-memories.int.test.ts src/__tests__/integration/repos/compact-jobs.int.test.ts
pnpm test:integration -- src/__tests__/integration/engine/compact-service.int.test.ts
pnpm typecheck
```

Dokładne komendy trzeba dobrać po sprawdzeniu aktualnych `package.json` i istniejących testów.

## Otwarte decyzje

1. Czy `memory_candidates` ma być osobną kolejką, czy użyć generycznego job/outbox pattern podobnego do `compact_jobs`?
2. Czy użytkownik ma widzieć pending candidates w UI od pierwszej wersji, czy dopiero po stabilizacji managera?
3. Jak traktować `sessions.deleted_at`: czy soft-delete sesji ma blokować użycie jej jako evidence?
4. Jak długo trzymać rejected/expired candidates dla audytu?
5. Jak długo trzymać `session_memories`, skoro dziś nie mają TTL ani retention policy?
6. Czy `knowledge/export.ts` poprawnie round-tripuje `source`; trzeba to zweryfikować przed zależnością od export/import.

## Decyzje projektowe zamknięte

- `inferred` i `hypothesis` nie wchodzą do hot context jako twarde reguły; mogą być widoczne tylko jako soft/historical/debug albo po explicit promotion.
- Dual-trace jest wymagany przed wydaniem, bo inaczej istnieje read-after-write gap między sesjami.
- Memory manager ma event-driven wake z lokalnego ledgeru; 3h to maintenance fallback, nie podstawowy rytm tradingowej konsolidacji.
- Lekcje tradingowe wymagają point-in-time metadata i evidence refs do lokalnego ledgeru.
- Świeżo promowane lekcje startują jako `probationary`, z `activationStrength < 1`.
- Decay jest influence decay, nie automatyczne kasowanie wiedzy.
- Memory poisoning jest decyzją bezpieczeństwa, nie otwartym pytaniem: słabe źródła, prompt-injection-like claims i niezweryfikowane `inferred/hypothesis` nie mogą sterować decyzjami tradingowymi.

## Rekomendacja końcowa

Tak: pomysł z odciążeniem agenta głównego i okresowym `memory_managerem` jest lepszy od obecnego modelu bezpośredniego `knowledge_write`, a przy braku istniejących użytkowników powinien zastąpić obecny system przed wydaniem.

Najbezpieczniejsza wersja dla Vex:

- agent widzi `long_memory_suggest`, nie `knowledge_write`,
- kandydaci mają systemowy TTL,
- manager konsoliduje zdarzeniowo po zmianach ledgeru, a co około 3h wykonuje tylko fallback maintenance sweep,
- `long_memory_search` widzi świeże wysokosygnałowe kandydaty przez dual-trace,
- promowane lekcje mają probację, activation strength i regime-aware decay,
- outcome changes budzą rekonsolidację powiązanych lekcji,
- trwała wiedza nadal trafia do `knowledge_entries`,
- graph jest dodatkiem do retrieval, nie nowym źródłem prawdy,
- retrieval jest jednym wysokopoziomowym `long_memory_search`,
- stare tool'e nie są publicznie wspierane; ewentualne adaptery są tylko tymczasowe i wewnętrzne,
- live wallet/portfolio state nigdy nie jest trwałą pamięcią.
