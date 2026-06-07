# Memory v2 — Cutover Manifest

Źródło: Codex delegate (5 subagentów explorer), sesja `memory-cutover`, 2026-06-07.
Podstawa planu: `/mnt/x/Vex/memory-system/memory-system-v2.md`.
Status: READY (do użycia w STAGE S9 cutover; sekcje per-stage odwołują się tu po listy plików).

Akcje: DELETE / REPLACE (czym) / KEEP-RENAME / KEEP-AS-IS.

---

## Slice 1 — Tool Layer

| plik | symbol/linie | obecna rola | akcja | zamiennik | ryzyko/uwagi |
|---|---:|---|---|---|---|
| `src/vex-agent/tools/registry/knowledge.ts` | `KNOWLEDGE_TOOLS` 13-148: knowledge_write/supersede/recall/recall_overflow/get/update_status/lineage/history | cała stara agent-facing powierzchnia knowledge | DELETE | nowe ToolDef-y: session_memory_search, session_memory_resolve_item, long_memory_search, long_memory_get, long_memory_history, long_memory_suggest | nie zostawiać pustego pliku ani aliasów; manager lifecycle nie jako ToolDef |
| `src/vex-agent/tools/registry/memory.ts` | `MEMORY_TOOLS` 23-92: memory_recall, mark_outstanding_resolved | stara session memory surface | KEEP-RENAME | session_memory_search, session_memory_resolve_item w `src/vex-agent/memory/*` | logi, opisy, outputy też zmienić |
| `src/vex-agent/tools/registry/lookup.ts` | importy/spready 21,30,42,51 | agreguje stare ToolDef-y | REPLACE | import/spread z nowego memory tool-def module | registry i OpenAI projection muszą być atomowe |
| `src/vex-agent/tools/dispatcher/internal-loaders.ts` | knowledge loaders 31-39; memory loaders 67-70 | lazy dispatch starych nazw | REPLACE | loadery dla sześciu nowych tooli | brak loadera da `Unknown internal tool` |
| `src/vex-agent/tools/internal/knowledge.ts` | 1-18 | barrel starych handlerów | DELETE | brak | zostawienie ułatwia dead imports |
| `src/vex-agent/tools/internal/knowledge/{write,supersede,recall,get,update-status,lineage,history,params}.ts` | handleKnowledgeWrite 34-197, handleKnowledgeSupersede 40-196, handleKnowledgeRecall 26-154, handleKnowledgeGet 16-49, itd. | bezpośrednie agentowe write/read/lifecycle do knowledge_entries | DELETE/REPLACE | long_memory_suggest/search/get/history; manager promote/supersede/archive jako internal functions | obecny write/supersede omija redaction boundary i ufa agent source |
| `src/vex-agent/tools/internal/memory/recall.ts` | handleMemoryRecall 45-137 | session-scoped vector recall | KEEP-RENAME | handleSessionMemorySearch | event namespace memory_recall.* musi zniknąć |
| `src/vex-agent/tools/internal/memory/mark-resolved.ts` | handleMarkOutstandingResolved 38-147 | resolve outstanding item | KEEP-RENAME | handleSessionMemoryResolveItem | dobra logika do reuse, stara nazwa nie |
| `src/vex-agent/tools/registry/tool-map.ts` | categories 53-71 | prompt Tool Map starych nazw | REPLACE | session/long memory categories z sześcioma nowymi tools | inaczej model będzie wołał stare nazwy |
| `src/vex-agent/tools/registry/visibility.ts` | hasSessionMemory 47-54, 64-67, 179-181 | gating session tools | KEEP-RENAME | zachować gate, zaktualizować komentarze | nie dodawać roli `manager` |
| `src/vex-agent/tools/types.ts` | requiresSessionMemory 47-55 | typ visibility | KEEP-RENAME | komentarze na nowe session tools | pole nadal potrzebne |
| `src/vex-agent/tools/internal/compact/now.ts` | output 101-107 | tekst odsyła do memory_recall | REPLACE | session_memory_search | persisted transcript/copy |
| `src/vex-agent/tools/{taxonomy,risk-level}.ts` | komentarze 16-20, 9-11 | przykłady knowledge/knowledge_write | REPLACE | long_memory_suggest / memory candidate | grep-gate debt |
| `src/vex-agent/tools/registry/{protocol,plan}.ts` | protocol desc 23; plan comments 11-13 | ukryte prompt/comment refs do knowledge | REPLACE | long_memory_search / neutral local-write | poza oczywistym registry slice |
| `src/vex-agent/tools/internal/{types,tool-output-read}.ts` | loaded docs doc 24; provenance 64-76; overflow import 26 | knowledge:{id} i knowledge/policy coupling | REPLACE | long_memory:{id}; neutral tool-output policy | knowledge/policy nie może blokować cutoveru |
| `src/vex-agent/tools/dispatcher.ts`, `openai-tools.ts`, action/mutating aliases | całe pliki | generic infrastructure | KEEP-AS-IS | brak | zadziałają po wymianie registry/loaders |

