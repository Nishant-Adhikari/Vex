# Vex memory system - opis prostym jezykiem

Data: 2026-06-11
Zakres: opis dzialajacego systemu memory na podstawie eksploracji kodu i raportow agentow.

## 1. Najkrotszy model mentalny

Vex ma trzy rozne warstwy, ktore latwo pomylic:

1. `Historia sesji` - surowy transcript w `messages`. Tu trafia user, assistant i wyniki tooli.
2. `Session memory` - streszczenia tej samej sesji po kompakcji. To nie jest pamiec miedzy sesjami.
3. `Long-term memory` - trwale lekcje miedzy sesjami. Agent tylko proponuje zapis, a `memory_manager` decyduje.

Najwazniejsze rozroznienie: session memory odpowiada na pytanie "co juz robilismy w tej sesji?", a long-term memory odpowiada na pytanie "czego nauczylismy sie w poprzednich sesjach?".

## 2. Co dzieje sie na kazda ture

Na poczatku tury engine odtwarza stan sesji i buduje prompt dla modelu.

1. User wysyla wiadomosc.
2. Engine zapisuje wiadomosc w historii sesji (`messages`).
3. Engine hydratuje sesje: bierze live messages, summary i dokumenty zaladowane przez toole.
4. `memory.getTurnContext()` robi jeden pre-inference odczyt pamieci.
5. Z tego powstaje sekcja `# Memory` w promptcie.
6. Ta sama informacja decyduje, czy agent widzi `session_memory_search`.
7. Model dostaje prompt, moze wywolac toole, a wyniki tooli wracaja do historii.

Kluczowe pliki:

- `src/vex-agent/memory/turn-context.ts`
- `src/vex-agent/engine/prompts/memory-section.ts`
- `src/vex-agent/engine/core/turn-loop-prompt-stack.ts`
- `src/vex-agent/engine/core/turn.ts`

`# Memory` daje modelowi routing:

- aktualne saldo, ceny, gas, pozycje i quote'y -> live tools;
- cos z tej samej rozmowy/misji -> `session_memory_search`;
- lekcje i preferencje z poprzednich sesji -> `long_memory_search`.

## 3. Session memory: pamiec tej jednej sesji

Session memory nie powstaje przy kazdej wiadomosci. Powstaje po kompakcji.

Workflow:

1. Kontekst robi sie duzy.
2. Agent albo runtime uzywa `compact_now`.
3. `executeCompactNow()` zapisuje rolling summary, podbija `checkpoint_generation`, archiwizuje stary prefix rozmowy i tworzy `compact_job`.
4. Stara historia znika z live promptu, ale zostaje w `messages_archive`.
5. Worker Track 2 bierze archived prefix.
6. Worker wola chunker LLM.
7. Wynik chunkera jest redagowany: sekrety i identyfikatory sa maskowane albo odrzucane.
8. Live-state jest odrzucany, bo pamiec nie ma przechowywac chwilowych sald/cen/kwot.
9. Chunk jest renderowany do `body_md`, embedowany lokalnie i zapisany w `session_memories`.
10. Od tego momentu agent moze uzyc `session_memory_search`.

Tabela `session_memories` trzyma:

- `session_id` i `checkpoint_generation`;
- temat chunku;
- sekcje narracyjne: co sie stalo, co agent zrobil, czego probowal;
- `outstanding_items`, czyli otwarte watki do zamkniecia;
- `body_md`, czyli gotowy tekst do recall;
- embedding, model embeddingu i wymiar;
- status i dedupe hash.

Wazny detal: recall po session memory jest zawsze scoped po `session_id`. Nie ma mieszania sesji.

Kluczowe pliki:

- `src/vex-agent/db/migrations/016_session_memories.sql`
- `src/vex-agent/engine/compact-jobs/service.ts`
- `src/vex-agent/engine/compact-jobs/executor.ts`
- `src/vex-agent/engine/compact-jobs/chunk-processing.ts`
- `src/vex-agent/db/repos/session-memories/recall.ts`
- `src/vex-agent/tools/internal/session-memory/search.ts`

## 4. Long-term memory: trwale lekcje miedzy sesjami

Long-term memory ma bardziej konserwatywny przeplyw, bo to jest wiedza, ktora bedzie wplywac na przyszle sesje.

Agent nie pisze bezposrednio do `knowledge_entries`.

Workflow zapisu:

