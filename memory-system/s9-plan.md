# S9 — CUTOVER: usunięcie legacy `knowledge_*`/`memory_*` (1:1, zero dead code)

Status: DRAFT (czeka: Codex plan-gate `harness-memory-s9`)
Źródła prawdy: `audit/memory-cutover-manifest.md` (33-tokenowy gate, slices) + recon driftu 4-soczewkowy (2026-06-11; manifest ~80% aktualny, 3 klasy driftu po S4–S8/STRUCTURE+CACHE) + `memory-system-v2.md` §7/§9-S9 (linie 137-142, 256-260, 292-293).

## §0. Decyzje właściciela / rozstrzygnięcia wstępne

- **Panel wiedzy: REWIRE read-only** (decyzja 2026-06-11: „agent powinien wiedzieć, co ma w głowie") — nowy kanał listujący long-memory zastępuje stary `vex:knowledge:list`; mutacje (Archive/Invalidate) ZNIKAJĄ bez zamiennika (master-plan:137 — lifecycle wyłącznie przez managera). Pełny inspektor (kandydaci/decyzje/joby) = S10.
- **`updateStatus` w repo knowledge: DELETE** (po S9 zero konsumentów — stary tool i IPC umierają, manager używa applyMaturityTransition/supersedeEntry/invalidateEntryOnReconcile; deletion discipline).
- **`recall-seed.ts`: DELETE** (+testy) — production-dead (zero importerów poza testami; manifestowe KEEP-RENAME zdezaktualizowane).
- **Lokalizacja ToolDefs po rename: `tools/registry/`** (konwencja — long-memory.ts tam mieszka; manifestowe „w memory/*" odrzucone jako niespójne).
- **Stare wiersze transkryptów** (persisted `memory_recall` placeholdery + historyczne recall-rows): po rename degradują przy odczycie do generic `tool_call` — ZAAKCEPTOWANE (apka pre-release, dane dev; zero-alias > kosmetyka historii). Odnotowane jako known-limitation.
- **Scripts export/import/reembed: S10** — w S9 tylko edycje komentarzy/stringów trafiających w gate (reembed:211); funkcjonalny round-trip zostaje na S10.

## §1. Decyzje projektowe (D-*)

### D-PRE — neutralny split `knowledge/policy.ts` (pre-S9 blocker z master-planu:138)

- `TOOL_OUTPUT_OVERFLOW_BYTES` + `TOOL_OUTPUT_TTL_MIN` → NOWY `engine/core/tool-output-policy.ts` (neutralny, engine-owned). Konsumenci przepięci: `engine/core/tool-output-overflow.ts:6-7`, `engine/wake/blob-refresh.ts:14`, `tools/internal/tool-output-read.ts:26`.
- `knowledge/policy.ts` ZOSTAJE jako polityka long-memory. **ZOSTAJĄ** (zweryfikowani konsumenci po stronie v2): `ACTIVE_KNOWLEDGE_*`, `KNOWN_KINDS_LIMIT`, `RECALL_MAX_K`, `isValidKind`, `MAX_KIND_LENGTH`, typ `KnowledgeStatus`. **MARTWE-PO-S9 (pełna partycja po review R1 — gate-reviewer wykazał, że pierwotna lista była za krótka):** `clampRecallK`, `isKnowledgeStatus`, `isUpdatableKnowledgeStatus`, **`computeValidUntil`** (jedyni konsumenci = ginące write.ts:26,76/supersede.ts:32,97; promote.ts przekazuje validUntil pass-through :169,:276), `clampTtlHours`, `DEFAULT_TTL_HOURS`, `MIN_TTL_HOURS`, `MAX_TTL_HOURS`, `RECALL_DEFAULT_K`, `RECALL_INLINE_CAP`, `RECALL_INLINE_CHARS_CAP` (long-memory ma własne LONG_MEMORY_INLINE_* w retrieval-policy:43-48), `RECALL_CACHE_TTL_MIN` (jedyny konsument = kasowany recall-cache.ts:19) oraz typ `UpdatableKnowledgeStatus` (crud.ts:33,580 updateStatus + ginący handler). Docstring `TOOL_OUTPUT_TTL_MIN` („Matches RECALL_CACHE_TTL_MIN", :137-141) przeredagowany przy przenosinach. `policy.test.ts` traci sekcje martwych eksportów; testy TOOL_OUTPUT_* wędrują do nowego domu testowego dla `engine/core/tool-output-policy.ts`.

### D-DELETE — twarde usunięcia (agent, ~1.1k LOC src + ~2.2k testów)

- `tools/registry/knowledge.ts` (8 ToolDefs), `tools/internal/knowledge.ts` (barrel) + `tools/internal/knowledge/{write,supersede,recall,get,update-status,lineage,history}.ts`.
- **`tools/internal/knowledge/params.ts` → RELOKACJA** do `tools/internal/long-memory/params.ts` (readStringArray/readObject konsumowane przez `long-memory/suggest.ts:56`; `readClampedNumber` umiera, jeśli bez innych konsumentów).
- `db/repos/recall-cache.ts` + test; **tabela `recall_cache_entries`**: usunięcie bloku z `001_initial.sql:218-224` + NOWA migracja `033_drop_recall_cache.sql` (`DROP TABLE IF EXISTS recall_cache_entries;`) — świeża baza: 001 bez tabeli, 033 no-op; zainicjalizowana: 033 sprząta. Lustro auto (copy-migrations).
- `db/repos/knowledge`: `recallTopK` (jedyny konsument = ginący recall handler; UWAGA nazewnicza: session-memories ma WŁASNY recallTopK — nie ruszać), `listHistory`+`clampHistoryLimit`, `updateStatus` (§0). `knowledge/recall-payload.ts` (splitInlineAndOverflow), `knowledge/ranking.ts#rerank` (scoreRecallCandidate + typ RecallCandidate ZOSTAJĄ — long-memory/search:42 + types:312).
- `engine/core/recall-seed.ts` + testy.
- Testy hard-delete: internal/knowledge.test + knowledge-supersede.test + suites dir (948 LOC), dispatcher-knowledge-{recall,other}.test, recall-cache.test.

### D-RENAME — warstwa session-memory (agent)

- ToolDefs: `memory_recall`→`session_memory_search`, `mark_outstanding_resolved`→`session_memory_resolve_item` (registry/memory.ts → rename eksportu `MEMORY_TOOLS`→`SESSION_MEMORY_TOOLS`; visibility `requiresSessionMemory` bez zmian mechaniki).
- Handlery: `handleMemoryRecall`→`handleSessionMemorySearch`, `handleMarkOutstandingResolved`→`handleSessionMemoryResolveItem` (pliki: `tools/internal/session-memory/{search,resolve-item}.ts` — katalog `memory/` znika z tools/internal). **Event-namespaces**: `memory_recall.*`→`session_memory_search.*`, `mark_outstanding_resolved.*`→`session_memory_resolve_item.*` (+ output-stringi, prefiksy błędów Zod). Telemetria re-pin.
- Triple-point ATOMOWO: `registry/lookup.ts` (spread out KNOWLEDGE_TOOLS, rename MEMORY), `dispatcher/internal-loaders.ts` (−8 starych, rename 2), `registry/tool-map.ts` (kategorie „Knowledge recall/history" i „Knowledge write/lifecycle" ZNIKAJĄ; „Session memory" dostaje nowe nazwy) — pinowane przez name-agnostic registry-tool-map.test (przechodzi za darmo) + registry-completeness.

### D-PROMPTS — przepisanie nauczania pamięci na v2 (agent)

STRUCTURE+CACHE celowo niósł stare teksty verbatim „żeby S9 ciął jednym diffem w jednym pliku" — TERAZ ten diff:
- `prompts/base.ts:43-52` (# Memory and self-learning): substraty v2 — `long_memory_suggest` (propozycje trwałych lekcji; manager decyduje o promocji), `long_memory_search/get/history` (recall cross-session), `session_memory_search` (narracja tej sesji).
- `prompts/tool-usage.ts`: :22 przykład, :84-88 Memory Layers (linia :89 long_memory_suggest ZOSTAJE i wchłania okolicę), :111-114 Learning Protocol → v2 (suggest zamiast write/supersede/update_status; lifecycle = manager, agent nie zarządza statusami).
- `prompts/memory-section.ts` (7 miejsc): linie stanu → `session_memory_search` / `long_memory_search`; empty-state → „Use long_memory_suggest …"; footer Active-Knowledge → `long_memory_search/get/history`; routing 4-linijkowy → v2 (linia knowledge_recall ZNIKA — long_memory_search:231 już jest); **nagłówek „# Active Knowledge" → „# Active Memory"** (token 'Active Knowledge' jest w gate; analogicznie komentarze w long-memory-suggest-policy).
- Persisted-copy: `compact-jobs/giant-tool.ts:8,20`, `service.ts:175`, `compact/now.ts:106` → `session_memory_search` (+ asercja integration compact-service:246,290,297 razem).
- Komentarze/copy sweep (gate-driven, pełna lista z recon): hydrate.ts:6,34; prompts/index.ts:156,216-217; taxonomy:20; risk-level:10; registry/plan.ts:12; registry/protocol.ts:23; internal/types.ts:24,64,68; visibility.ts:47-55; tools/types.ts:50; runner/agent.ts:104 + mission-run.ts:136,254; session-memory-policy.ts:4,45,48,95; long-memory-source-policy.ts:41; schema/long-memory-search.ts:19; turn-context.ts:11-12; registry/long-memory.ts:18; internal/long-memory/get.ts:6 + suggest.ts:233; session-memories/{recall.ts:6, embeddings.ts}; scripts/knowledge-reembed.ts:211; nagłówki migracji 006/016/018 (komentarze SQL — bez zmian DDL).

### D-VEXAPP — cutover strony aplikacji

- **DELETE**: `main/ipc/knowledge.ts`, `main/database/knowledge-db.ts`, `shared/schemas/knowledge.ts`, `preload/agent/knowledge.ts`, `shared/types/bridge/agent/knowledge.ts`, `renderer/lib/api/knowledge.ts`, `KnowledgeSection.tsx`; `CH.knowledge.*` z channels; kody `knowledge.not_found/invalid_state` + domena `knowledge` z result/codes (po weryfikacji zero innych użyć); cały łańcuch updateStatus. Testy: KnowledgePanel.test (przepisany), KnowledgeButton.test, knowledge-update-status-ipc.test, knowledge-db.test, schemas/knowledge.test (~852 LOC).
- **NEW (rewire read-only)**: kanał `CH.longMemory.list = "vex:longMemory:list"`; `shared/schemas/long-memory.ts` (DTO sanitized: id/kind/title/summary/tags/confidence/status/source/maturityState/pinned/createdAt/updatedAt — BEZ content_md/source_refs/embeddings; statusy = active/superseded/invalidated/archived jak w DB; input: limit≤500 + opcjonalny filtr statusu); `main/database/long-memory-db.ts` (wzorzec own-pg.Client, `FROM knowledge_entries` — nazwa tabeli dozwolona w SQL); `main/ipc/long-memory.ts`; preload `agent/long-memory.ts` + bridge type; `renderer/lib/api/long-memory.ts`; `LongMemorySection.tsx` — read-only lista (filtry statusów zostają, przyciski mutacji ZNIKAJĄ, copy „what the agent knows — lifecycle is managed automatically").
- **RENAME**: `KnowledgePanel`→`MemoryPanel` (+Shared), `KnowledgeButton`→`MemoryButton` (ikona: zamiana `Knowledge01Icon` — token w gate), uiStore view `'knowledge'`→`'memory'` (partialize persystuje tylko sidebarOpen — brak hazardu stale-view; R1), queryKeys `knowledgeKeys`→`longMemoryKeys`. (~~composer-quick-actions „Save knowledge"~~ — NIEAKTUALNE po rebrandzie usera, 0 hitów; R1-P3.) **UWAGA KOLIZJA z theme-WIP usera**: SessionsList.tsx/KnowledgeButton.tsx są aktualnie modyfikowane przez właściciela (THE PROTOCOL DESK) — implementacja MUSI zrobić rebase-check przed startem i NIE nadpisywać jego zmian (minimalny diff w tych plikach; jak konflikt realny → STOP i raport).
- **MARKER (3-lockstep)**: `main/database/messages/mappers.ts:113` `RECALL_TOOL_NAMES = {session_memory_search, long_memory_search, long_memory_get, long_memory_history}` → `shared/schemas/messages.ts:37-39` (doc) → `MemoryMarker.tsx:26-38` (cases: session_memory_search „Recalled session memory"; long_memory_search/get/history „Recalled long-term memory"; default zostaje). Testy: messages-db:399-437, transcriptRowModel:109-116, TranscriptMessage:50-85.
- **Copy sweep**: EmbeddingStep.tsx:166, embedding-writer.ts:95, compose/lifecycle.ts:369, wizard-icons.ts:55 („knowledge recall"/„knowledge entries" → long-memory terminology). dim-lock.ts ZOSTAJE (SQL po tabeli — dozwolone).

### D-GATE — grep-gate (mechanika; PRZEPISANA po review R1 — gate w wersji manifestowej był niewykonalny w 3 trybach)

- Baza: 33 tokeny z manifestu:156-193, ale **per-token tryb i jawne klasy wyjątków**:
  - **Tryb word-boundary (`rg -w`)** dla pełnych identyfikatorów (`memory_manage` ⊂ `memory_manager`!); **tryb PREFIX (bez `-w`)** dla tokenów-prefiksów: `handleKnowledge` (z `-w` = 0 hitów PRZY 8 żywych handlerach — vacuous), `vex:knowledge`, `CH.knowledge`, `window.vex.knowledge`.
  - **Token `knowledge:`** zawężony do form string-literal (`"knowledge:` / `` `knowledge:``) — goły wzorzec matchuje składnię TS przeżywającej fasady v2 (`turn-context.ts:40,53 readonly knowledge: {`, retrieval-policy:297).
  - **Klasa wyjątków „doktryna-negatywna" — `execution_constraint`, `sizing_hint`:** te tokeny ŻYJĄ w przeżywającej doktrynie OD-1 jako anty-wzorce (memory/schema/{long-memory,memory-candidate,memory-job,memory-decision}-enums.ts + 001:71-72 + 5 testów `expect(...).not.toContain(...)` pinujących advisory-only). NIE usuwamy (gate-point 5 deklaruje OD-1 nietykalne); gate dostaje jawny allowlist: te 2 tokeny dozwolone WYŁĄCZNIE w `memory/schema/*`, ich testach i komentarzach 001. (Testowe `not.toContain` przepisać z części tam, gdzie tanio — opcjonalne.)
  - Pozostałe stałe wyjątki: `knowledge_entries` (tylko nazwa tabeli w SQL/repo), wartości source, typ `KnowledgeSource`.
- **Negative assertions** → stringi budowane z części: registry.test:104-109, dispatcher-misc, **tool-catalog.test:194** (`not.toContain("memory_recall")`) oraz NOWY pin §3 („knowledge_write nie agent-visible"). **Relokacja**: dispatcherowy test „rejects memory_manage as unknown" żyje TYLKO w kasowanym dispatcher-knowledge-other.test:19-25 → przenieść do dispatcher-misc (z części), nie zgubić.
- **Telemetry BANNED_EVENT_PATTERNS** (5 plików): wzorce `knowledge_write./knowledge_supersede.` martwe → USUNĄĆ; dodać banned `memory_recall.`/`mark_outstanding_resolved.` (z części) jako anty-powrót starych namespace'ów.
- **Sweep przeżywających plików z tokenami copy (enumeracja z R1, była niekompletna):** 'Active Knowledge' → także db/repos/knowledge/types.ts:101,187, hot-context.ts:20, prompts/index.ts:87, long-memory-source-policy.ts:4,13, policy.ts:145-157 docstrings, turn.test:313, knowledge-source-filter.int:2; 'knowledge recall' (lowercase) → retrieval-policy:39, memory-candidates/crud.ts:560,580, long-memory/search.ts:10, transcriptRowModel.ts:28, long-memory-search.test:83, _s4-fixtures:108.
- Gate-skrypt (per-token tryby + allowlisty) dołączony do §3 weryfikacji; docs/memory-system/audit POZA zakresem.
- **Nity R2 (wcielone):** N1 — fixture `"execution_constraint"` w `scripts/knowledge-import/v2-influence-suite.ts:89` przepisać Z CZĘŚCI (zamiast poszerzać allowlist doktryny); N2 — sweep += `tools/registry.ts:17` (komentarz z memory_manage/memory_update); N3 — sweep += `scripts/knowledge-import/row-pipeline.ts:9` (komentarz knowledge_write); N4 — prompt-stack.test refs to `:84,:161,:168,:489` (literały "knowledge:42" łapane przez string-literal mode); obserwacja: `telemetry-events/knowledge.test.ts` importuje handleKnowledgeWrite/Supersede (:118-121,:218-282) — jego edycja to de facto rewrite (gut starych sekcji), nie tylko BANNED-block.

### D-TESTS — mapa (z recon, enumeratywnie)

- DELETE: jak w D-DELETE/D-VEXAPP (~3.1k LOC).
- EDIT (agent, 13): memory-section.test (re-pin copy v2), prompt-stack.test:84,489, turn-active-knowledge.test:206-236 (re-pin long_memory_suggest), promotion-regression:294 (komentarz), pressure-gating:510 (fixture→long_memory_suggest — POTWIERDZIĆ taksonomię local_write w taxonomy.ts), telemetry ×5 (BANNED block + memory-and-outstanding rename eventów), tool-description-anti-patterns:97-118 (re-pin suggest), _dispatcher-test-mocks (trim), requires-env:58-72, dispatcher-misc:111-115, dispatcher-pressure-deny:114-115 (rename), registry.test (EXPECTED_TOOLS −8/+2 rename, gating), registry-taxonomy:83-96, tool-catalog.test:43-45,194.
- EDIT (vex-app, 10+): messages-db, transcriptRowModel, TranscriptMessage, channels.test:79-80, bridge-surface:147-150, ipc-handler-surface/compaction-knowledge-memory:251-257 (nazwa pliku zostaje — gate-clean, rename opcjonalny), AppShell ×6 ikona-mock one-linery, EmbeddingStep:219, memory-db.test (bez zmian shape), **shared/ipc/__tests__/result.test.ts:52,73-75 + result-surface.test.ts:98-99,134** (pinują domenę `knowledge` + kody not_found/invalid_state — aktualizacja przy ich usunięciu; R1).
- EDIT (agent, uzupełnienie R1): **knowledge/policy.test.ts** (sekcje martwych eksportów out; TOOL_OUTPUT_* → nowy test tool-output-policy), **knowledge/ranking.test.ts** (rerank out), **lint/no-deprecated-symbols.test.ts:25,118-140** (wpis findLastUserInput/recall-seed out + stale komentarz), **turn.test:313** + **knowledge-source-filter.int:2** (komentarze 'Active Knowledge').
- DELETE (uzupełnienie R1): **knowledge/recall-payload.test.ts** (podmiot kasowany).
- Implied-edits (tsc złapie, ale jawnie): register-all.ts:16,86; shared/types/bridge/agent/index.ts:20,34,57 + preload/agent/index.ts (wpięcia knowledge→long-memory); capabilities.ts:58 stale komentarz; komentarze crud.ts:493 (updateStatus) i ranking.ts:37,104 — sweep przy okazji.
- NEW: long-memory-db.test, ipc long-memory.test, LongMemorySection.test, MemoryPanel.test (przepisany z KnowledgePanel), schemas/long-memory.test.
- INTEGRATION: compact-service (asercje placeholdera), long-mission (importy bez zmian — repo zostaje; rename w komentarzach). Temp-harness `_s9_tmp`: migracja 033 (świeża: no-op; po wsadzie do starej-z-tabelą: drop), smoke repo knowledge (insert/getById/lineage przechodzą po usunięciu martwych eksportów).

## §2. Sekwencja implementacji

1. D-PRE (split policy) → tsc green checkpoint.
2. D-DELETE + D-RENAME agent (triple-point atomowo) + D-PROMPTS + testy agent.
3. D-VEXAPP (delete → new → rename → marker) + testy vex-app.
4. 001-edit + 033 + gate-sweep komentarzy.
5. Pełna weryfikacja + gate.
Jedna faza, commity na końcu: feat(vex-agent) cutover + feat(vex-app) cutover/rewire + docs. (Połówkowe commity NIE — registry/loaders/tool-map muszą iść razem; checkpointy tylko lokalne tsc.)

## §3. Weryfikacja (moja, po implementerze)

- tsc ×2 + boundary; celowane suity: registry/dispatcher/prompts/telemetry (agent), panel/marker/ipc/bridge (vex-app); integracja `_s9_tmp` (033 + repos smoke) na realnym pgvector; **grep-gate 33 tokenów word-boundary = ZERO** (+ tokeny copy); registry-tool-map consistency; „knowledge_write nie jest agent-visible" (test z master-planu — pin nieistnienia w getOpenAITools).

## §4. Gate-points (Codex)

1. Triple-point atomowy (lookup/loaders/tool-map) — registry-completeness + tool-map testy pinują; brak okna z toolą bez loadera.
2. D-PRE: przepięcie 3 konsumentów TOOL_OUTPUT_* bez zmiany wartości; policy.ts traci tylko martwe eksporty.
3. Marker 3-lockstep zmieniany RAZEM; degradacja historycznych wierszy jawnie zaakceptowana (§0).
4. Rewire panelu: NOWY kanał read-only bez mutacji; DTO sanitized (zero content_md/source_refs/embedding); brak `knowledge` domain/codes po usunięciu (lub świadome zostawienie jeśli współdzielone — zweryfikować).
5. Prompty v2 nie zmieniają semantyki uprawnień (advisory; lifecycle=manager; OD-1 nietknięte).
6. 001-edit + 033 spójne dla świeżych i starych DB; lustro auto.
7. Gate-mechanika: word-boundary; negative-assertions z części; BANNED-patterns zaktualizowane; wyjątki (tabela/source/typ) jawne.
8. Kolizja z theme-WIP usera (SessionsList/KnowledgeButton w trakcie edycji) — minimalny diff/stop-on-conflict.
9. Zero aliasów; `rg` po starych nazwach pusty; done-when z master-planu:256-260 spełnione co do litery.

## §1a. Plan-gate R1 — rozsądzenie (Fable 5 adversarial, 2026-06-11; Codex niedostępny — limit)

WERDYKT R1: BLOCKED — wszystkie defekty plan-level, zero redesignu. **WCIELONE W CAŁOŚCI** (to był rzetelny review, nie misframe):
1. **P1 gate niewykonalny ×3** → D-GATE przepisany: per-token tryby (prefix bez -w dla handleKnowledge/vex:knowledge/CH.knowledge/window.vex.knowledge), `knowledge:` zawężony do string-literali (składnia TS fasady v2 matchowała), klasa wyjątków doktryna-negatywna dla execution_constraint/sizing_hint (żyją w OD-1 anty-regresyjnych pinach — nietykalne per gate-point 5).
2. **P2 zła partycja policy.ts** → pełna lista martwych: +computeValidUntil (promote = pass-through), rodzina TTL, RECALL_DEFAULT_K/INLINE_*/CACHE_TTL_MIN, UpdatableKnowledgeStatus; docstring TOOL_OUTPUT_TTL_MIN.
3. **P2 mapa testów niekompletna** → +result.test/result-surface (pin domeny knowledge), policy.test/ranking.test/recall-payload.test/no-deprecated-symbols, turn.test:313, knowledge-source-filter.int:2, nowy dom testów tool-output-policy.
4. **P2 sweep przeżywających plików** → enumeracja 'Active Knowledge' (+6 lokacji) i 'knowledge recall' (+6).
5. **P3**: composer-quick-actions nieaktualne (rebrand usera) — wykreślone; implied-edits jawnie (register-all, bridge/preload index, capabilities-komentarz); relokacja negative-assertion „rejects memory_manage" do dispatcher-misc + from-parts także w tool-catalog:194 i nowym pinie §3.
Zweryfikowane non-issues (R1 potwierdził): params-relokacja, recallTopK bez kolizji, rerank/scoreRecallCandidate, updateStatus tylko 2 ginących callerów, recall-seed dead, triple-point + marker line-refs exact, schemas/knowledge 6 importerów, uiStore partialize, features.memory zostaje, taxonomia long_memory_suggest = local_write (pressure-fixture OK), 001+033 sound.

## §5. Ślad

- Recon (4 soczewki /workflows, manifest-drift + agent + vex-app + tests/grep): DONE 2026-06-11.
- Plan-gate (Fable 5 adversarial — Codex limit): **R1 BLOCKED (1×P1+3×P2+3×P3, wszystkie wcielone — §1a) → R2 GREEN LIGHT (2026-06-11): 7/7 RESOLVED zweryfikowane file:line, skan sprzeczności czysty, +4 P3-nity wcielone (D-GATE), gate „watertight AND achievable" potwierdzony empirycznie.**
- Implementacja (Fable 5 max) / weryfikacja / Phase-6 / commit+push: [PENDING]