## Slice 2 — Engine / Prompts

| plik | symbol/linie | obecna rola | akcja | zamiennik | ryzyko/uwagi |
|---|---:|---|---|---|---|
| `src/vex-agent/engine/prompts/base.ts` | 41-50, 72-80 | bazowy prompt uczy knowledge_*, memory_recall, knowledge_get | REPLACE | v2 memory guidance + long_memory:{id} albo neutral loaded key | model będzie emitował martwe tools |
| `src/vex-agent/engine/prompts/tool-usage.ts` | 20-28, 82-89, 105-113 | learning protocol i memory layers | REPLACE | agent suggests przez long_memory_suggest; manager internal | krytyczny prompt drift |
| `src/vex-agent/engine/prompts/{knowledge-state,knowledge,memory-state,memory-routing}.ts` | formattery 1-124 | stare bannery Active Knowledge/session memory | DELETE/REPLACE | formattery z `src/vex-agent/memory/*`, przez memory.getTurnContext(...) | engine nie ma importować repo |
| `src/vex-agent/engine/prompts/index.ts` | options 41-96; insertion 134-163 | składa stare oddzielne bloki | REPLACE | jeden memoryContextBlock / prompt blocks z memory module | stare option names utrwalą legacy |
| `src/vex-agent/engine/core/turn.ts` | imports 15-29; prefetch 73-94; prompt merge 100-104 | direct knowledgeRepo hot context | REPLACE | memory.getTurnContext(...) | główne złamanie izolacji |
| `src/vex-agent/engine/core/turn-loop-prompt-stack.ts` | imports 24-31; stats 91-108; visibility 139-162 | direct session_memories stats | REPLACE | memory turn context + visibility signal | session tools mogą być źle ukryte |
| `src/vex-agent/engine/core/turn-loop.ts` | MEMORY_ROUTING_PROMPT 56; args 223-233 | statyczny old routing prompt | REPLACE | v2 routing formatter | zostawi knowledge_recall/memory_recall |
| `src/vex-agent/engine/core/recall-seed.ts` | 1-132 | seed utility dla dawnego recall | KEEP-RENAME | przenieść pod memory turn context | wygląda na produkcyjnie martwe, ale testy pinują |
| `src/vex-agent/engine/core/hydrate.ts` | comments 1-7, 29-35; loadedDocuments 137 | loaded tool content | REPLACE | long_memory_get key semantics | comments złapią grep |
| `src/vex-agent/engine/compact-jobs/{service,giant-tool,chunker-call}.ts` | service 172-177; giant 1-21; chunker 79-88 | compact placeholder i prompt mówią memory_recall | REPLACE | session_memory_search; split policy imports | persisted placeholder text |
| `src/vex-agent/engine/prompts/resume-packet.ts` | SQL 50-61; output 109-115 | direct session memory prompt injection | REPLACE | memory.getPostCompactResumeContext(...) | ukryta ścieżka poza turn stack |
| `src/vex-agent/engine/compact-jobs/{chunk-processing,executor,forced-fallback}.ts` | imports/policy/session reads | session memory compaction substrate | KEEP-AS-IS/REPLACE imports | split policy/redaction; memory helper APIs | nie mylić z new memory_jobs manager |
| runner seed files: `core/runner/{agent,setup-turn,mission-run}.ts`, `subagents/runner.ts` | initial projections | seedują hasSessionMemory:false | REPLACE | nowy visibility signal | typ/comment coupling |
| `src/vex-agent/engine/core/{tool-output-overflow,wake/blob-refresh}.ts` | imports z knowledge/policy | generic tool-output TTL/overflow | REPLACE | neutral policy module | ukryte namespace coupling |