1. Agent znajduje lekcje, preferencje albo stabilny fakt.
2. Agent wola `long_memory_suggest`.
3. Handler waliduje input przez Zod.
4. Handler redaguje title, summary, content, tags i entities.
5. Handler odrzuca sekrety i live-state.
6. Handler liczy `content_hash` z oczyszczonego tekstu.
7. Handler sprawdza, czy taka lekcja nie istnieje juz w long memory albo terminalnych kandydatach.
8. Handler robi embedding po redakcji.
9. Handler zapisuje `memory_candidates`.
10. Handler enqueueuje `memory_jobs`.
11. Background worker `memory_manager` bierze kandydata.
12. Manager robi etap deterministyczny: duplikaty, konflikty, evidence, recurrence, live-state rescan.
13. Jesli trzeba, manager wola judge LLM.
14. Manager decyduje: `promote`, `supersede`, `retain`, `reject` albo `expire`.
15. Tylko przy promocji albo supersede powstaje wpis w `knowledge_entries`.
16. Decyzja trafia do append-only `memory_decisions`.

Kluczowy invariant: memory jest doradcza. `influence_scope` jest ograniczony do `advisory` albo `retrieval_boost`. Pamiec nie moze byc zrodlem prawdy dla podpisywania, approvali, sizingu ani polityki walleta.

Kluczowe pliki:

- `src/vex-agent/tools/internal/long-memory/suggest.ts`
- `src/vex-agent/memory/schema/memory-candidate.ts`
- `src/vex-agent/engine/memory-manager/executor.ts`
- `src/vex-agent/memory/manager/consolidate.ts`
- `src/vex-agent/memory/manager/deterministic-stage.ts`
- `src/vex-agent/memory/manager/promote.ts`
- `src/vex-agent/db/migrations/001_initial.sql`

## 5. Retrieval: jak agent cos sobie przypomina

Sa dwa glowne recall flows.

### Session recall

Agent wola `session_memory_search`.

Co sie dzieje:

1. Handler waliduje `query` i `k`.
2. Sprawdza statystyki sesji.
3. Jesli nie ma chunkow, zwraca empty-store bez embedding call.
4. Jesli sa chunki, robi `embedQuery(query)`.
5. Repo robi cosine search po `session_memories`.
6. Query jest filtrowane przez `session_id`, `status='active'`, `embedding_model` i `embedding_dim`.
7. Wyniki wracaja jako tekstowe chunki z `body_md`.

Limity:

- `k` jest clampowane do 5.
- recall jest tylko w tej sesji.
- tool jest ukryty, dopoki sesja nie ma aktywnego session memory.

### Long-term recall

Agent wola `long_memory_search`.

Co sie dzieje:

1. Handler waliduje `query`, `k`, `kind`, `response_format`, `include_candidates`, `expand_graph`.
2. Robi embedding zapytania.
3. Szuka w `knowledge_entries`.
4. Opcjonalnie miesza swieze `memory_candidates` jako `notConsolidated`.
5. Wyniki sa rankowane.
6. Kandydaci sa de-weighted: sa miekkimi sygnalami, nie faktami.
7. Opcjonalnie wynik jest rozszerzany przez graf encji.
8. Odpowiedz jest inline-only, z capami.

Limity:

- default `k=8`, max `k=15`;
- inline cap 10 wynikow;
- detailed ma cap okolo 50 KB;
- aktywne/non-expired wpisy sa normalna sciezka;
- graph expansion jest pomocniczy i fail-open.

Kluczowe pliki:

- `src/vex-agent/tools/internal/long-memory/search.ts`
- `src/vex-agent/memory/schema/long-memory-search.ts`
- `src/vex-agent/memory/long-memory-retrieval-policy.ts`
- `src/vex-agent/db/repos/knowledge/recall.ts`
- `src/vex-agent/db/repos/memory-candidates/index.ts`

## 6. Tool'e dodane dla pamieci

| Tool | Warstwa | Co robi | Kiedy uzywac | Najwazniejsze ograniczenia |
| --- | --- | --- | --- | --- |
| `compact_now` | kompakcja | Archiwizuje prefix rozmowy i odpala Track 2 | Gdy kontekst jest pod presja | Track 2 jest async, wiec session memory pojawia sie pozniej |
| `session_memory_search` | session memory | Szuka semantycznie w chunkach tej sesji | Gdy agent chce przypomniec sobie cos z obecnej misji | Tylko `session_id`, max `k=5`, widoczne dopiero gdy sa chunki |
| `session_memory_resolve_item` | session memory | Zamyka jeden outstanding item w chunku | Gdy otwarty follow-up zostal rozwiazany | Sprawdza wlascicielstwo sesji, redaguje note, uzywa row locka |
| `long_memory_suggest` | long-term write door | Tworzy kandydata do long memory | Po waznej lekcji, preferencji, strategii, stabilnym fakcie | Nie zapisuje finalnej pamieci; odrzuca sekrety/live-state; manager decyduje |
| `long_memory_search` | long-term recall | Szuka w trwalej pamieci i swiezych kandydatach | Gdy potrzebna wiedza z poprzednich sesji | Kandydaci sa soft hints; max `k=15`; cap inline |
| `long_memory_get` | long-term recall | Pobiera pelny wpis po ID | Po search, gdy potrzeba pelnej tresci | Tylko aktywne wpisy; superseded kieruje do aktualnego ID |
| `long_memory_history` | long-term recall | Pokazuje chain wersji i reinforcement | Gdy trzeba sprawdzic jak lekcja ewoluowala | Metadata bez pelnego contentu |