## Slice 3 — DB / Repos / Migrations / Policy

| plik | symbol/linie | obecna rola | akcja | zamiennik | ryzyko/uwagi |
|---|---:|---|---|---|---|
| `src/vex-agent/db/migrations/001_initial.sql` | knowledge_entries 29-68 | stary long-term store | REPLACE | final v2 long-memory schema na tej samej tabeli | zachować numeric id; dodać maturity/activation/influence/decay/regime/bi-temporal/outcome |
| `src/vex-agent/db/migrations/001_initial.sql` | source_refs 45 | komentarz sugeruje proj_* IDs | REPLACE | evidence refs przez protocol_executions.id, protocol_capture_items.id + semantic keys | FIX-1 hazard |
| `src/vex-agent/db/migrations/001_initial.sql` | recall_cache_entries 79-90 | knowledge_recall_overflow cache | DELETE | brak agent overflow; opcjonalny internal cache w memory | usuwać razem z repo/tests |
| `src/vex-agent/db/migrations/{003,005}.sql` | proj_pnl_matches 17-35; LP anchors 10-31 | projection/outcome evidence | REPLACE częściowo | immutable refs/FK do protocol executions/capture items | sync/replay.ts kasuje projection tables |
| `src/vex-agent/db/migrations/006_knowledge_lifecycle.sql` | 28-36 | lifecycle pod knowledge_supersede | KEEP-RENAME | internal long-memory lineage + memory_decisions audit | komentarze i semantyka agent tool do usunięcia |
| `src/vex-agent/db/migrations/016_session_memories.sql` | 31-140 | session memory substrate | KEEP-RENAME | session_memory_search/resolve_item | schema dobra, nazwy/comments stare |
| `src/vex-agent/db/migrations/017_compact_jobs.sql` | 25-81 | compact queue | KEEP-AS-IS | wzorzec dla nowego memory_jobs, ale osobna tabela | nie reuse semantyczny |
| `src/vex-agent/db/migrations/018_knowledge_source.sql` | 19-32 | agent-trusted source enum/hot index | REPLACE | manager-derived provenance/source tier | FIX-2 round-trip source |
| `src/vex-agent/db/repos/knowledge*` | CRUD/types/recall/hot-context/export/reembed/lineage | public old knowledge repo | KEEP-RENAME/REPLACE | internal long-memory repo under memory module | engine/tools nie importują bezpośrednio |
| `src/vex-agent/db/repos/knowledge/export.ts` | streamAllForExport 23-56 | export | REPLACE | export v2 fields + source | BUG: SELECT nie pobiera k.source |
| `src/vex-agent/db/repos/knowledge-lifecycle*` | supersede 29-214 | atomic successor/predecessor | KEEP-RENAME | internal manager transition | no ToolDef, redaction przed repo |
| `src/vex-agent/db/repos/session-memories/*` | recall/resolve/create/stats | session substrate | KEEP-RENAME | internal repo dla session tools | nazwy/logi/DTO zmienić |
| `src/vex-agent/db/repos/recall-cache.ts` | 1-156 | overflow cache | DELETE/REPLACE | brak lub internal long-memory cache | stare overflow tool znika |
| `src/vex-agent/knowledge/{policy,ranking,recall-payload,content-hash}.ts` | policy/ranking/payload/hash | old knowledge utilities | REPLACE/KEEP-RENAME | long-memory policy/rerank/content hash; delete overflow payload | content-hash do reuse |
| `src/vex-agent/memory/policy.ts` | session 20-60; pressure 62-125/166-177; KnowledgeSource 127-155 | miesza session memory, pressure i knowledge source | REPLACE | session-memory-policy, context-pressure-policy, long-memory-source-policy | wskazane miejsce rozdziału |
| `src/vex-agent/memory/{redaction,exclusion-rules,theme-validation}.ts` | redaction 16-20; live-state scan 97-150; themes 35-130 | dobre prymitywy | KEEP-RENAME/KEEP-AS-IS | stosować w suggest/promote/session chunks | nie przenosić do renderer |
| `src/vex-agent/embeddings/*` | client/config/schemas | embedding substrate | KEEP-AS-IS | używa manager/candidates po redakcji | komentarze knowledge_* zmienić |
| `src/vex-agent/inference/{registry,types}.ts` | resolveProvider, chatCompletionSimple | LLM hook | KEEP-AS-IS | Memory Manager używa tego, bez nowych env | nie kopiować direct OpenRouter path z chunkera |
| `src/vex-agent/scripts/{knowledge-export,knowledge-import/*,_preflight}.ts` | export/import/preflight | stare schema/scripts | REPLACE | long-memory export/import/preflight | FIX-2: source gubiony też w scripts |