Rejestracja:

- `src/vex-agent/tools/registry/session-memory.ts`
- `src/vex-agent/tools/registry/long-memory.ts`
- `src/vex-agent/tools/registry/lookup.ts`
- `src/vex-agent/tools/registry/tool-map.ts`
- `src/vex-agent/tools/dispatcher/internal-loaders.ts`
- `src/vex-agent/tools/registry/visibility.ts`

## 7. Przyklad sesji A: agent uczy sie lekcji i robi compact

Scenariusz: user prosi o sprawdzenie Kyber na Base, a w trakcie agent odkrywa, ze quote timeoutuje przy burstach.

### Krok 1: live praca

User:

```text
Sprawdz Kyber na Base. Wczesniej mial timeouty, zobacz czy da sie to obejsc.
```

Agent uzywa live tools. Wyniki tooli trafiaja do `messages` jako tool results. To nadal nie jest memory, tylko zwykla historia.

### Krok 2: agent znajduje lekcje

Agent dochodzi do wniosku:

```text
Kyber na Base timeoutuje przy burstach. Przy takim patternie lepiej uzyc backoff i fallback route.
```

To jest dobry kandydat na long-term memory, bo nie jest chwilowym saldem ani aktualna cena. To jest lekcja, ktora moze pomoc w przyszlosci.

Agent wola:

```text
long_memory_suggest({
  kind: "protocol_routing_lesson",
  title: "Kyber Base quote bursts need backoff and fallback route",
  summary: "When Kyber on Base times out during quote bursts, retry with backoff and prepare a fallback route instead of treating the first timeout as final.",
  tags: ["kyber", "base", "routing", "timeout"],
  confidence: 0.8,
  importance: 7
})
```

System:

1. waliduje schema;
2. redaguje tekst;
3. odrzucilby sekret lub live-state;
4. robi embedding;
5. zapisuje `memory_candidates`;
6. enqueueuje `memory_jobs`.

Agent dostaje `candidateId`, ale to jeszcze nie znaczy "zapamietane na stale".

### Krok 3: manager decyduje w tle

`memory_manager` bierze kandydata.

Moze zrobic:

- `promote` - lekcja trafia do `knowledge_entries`;
- `supersede` - lekcja zastapi starsza wersje;
- `retain` - zostaje jako ograniczony, swiezy sygnal;
- `reject` - odpada, np. jako duplikat albo live-state;
- `expire` - wygasa.

Jesli promuje, wpis zaczyna jako `probationary`, `advisory`, z activation mniejsza niz pelna. Dopiero kolejne potwierdzenia moga go wzmacniac.

### Krok 4: rozmowa robi sie dluga

Agent wola `compact_now`.

System:

1. zapisuje rolling summary;
2. podbija `checkpoint_generation`;
3. przenosi stary prefix do `messages_archive`;
4. tworzy `compact_job`;
5. w kolejnych turach daje resume packet, zanim Track 2 skonczy.

Track 2 pozniej:

1. bierze archived prefix;
2. wola chunker LLM;
3. redaguje i odrzuca live-state;
4. robi `body_md`;
5. embeduje;
6. zapisuje chunk w `session_memories`.

## 8. Ta sama sesja pozniej

User:

```text
Co juz probowalismy z Kyber w tej misji?
```

Prompt widzi, ze sa session memories. Agent moze uzyc:

```text
session_memory_search({
  query: "previous attempts to debug Kyber quote timeout on Base and what we learned",
  k: 5
})
```

System robi semantic recall tylko w tej sesji. Wynik wraca jako chunk `body_md`, np. z sekcjami:

- what happened;
- what I did;
- what I tried;
- outstanding items.

Jesli chunk mial outstanding item, a agent go juz rozwiazal, moze uzyc:

```text
session_memory_resolve_item({
  memory_id: 123,
  outstanding_item_id: "uuid-v4",
  resolution_note: "Fallback route confirmed; no further Kyber retry needed."
})
```

System redaguje note, aktualizuje JSONB, renderuje nowe `body_md` i probuje re-embedowac chunk.

## 9. Nowa sesja B: agent korzysta z long-term memory

User:

```text
Mam podobny timeout na Kyber na Base. Co robic?
```

To jest nowa sesja, wiec `session_memory_search` ze starej sesji nie pomoze. Agent uzywa:

```text
long_memory_search({
  query: "Kyber Base quote timeout routing fallback lesson",
  k: 8
})
```