## Slice 4 — vex-app Main / IPC / Preload / Shared

| plik | symbol/linie | obecna rola | akcja | zamiennik | ryzyko/uwagi |
|---|---:|---|---|---|---|
| `vex-app/src/main/ipc/knowledge.ts` | 1-144 | vex:knowledge:*, list + updateStatus | DELETE | new memory inspector IPC, sanitized DTO | updateStatus to mutacja poza managerem |
| `vex-app/src/main/ipc/memory.ts` | 1-74 | old listSession/getStats | REPLACE | v2 memory inspector channels | nazwa domain może zostać, shape nie |
| `vex-app/src/main/ipc/register-all.ts` | imports/calls 16-17, 82-87 | rejestruje stare handlers | REPLACE | registerMemoryInspectorHandlers | delete bez update = build fail |
| `vex-app/src/main/database/{knowledge-db,memory-db}.ts` | listKnowledge, listSessionMemories, getMemoryStats | app-main DB facades | DELETE/REPLACE | v2 sanitized inspector read models | zachować app-scope guard i no raw narrative/embedding |
| `vex-app/src/main/database/messages/mappers.ts` | RECALL_TOOL_NAMES 107-113 | transcript recall marker old names | REPLACE | session_memory_search, long_memory_search/get/history | nowe tools inaczej będą generic calls |
| `vex-app/src/shared/schemas/{knowledge,memory,messages}.ts` | knowledge 16-116; memory 16-100; messages 30-44 | old shared contracts | DELETE/REPLACE | memory-inspector / v2 memory schemas | shared nie importuje agent internals |
| `vex-app/src/shared/ipc/channels.ts` | CH.knowledge, CH.memory 209-223 | old IPC strings | REPLACE | no CH.knowledge; v2 CH.memory.* | brak aliasów |
| `vex-app/src/shared/ipc/result/{types,codes}.ts` | domains/codes 55-64, 173-180, 63-99 | old knowledge domain/errors | REPLACE | remove knowledge domain; v2 memory errors | tests pinują arrays |
| `vex-app/src/shared/types/bridge/agent/{knowledge,memory,index}.ts` | bridge exports/namespaces | window.vex.knowledge, old memory bridge | DELETE/REPLACE | only v2 memory bridge | root bridge transitive cut point |
| `vex-app/src/preload/agent/{knowledge,memory,index}.ts` | preload namespaces | wrappers for old channels | DELETE/REPLACE | v2 memory preload with Zod validation | no raw invoke/channel strings |
| `vex-app/src/main/agent/compact-worker.ts`, `main/index.ts` | compact worker setup | session compact worker | KEEP-AS-IS | add separate memory_jobs worker later | nie reuse jako memory manager |
| onboarding/compose dim-lock files | embedding comments/errors, dim-lock.ts query | "knowledge entries" terminology + vector dim lock | KEEP-RENAME/REPLACE | long-term memory entries; include memory_candidates if embedded | SQL behavior may need expansion |
| shared/preload/main tests | channels/result/bridge/ipc/db tests | pin old IPC surface | DELETE/REPLACE | v2 memory surface tests | many unrelated harnesses import old handlers |

## Slice 5 — Renderer + Tests

| plik | symbol/linie | obecna rola | akcja | zamiennik | ryzyko/uwagi |
|---|---:|---|---|---|---|
| `vex-app/src/renderer/features/appShell/KnowledgePanel.tsx` | 1-57 | "Knowledge & Memory" screen | KEEP-RENAME | MemoryPanel / MemoryInspectorPanel | view name knowledge must disappear |
| `KnowledgePanelShared.tsx` | 1-55 | generic UI primitives | KEEP-RENAME | MemoryPanelShared | code reusable |
| `KnowledgeSection.tsx` | 1-280 | old knowledge list + archive/invalidate | REPLACE | long-memory/candidates/decisions inspector | no window.vex.knowledge.updateStatus |
| `SessionMemorySection.tsx` | 1-138, export MemorySection | old session list/stats | REPLACE | v2 session memory section | export name surprise |
| `MemoryPrivacySection.tsx`, `SessionRuntimeBar.tsx` | copy 17-67, 258-304 | memory described as compaction/OpenRouter only | REPLACE | v2 copy: session, long suggestions, async manager, redaction | current text underspecifies system |
| `MemoryMarker.tsx`, `TranscriptMessage.tsx`, `transcriptRowModel.ts` | marker/call rows | old recall labels | REPLACE | map new session/long retrieval tools | DB mapper + renderer both required |
| `renderer/lib/api/{knowledge,memory}.ts`, `queryKeys.ts` | hooks/cache keys | old bridge hooks | DELETE/REPLACE | longMemory, sessionMemory, memoryInspector hooks/keys | no old namespace aliases |
| `KnowledgeButton.tsx`, `AppShell.tsx`, `SessionsList.tsx`, `uiStore.ts` | view/button route | knowledge appShellView | KEEP-RENAME | memory or memory_inspector | route can silently disappear |
| `composer-quick-actions.ts` | "Save knowledge" 53-56 | prompt nudges knowledge_write behavior | REPLACE | long_memory_suggest prompt or remove action | hidden model steering |
| wizard embedding files/tests | copy "knowledge recall/entries" | onboarding copy | REPLACE | long memory retrieval/store | user-facing stale terminology |
| renderer panel/transcript tests | KnowledgePanel, TranscriptMessage, row model, button tests | pin old UI/API/tool names | DELETE/REPLACE | v2 panel/transcript tests | rewrite most panel tests |
| `src/__tests__/vex-agent/tools/*` | registry/dispatcher/taxonomy/env/internal knowledge tests | pin old tools/handlers | DELETE/REPLACE | six new ToolDef/dispatcher tests | main backend grep gate |
| telemetry/prompt/turn tests | telemetry events, prompt-stack, active knowledge | pin old prompts/events | REPLACE | v2 memory events/context | add negative assertions for old names |
| integration tests | compact-service placeholder, long-mission comments/API | pin memory_recall | REPLACE | session_memory_search + manager integration | cross-cutting transcript failures |

---

## PRZEOCZONE SPRZĘŻENIA / NIESPODZIANKI

- `knowledge/policy.ts` używane do generic tool-output TTL/overflow przez engine/tools, nie tylko knowledge. Przenieść te stałe przed delete/rename policy.
- `src/vex-agent/memory/policy.ts` to dokładnie plik mieszany: session memory limits + pressure/compact policy + KnowledgeSource.
- `resume-packet.ts` wstrzykuje session memory do promptów przez bezpośredni SQL poza oczywistym turn prompt stack.
- `giant-tool.ts` persystuje placeholder `memory_recall` do transcriptu.
- Pipeline markera transcriptu jest trzyczęściowy: DB mapper `RECALL_TOOL_NAMES` → shared message schema docs → renderer `MemoryMarker`.
- `knowledge.updateStatus` to mutacja z renderera importująca stare knowledge repo z Electron main; kłóci się z "manager ops internal".
- `vex-app/resources/migrations/*` lustrzane do agent migrations; aktualizować OBA drzewa schematu.
- `knowledge-export.ts`, `knowledge-import`, repo export — wszystkie biorą udział w FIX-2 (utrata source).
- `proj_pnl_matches` i komentarze wokół `source_refs` zachęcają do niestabilnych projection IDs mimo replay truncation.
- UI quick action "Save knowledge" może sterować modelem do usuniętego toola.
- Wiele niepowiązanych testów IPC importuje/rejestruje stare knowledge/memory handlers przez współdzielone harnessy.
- `knowledge_entries` pozostaje nazwą tabeli substratu → grep gate musi odróżniać techniczne reuse tabeli od starych nazw produktowych/API.