System:

1. embeduje query;
2. szuka w `knowledge_entries`;
3. moze dolozyc swieze `memory_candidates` jako `notConsolidated`;
4. rankuje wyniki;
5. zwraca concise liste.

Jesli agent chce pelna tresc wpisu:

```text
long_memory_get({ id: 42 })
```

`long_memory_get` zwraca pelny wpis i dodatkowo laduje `content_md` do `context.loadedDocuments`. Nastepny prompt widzi to w `# Loaded Content`.

Jesli agent chce zobaczyc, czy lekcja byla zastapiona albo wzmacniana:

```text
long_memory_history({ id: 42 })
```

## 10. Co jest zabezpieczone

System ma kilka twardych zabezpieczen:

- renderer nie ma dostepu do DB, embeddings, Docker, walleta ani signing authority;
- memory writes sa po stronie agenta/main/local runtime, nie renderera;
- `long_memory_suggest` odrzuca sekrety i live-state przed embeddingiem;
- `promote()` jeszcze raz sprawdza redakcje i live-state przed zapisem do `knowledge_entries`;
- provider wallet/private keys nie sa czescia memory;
- memory nie jest polityka wykonania, tylko advisory;
- embeddings sa traktowane jako wrazliwe, bo moga zdradzac tresc uzytkownika;
- `session_memory_search` nie wychodzi poza `session_id`;
- query po pgvector filtruje `embedding_model` i `embedding_dim`, zeby nie mieszac modeli/wymiarow;
- decyzje managera sa audytowane w `memory_decisions`.

## 11. Co moze byc mylace

- `long_memory_suggest` nie znaczy "zapamietaj natychmiast". To tylko propozycja.
- `session_memory_search` nie widzi poprzednich sesji.
- `long_memory_search` moze zwrocic `memory_candidate`; to jest swiezy, nieskonsolidowany sygnal, nie fakt.
- Po `compact_now` session memory nie pojawia sie od razu, bo Track 2 dziala asynchronicznie.
- Jesli embedding service nie dziala, recall albo zapis kandydatow moze sie nie udac.
- Jesli `OPENROUTER_API_KEY` albo `AGENT_MODEL` nie sa ustawione, worker chunkera albo memory manager nie powinien spalac retry budgetu, tylko czekac.
- Graf wiedzy wzbogaca wyniki, ale nie jest twardym zrodlem prawdy.

## 12. Mapa plikow

Prompt i turn context:

- `src/vex-agent/memory/turn-context.ts`
- `src/vex-agent/engine/prompts/memory-section.ts`
- `src/vex-agent/engine/prompts/index.ts`
- `src/vex-agent/engine/core/turn-loop-prompt-stack.ts`

Session memory:

- `src/vex-agent/db/migrations/016_session_memories.sql`
- `src/vex-agent/db/repos/session-memories/index.ts`
- `src/vex-agent/db/repos/session-memories/recall.ts`
- `src/vex-agent/db/repos/session-memories/resolution.ts`
- `src/vex-agent/db/repos/session-memories/stats.ts`
- `src/vex-agent/engine/compact-jobs/service.ts`
- `src/vex-agent/engine/compact-jobs/executor.ts`
- `src/vex-agent/engine/compact-jobs/chunk-processing.ts`

Long-term memory:

- `src/vex-agent/db/migrations/001_initial.sql`
- `src/vex-agent/db/repos/memory-candidates/index.ts`
- `src/vex-agent/db/repos/memory-jobs/index.ts`
- `src/vex-agent/db/repos/memory-decisions/index.ts`
- `src/vex-agent/db/repos/knowledge/recall.ts`
- `src/vex-agent/memory/manager/consolidate.ts`
- `src/vex-agent/memory/manager/deterministic-stage.ts`
- `src/vex-agent/memory/manager/promote.ts`
- `src/vex-agent/engine/memory-manager/executor.ts`

Tool surface:

- `src/vex-agent/tools/registry/session-memory.ts`
- `src/vex-agent/tools/registry/long-memory.ts`
- `src/vex-agent/tools/internal/session-memory/search.ts`
- `src/vex-agent/tools/internal/session-memory/resolve-item.ts`
- `src/vex-agent/tools/internal/long-memory/suggest.ts`
- `src/vex-agent/tools/internal/long-memory/search.ts`
- `src/vex-agent/tools/internal/long-memory/get.ts`
- `src/vex-agent/tools/internal/long-memory/history.ts`

## 13. Jednozdaniowe podsumowanie

Vex nie "pamieta" przez wrzucanie calej historii do promptu; trzyma live transcript tylko na biezaco, starsza sesje kompresuje do session memory, a trwale lekcje zapisuje przez kontrolowany pipeline `suggest -> candidate -> manager decision -> knowledge_entries`.