## REKOMENDACJA MIGRACJI

- Edit in place `001_initial.sql`: finalny kształt `knowledge_entries` v2; evidence refs na protocol executions/capture items; usunąć `recall_cache_entries` chyba że wprowadzimy nowy internal non-agent cache.
- Edit in place `003_w4_pnl.sql`: dodać/derive immutable refs dla PnL match evidence; nie pozwolić memory evidence trzymać proj_* serial IDs.
- Keep `004_w4_full.sql` w większości as-is.
- Edit in place `005_lp_economics.sql`: zachować dobre semantic anchors, dodać FK do protocol execution/capture tables jeśli brak.
- Edit in place `006_knowledge_lifecycle.sql`: rename semantyki z knowledge_supersede na internal long-memory lineage/manager transitions; sparować z memory_decisions.
- Edit in place `016_session_memories.sql`: zachować substrat; zaktualizować komentarze/nazwy wokół session_memory_search/resolve_item.
- Keep `017_compact_jobs.sql`; używać tylko jako wzorzec. Dodać osobną `memory_jobs`.
- Edit in place `018_knowledge_source.sql`: usunąć stare agent-trusted source enum semantics; manager-derived provenance/source tier; fix export/import round-trip.
- Add nową czystą migrację dla naprawdę nowych tabel v2: `memory_candidates`, `memory_jobs`, `memory_decisions`, `memory_entities`, `memory_entry_entities`, `memory_edges`.
- Mirror wszystkich migration edits w `vex-app/resources/migrations/*`.

## RYZYKA CUTOVERU (kolejność)

- Zmieniać registry i `INTERNAL_TOOL_LOADERS` atomowo; inaczej nowe ToolDefs dispatch do unknown tool.
- Zmieniać prompty przed/z registry; inaczej model emituje usunięte nazwy a błędy wyglądają jak runtime tool errors.
- Usuwać `knowledge.updateStatus` UI/IPC ostrożnie; to mutacja bez v2 agent-facing zamiennika.
- Zastąpić engine direct repo reads przez `memory.getTurnContext(...)`; zostawienie jednej ścieżki utrzyma stary hot context.
- Rozdzielić policy modules przed delete `knowledge/policy.ts` lub engine/tool-output imports się wywalą.
- Aktualizować transcript mapper i renderer marker razem; inaczej memory calls renderują się jako generic tools bez głośnego błędu.
- Trzymać compact worker osobno od nowego memory manager worker; compact_jobs ≠ memory_jobs.
- Obsłużyć dim-lock dla memory_candidates jeśli kandydaci niosą embeddingi.
- Naprawić export/import source round-trip przed poleganiem na source/provenance testach.
- Nie kotwiczyć evidence na projection row IDs; replay je unieważni.
- Aktualizować testy szeroko, nie tylko pliki nazwane knowledge/memory; współdzielone harnessy importują stare handlery.

## GREP GATE (musi zniknąć z `src/` i `vex-app/`)

```text
knowledge_write
knowledge_supersede
knowledge_recall
knowledge_recall_overflow
knowledge_get
knowledge_update_status
knowledge_lineage
knowledge_history
memory_recall
mark_outstanding_resolved
memory_manage
memory_update
KNOWLEDGE_TOOLS
MEMORY_TOOLS
handleKnowledge
handleMemoryRecall
handleMarkOutstandingResolved
knowledge:
window.vex.knowledge
CH.knowledge
vex:knowledge
KnowledgeBridge
KnowledgePanel
KnowledgeSection
KnowledgeButton
Knowledge01Icon
KnowledgeEntryDto
useKnowledgeList
useUpdateKnowledgeStatus
Active Knowledge
Save knowledge
knowledge recall
execution_constraint
sizing_hint
```

Dozwolone po review: `knowledge_entries` jako reużyta nazwa tabeli DB — ale NIE jako copy user-facing, naming IPC/API, tekst promptu ani terminologia renderera.
Uwaga: `observed|user_confirmed|inferred|hypothesis` zostają jako wartości source w DB, ale przestają być agent-trusted (manager-derived).
