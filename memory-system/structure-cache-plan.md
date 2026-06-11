# STRUCTURE+CACHE — spec wykonawczy (faza po S8, przed S9)

Status: v3 PO KRYTYCE (4 soczewki adwersarialne wcielone — §1a; czeka: Codex plan-gate `harness-memory-structure`)

Zakres = pozycje DEFER z S3 (s3-plan §6) **+ nowy zakres właściciela (2026-06-10)**:
1. reorg promptu pod KV-cache (stabilny prefiks → historia → zmienny stan za historią),
2. jedna sekcja MEMORY + fasada `memory.getTurnContext()` + hot-context rewire,
3. połączony katalog kindów,
4. wiring prompt-cache przez `@openrouter/sdk` (POTWIERDZONY researchem),
5. persystencja + UI oszczędności cache (netto vs normalny pricing),
6. detekcja czy model wspiera cache,
7. audyt pricingu in/out w UI (wykonany — D-AUDIT).

---

## §0. Forki właściciela (ROZSTRZYGNIĘTE)

- **F1 — Reorg + cache:** TAK; wiring cache wchodzi (research potwierdził typowanie `cacheControl` w SDK 0.12.x).
- **F2 — Jedna sekcja MEMORY:** scala 4 bloki, zasilana fasadą `getTurnContext()`.
- **F3 — Stan per-turn:** **ZA HISTORIĄ** (trailing turn-state message) + **wzmocniony test na żywo** (D-LIVETEST — bramka rozstrzygająca); fallback: merge turn-state do statycznego system message w warstwie inference per-provider, **z zachowaniem breakpointu B na historii** (§1a-7).
- **F4 — Oszczędności cache w UI:** netto (odczyty − dopłata za zapis), liczone w momencie zapisu usage; wartości ujemne zapisywane PRAWDZIWIE i jawnie obsłużone w UI (§D-UI-COST).

## §0a. Ustalenia DeepResearch (2026-06-10)

- Hierarchia: kaskada unieważnień; kolejność prefiksu **TOOLS → SYSTEM → RAG → historia → zapytanie** (Anthropic: `tools, system, messages`; OpenAI: tools częścią prefiksu).
- Anthropic przez OpenRouter: jawne `cache_control {type:"ephemeral"}` (max 4 breakpointy; TTL 5m/1h; zapis 1.25×/2×; odczyt 0.1×; **min. cacheowalny prompt 1024–4096 tokenów zależnie od wariantu modelu**). Qwen również wymaga jawnych breakpointów (potwierdzone w docs OpenRoutera). Google: implicit cache tylko Gemini 2.5 — modele google/ poza 2.5 nie dostają u nas nic (zero markupu = stan dzisiejszy; świadomie).
- OpenAI / Gemini 2.5 / DeepSeek / Grok: automatyczny prefix-cache, zero markupu (OpenAI min 1024 tokenów). Zapisy darmowe lub po cenie bazowej.
- SDK 0.12.x: `cacheControl` typowane na `ChatContentText` (system/user/tool content jako tablice części), na definicjach tooli, top-level (Anthropic-only — NIE używamy). Usage: `promptTokensDetails.cachedTokens`; `cacheWriteTokens` **zwracane TYLKO dla modeli z explicit caching i ceną zapisu** — brak pola ⇒ traktować jako 0. `cache_discount` ($) tylko na endpointcie Generation — nie czytamy z chat response.
- `prompt_tokens` OpenRoutera ZAWIERA tokeny cached i cache-write (zweryfikowane w docs; spójne z konwencją cost.ts) — formuła savings nie dubluje; tożsamość potwierdzana w D-LIVETEST.
- Pułapki: timestampy w prefiksie, niestabilne klucze JSON, losowe ID, locale, kolejność tools. Per-turnowe filtrowanie `tools` = cache-killer; u nas tools zmieniają się tylko przy zmianie pasma/flipie hasSessionMemory (2–4×/sesję) — akceptowalny koszt v1; "mask, don't remove" = follow-up poza fazą (powierzchnia bezpieczeństwa).

---

## §1. Decyzje projektowe (D-*)

### D-LAYOUT — statyczny prefiks → historia → trailing TURN-STATE

```
messages[0]  system  STATYCZNY PREFIKS          cacheHint:"static_prefix"  ✓ cache
             base-static (Identity, aspect, persona, memory&self-learning*,
               Current Context, Response formatting)
             toolUsage | protocols | permission | walletStateBanner
             mode-core** | subagentPrompt
             # Loaded Content***  (KONIEC prefiksu)
messages[1]  system  summary (po compact)        cacheHint:"summary"        ✓ cache
messages[2…] historia (DB tape; może zawierać    OSTATNIA niepusta:         ✓ cache
             mid-tape system rows: continue-cue,  cacheHint:"history_tail"
             operator-cue — rola-agnostycznie)
messages[N]  system  TURN-STATE                  cacheHint:"turn_state"     ✗
             runtimeClock → contextPressure → resumePacket
             → # Memory (D-MEMSEC; routing na końcu sekcji)
             → activePlan → Tool Map → mission turn-state → one-shoty
```

\* stare linie `knowledge_*` w base verbatim (S9 usuwa). \** mode-core bez linii iteracji (D-SPLIT-MISSION). \*** przeniesiony ze środka base.ts:75 — bust cache tylko przy nowym loadzie.

- **Markery segmentów ustawia ENGINE** (`buildProviderMessages` zna granice segmentów): `ProviderMessage.cacheHint?: "static_prefix" | "summary" | "history_tail" | "turn_state"` (inference/types.ts). `history_tail` = OSTATNIA wiadomość historii z niepustym contentem (puste pomijane wstecz); brak historii ⇒ brak markera (B nie powstaje). Warstwa inference jest czysto mechaniczna — żadnych heurystyk pozycyjnych (mid-tape system rows i summary nie do odróżnienia po samej roli — §1a-5). **`history_tail` markowany PO fazie repair** (`repairOrphanedToolCalls` w executeTurn może dopisać placeholder tool-results za assistantem z nieodpowiedzianymi tool-callami — marker na taśmie finalnej, żeby B nie lądował przed placeholderami; Codex gate R2).
- **Świadome zmiany porządku względnego** (jedyne): routing przenosi się DO WNĘTRZA `# Memory` → ląduje PRZED activePlan (dziś activePlan:155 przed routing:161). Twardy constraint zachowany: sygnały stanu → routing → Tool Map. Nowy porządek turn-state pinowany testem §4.1.
- **Wyjątek od "verbatim"**: pozycyjne odsyłacze. `tool-usage.ts:22` ("Listed in the Tool Map above") i `:84` ("see the Memory Routing block above") → przeredagowane na "in the Tool Map provided in the turn state" / "see the Memory Routing block in the turn state". Grep-gate na `above|below` między rozdzielonymi warstwami.
- API: `buildPromptStack` → `{ staticLayers, turnLayers }`; join per segment w turn.ts.
- Zysk: prefiks+historia cache'ują się między WYWOŁANIAMI INFERENCJI w pętli narzędziowej (turn-state odświeżany per call, zawsze na ogonie).

### D-SPLIT-MISSION — linia iteracji do turn-state

`Iteration: N` (mission-run.ts:73) jest dziś ZAMROŻONA per slice runTurnLoop (snapshot z missionRunContext, mission-run.ts:117-120/235-238) — churn następuje per slice (start/resume/recover), nie per iterację pętli. Split nadal zasadny (stabilność prefiksu MIĘDZY slice'ami); implementacja pinowana do ISTNIEJĄCEGO snapshotu `missionRunContext.iterationCount` (NIE żywy licznik DB — to zmieniałoby semantykę). Contract-core w prefiksie; linia iteracji w turn-state.

### D-FACADE — `memory/turn-context.ts`

```ts
export interface MemoryTurnContext {
  /** null = fetch FAILED (≠ pusta baza). Sukces z zerami = prawdziwie pusto. */
  readonly knowledge: {
    readonly hotEntries: readonly ActiveKnowledgeListItem[];
    readonly knownKinds: readonly KnownKind[];   // PEŁNA lista (KNOWN_KINDS_LIMIT=30)
    readonly activeCount: number;
  } | null;
  readonly sessionStats: SessionMemoryStats | null;  // null = fetch FAILED
}
export async function getTurnContext(input: { readonly sessionId: string }): Promise<MemoryTurnContext>
```

- Dwa niezależne catch-e (dzisiejsza granulacja: jeden na 3 zapytania knowledge, drugi na stats); klucze warn bez zmian. **Fail ⇒ branch null ⇒ sekcja POMIJA odpowiednie linie** — zachowane dzisiejsze omission semantics; empty-state ("Use knowledge_write… Skip recall") renderuje się WYŁĄCZNIE przy prawdziwym zerze (§1a-2).
- Filtry hot-context w repo. Rewire: jedyne wywołanie w `buildTurnPromptStack`; prefetch z turn.ts:73-94 znika. `hasSessionMemory = ctx.sessionStats !== null && ctx.sessionStats.activeCount > 0`.
- Import-specifiers pinowane (`@vex-agent/db/repos/knowledge.js`, `@vex-agent/db/repos/session-memories/index.js`) — istniejące ścieżki vi.mock dalej przechwytują.

### D-RESUME-SQL — SQL session_memories → repo

`listUnresolvedOutstandingItems(sessionId, limit)` w `db/repos/session-memories/` (submoduł read/stats → crud.ts → index.ts; SQL 1:1 z resume-packet.ts:51-61; pokryte istniejącym partial index idx_sm_session_active). resume-packet woła repo. **crud-surface.test.ts aktualizowany** (pinuje exact-surface — §1a-9). Sanityzacja i zapytania sessions/messages nietknięte.

### D-MEMSEC — `engine/prompts/memory-section.ts`

`buildMemorySection(ctx: MemoryTurnContext): string`:

```
# Memory
(1) stan session-memory   ← 1:1 buildMemoryStateBanner;     POMIŃ gdy sessionStats===null
(2) stan long-memory      ← 1:1 buildKnowledgeStateBanner;  POMIŃ gdy knowledge===null
    (top kinds = knownKinds.slice(0, KNOWLEDGE_BANNER_TOP_KINDS_LIMIT=5))
(3) Active Knowledge      ← 1:1 formatActiveKnowledgeBlock; POMIŃ gdy knowledge===null
    (PEŁNA lista knownKinds; capy 12/3000/200/500)
(4) Routing               ← 4 linie 1:1 buildMemoryRoutingRule (zawsze)
```

- Oba szerokości kinds pinowane testem (slice-5 dla linii stanu, pełna dla bloku — dzisiejsza derywacja turn.ts:85-89, §1a-3).
- Teksty verbatim, **w tym empty-states BEZ wstrzykiwania kind-catalog** (§1a-10: konsumenci katalogu v1 = wyłącznie 2 opisy w long-memory.ts; empty-state dostanie przykłady w S9). Obie gałęzie null ⇒ sekcja = nagłówek + routing (routing statyczny, zawsze obecny — kotwica porządku przed Tool Map).
- USUNIĘCIA: `memory-state.ts`, `knowledge-state.ts`, `knowledge.ts`(formatter), `memory-routing.ts`; `PromptStackOptions` −4/+1 (`memorySection`); turn-loop.ts bez module-level MEMORY_ROUTING_PROMPT.

### D-KINDS — katalog przykładów kindów

`memory/kind-catalog.ts`: `CANONICAL_KIND_EXAMPLES` + `formatKindExamples()`. **Konsumenci v1: TYLKO** `tools/registry/long-memory.ts:59` i `:161` (uwaga: :161 zmienia zestaw 2→4 przykładów i kolejność — zmiana INTENCJONALNA; żaden test nie pinuje tych stringów; internal toole nie są embedding-synced). memory-section verbatim (jw.). kind-families.ts bez zmian.

### D-CACHE — wiring `cacheControl`

- **Gating:** breakpointy TYLKO gdy `isExplicitCacheModel(config.model)` (zamknięta lista prefiksów `anthropic/`, `qwen/` — cytat docs OpenRoutera w komentarzu params.ts; google/ poza listą świadomie — implicit dla 2.5, nic dla starszych) **ORAZ** `config.cachePricePerM !== null` (detekcja "model wspiera cache" z cennika /models). Auto-providerzy: zero markupu.
- **Breakpointy (2 z 4):**
  - A: system message statycznego prefiksu jako `content: [{type:"text", text, cacheControl:{type:"ephemeral"}}]` (pokrywa tools — prefiks Anthropic `tools→system`).
  - B: na wiadomości oznaczonej `cacheHint:"history_tail"` (engine wskazał; rola-agnostycznie — może być user/assistant/tool/system; content → części tekstowe z cacheControl na ostatniej). Brak markera (pusta historia) ⇒ brak B. Mapper NIE zgaduje pozycji (§1a-5).
  - Turn-state NIGDY nie markowany (dopłata za zapis bloku zmiennego bez odczytów).
- TTL domyślny 5m; bez top-level auto-dyrektywy.
- Determinizm prefiksu: grep-gate Date.now()/random/locale w warstwach statycznych (zweryfikowane czyste w krytyce — pin testem nie jest wymagany).

### D-LIVETEST — bramka forka F3 (WZMOCNIONA, §1a-1)

Throwaway `scripts/_cache_livetest.ts` (usuwany po fazie; klucz z env; koszt centy):
1. **Prefiks ≥ 4096 tokenów** (powyżej każdego per-model minimum Anthropic — 2k dawało fałszywy FAIL).
2. Taśma testowa zawiera **mid-history system row** (kształt produkcyjny: continue-cue/operator-cue).
3. Call 1 → call 2 (identyczny prefiks+historia, inny turn-state): asercje
   - `cachedTokens(call2) ≥ prefixTokens + historyTokens − slack` (NIE samo `> 0` — samo `>0` przepuszczałoby wariant "prefiks cache'uje, historia re-write 1.25× co call"),
   - `cacheWriteTokens(call2)` małe (≈ nic — turn-state nie markowany),
   - tożsamość `promptTokens ≈ uncached + cachedTokens (+ cacheWriteTokens)` (walidacja założenia formuły savings).
4. Call 3 z dopisaną 1 wiadomością historii: przyrostowy hit (`cachedTokens ≈ poprzedni prefiks+historia`).
5. **Wariant porównawczy dla Anthropic:** trailing-turn-state VS merged-turn-state — bezpośredni pomiar, czy trailing system kosztuje cache historii (to jest właściwa bramka F3).
6. Drugi model: auto-provider (DeepSeek/OpenAI) — sanity `cachedTokens > 0` przy stabilnym prefiksie.
7. **Asercja payloadu** (Codex gate R2): zbudowany ChatRequest zawiera `cacheControl` DOKŁADNIE w przewidzianych segmentach (A na static, B na history_tail, nigdzie indziej) — nie polegamy wyłącznie na skutkach w `cachedTokens`. (Pokrywane też unit-testami §4.6; w livetescie dump requestu przed wysyłką.)
8. Wyniki per-segment wpisane do §6.
- FAIL trailing dla Anthropic ⇒ **fallback: merge turn-state do statycznego system message ([static(+cc), turn-state]) Z ZACHOWANIEM breakpointu B na history_tail** (historia kończy wtedy messages = podręcznikowy incremental pattern; cache historii NIE jest oddawany — §1a-7). Fallback per-provider w params.ts (engine nietknięty).

### D-SAVINGS — persystencja oszczędności (netto, per request, w momencie zapisu)

**Per-term null-gating (§1a-6 — KRYTYCZNE dla auto-providerów):**
```
read_savings    = (cachePricePerM !== null && cachedTokens > 0)
                  ? cachedTokens × (inputPricePerM − cachePricePerM) / 1M : 0
write_surcharge = (cacheWritePricePerM !== null && cacheWriteTokens > 0)
                  ? cacheWriteTokens × (cacheWritePricePerM − inputPricePerM) / 1M : 0
cached_savings  = read_savings − write_surcharge   // ujemne możliwe — zapisujemy prawdę
```
Brak ceny zapisu (auto-providerzy: OpenAI/DeepSeek/Gemini — cacheWriteTokens w ogóle nie zwracane) ⇒ surcharge 0, **NIGDY nie tłumi read_savings**.
- `InferenceConfig` += `cacheWritePricePerM: number | null` (z `pricing.inputCacheWrite`, obok openrouter.ts:241); `InferenceUsage` += `cacheWriteTokens?: number`; `extractUsage` mapuje (brak pola ⇒ undefined ⇒ 0 w logUsage).
- `computeRequestCost`: breakdown.cachedSavings = NETTO. **Świadomy efekt uboczny:** `localTotal` (cost.ts:49) absorbuje dopłatę za zapis — zmienia się WYŁĄCZNIE fallback-estymata (totalCost dalej preferuje autorytatywne usage.cost); pin testem §4.6 (§1a-12). Poprawność opiera się na `prompt_tokens ⊇ cache-write tokens` (potwierdzone §0a + tożsamość w D-LIVETEST).
- **DDL: NOWA migracja `032_usage_cache_savings.sql`** (NIE edycja 001 — runner bierze tylko `version > MAX(schema_version)`, edycja 001 byłaby niewidoczna dla zainicjalizowanych DB, a `logUsage` jest awaited bez try/catch ⇒ stale DB = pad każdego turnu; §1a-8): `ALTER TABLE usage_log ADD COLUMN IF NOT EXISTS cached_savings NUMERIC NOT NULL DEFAULT 0, ADD COLUMN IF NOT EXISTS cache_write_tokens INT NOT NULL DEFAULT 0;` + **LUSTRO** `vex-app/resources/migrations/032_...` (drzewa zsynchronizowane do 031). Idempotentne; stare wiersze = 0 (bez backfillu — historycznych savings nie znamy).
- `logUsage` zapisuje oba pola (turn.ts przekazuje breakdown.cachedSavings + usage.cacheWriteTokens; gating na aborted&&!usageObserved bez zmian).

### D-UI-COST — IPC + renderer

- `usage-db.ts`: `getSessionTotals` += `SUM(cached_tokens)`, `SUM(cached_savings)`; `getLastTurn` += `cached_savings`, `cache_write_tokens`; zero-row fallback obiekt + nowe pola.
- `shared/schemas/usage.ts`: totals += `totalCachedTokens: int≥0`, `totalCachedSavings: number|null`; turn += `cachedSavings: number|null`, `cacheWriteTokens: int≥0`. **`cachedSavings`/`totalCachedSavings` = `z.number().nullable()` BEZ `.min(0)`** — sąsiednie pola są int≥0, ale savings bywa ujemne; `.min(0)` zamieniłby każdy odczyt sesji z ujemnym wierszem w `internal.contract_violation` i zabił cały UsageChip (§1a-11).
- **Ujemne savings (gwarantowane-częste: pierwszy request każdego prefiksu Anthropic):** chip ⚡ bez zmian (gating na cachedTokens>0); linie tooltipa gatowane na `!== 0 && !== null`; formatowanie lokalnym `fmtSignedCost`: dodatnie → `Cache savings: $X.XX total`, ujemne → `Cache net: −$X.XX total` (per-turn analogicznie `saved ~$X` / `cache overhead $X`). Zero matematyki cen w rendererze.
- Bez nowych kanałów IPC; preload/bridge bez edycji (pola płyną przez z.infer). Live-stream savings ŚWIADOMIE pomijane (spójne z post-turn wzorcem kosztu; streamStore dropuje usage).

### D-AUDIT — audyt pricingu in/out (pkt 7) — WYNIK

Mechanizm ZDROWY (jedno źródło prawdy; renderer bez matematyki cen). Znaleziska: (1) `fmtCost` hardkoduje `$` (USD-only dziś; poza zakresem, odnotowane); (2) cachedSavings liczony i wyrzucany przed persystencją — naprawia D-SAVINGS; (3) brak flagi API-cost-vs-estymata w usage_log — świadomie pominięte; (4) agent-side `getStats` = martwy kod — NIE ruszamy (kandydat S9/S10).

---

## §1a. Krytyka adwersarialna — rozsądzenie (4 soczewki, 2026-06-10)

**WCIELONE:**
1. **P1 livetest za słaby** (reorg+cache): `cachedTokens>0` nie odróżnia "prefiks+historia cached" od "tylko prefiks cached + historia re-write 1.25×/call"; 2k prefiks = fałszywy FAIL poniżej 4096-min. → D-LIVETEST przepisany (≥4096, asercje per-segment, call 3 przyrostowy, wariant trailing-vs-merged, mid-history system row, tożsamość promptTokens).
2. **P2 konflacja fail-vs-empty** (reorg+facade): zera przy fail renderowałyby "[Knowledge: empty… Skip knowledge_recall]" przy hiccupie DB. → `knowledge: {...} | null`; omission semantics per branch.
3. **P2 dwie szerokości knownKinds** (facade): top-5 dla linii stanu vs pełna-30 dla bloku — plan tego nie rozróżniał. → jawnie w D-MEMSEC + test.
4. **P2 pozycyjne odsyłacze "above"** (reorg): tool-usage.ts:22/:84 wskazywałyby wstecz na treść za historią. → wyjątek od verbatim + 2 przeredagowania + grep-gate.
5. **P2 breakpoint B niespecyfikowalny pozycyjnie** (cache): historia legalnie kończy się system rows (continue/operator-cue), summary bez markera nie do odróżnienia. → engine markuje `history_tail` (ostatnia NIEPUSTA), mapper czysto mechaniczny; testy na taśmy produkcyjne.
6. **P2 per-term null-gating savings** (reorg+cache): "null-gating na obu cenach" zaimplementowane jako oba-wymagane ⇒ $0 savings dla WSZYSTKICH auto-providerów. → formuła z jawnym gatingiem per-term.
7. **P3 fallback oddawał cache historii bez powodu** (cache): merge turn-state ≠ rezygnacja z B. → fallback zachowuje B na history_tail.
8. **VERIFY edycja-001 niewidoczna dla istniejących DB** (ui): runner `version > MAX`; stale DB ⇒ pad logUsage każdego turnu. → numerowana idempotentna migracja 032 + lustro (świadome odejście od edit-001: usage_log to istniejąca tabela, nie nowa powierzchnia fazy memory).
9. **P3 crud-surface.test.ts pinuje exact-surface** (facade) → dopisany do §2/§4.
10. **P3 sprzeczność D-KINDS↔verbatim** (facade): wstrzyknięcie przykładów do empty-state łamałoby verbatim. → konsumenci v1 = tylko long-memory.ts:59/:161 (zmiana :161 2→4 przykładów intencjonalna, nic jej nie pinuje); empty-state w S9.
11. **P2 ujemne savings w UI** (cache+ui): `.min(0)` = contract_violation zabijające UsageChip; fmtCost renderuje "$-0.0012". → schema bez .min(0) jawnie; fmtSignedCost; gating ≠0; fixtures ujemne.
12. **P3 sprzężenie localTotal** (ui): netto-redefinicja zmienia fallback-estymatę kosztu. → jawna adnotacja + pin testem.
13. **P3 racjonalizacja D-SPLIT-MISSION** (reorg): churn per SLICE, nie per iterację; pin do snapshotu missionRunContext (nie żywy licznik).
14. **P3 "cacheWriteTokens zawsze zwracane" przesadzone** (ui) → §0a poprawione: tylko explicit-cache + write-pricing; brak ⇒ 0.
15. **P2/P3 testowy blast-radius nieобjęty** (reorg+facade+ui): turn-active-knowledge.test.ts (10-testowy drift-guard na messages[0]), knowledge.test.ts (import kasowanego modułu), 4 suity vex-app (toEqual/strict-parse/ipc-surface/SessionRuntimeBar.test.tsx ISTNIEJE). → §4 enumeruje wszystkie z planem portowania (intent drift-guarda zachowany).
16. **P3 flip routing↔activePlan + porządek pinowany świadomie** (reorg+facade) → jawnie w D-LAYOUT + test §4.1.

**ODRZUCONE / ZAMKNIĘTE:**
- „Gate explicit-cache wyprowadzać z `cacheWritePricePerM !== null` zamiast listy rodzin" (cache P3): ODRZUCONE jako gate pierwotny — katalog cenowy bywa niespójny (sam krytyk raportował placeholdery w docs), a lista 2 prefiksów z cytatem docs jest przewidywalna i tania w utrzymaniu; `cachePricePerM !== null` zostaje współ-warunkiem. Alternatywa odnotowana w komentarzu params.ts.
- „promptTokens może nie zawierać tokenów cache" (reorg VERIFY): ZAMKNIĘTE — soczewka cache potwierdziła w docs OpenRoutera, że zawiera; dodatkowo tożsamość w D-LIVETEST.
- Obawa o trailing system po tool rows w repair-pasach: ZWERYFIKOWANA jako non-issue (oba pasy zatrzymują skan na pierwszym nie-tool wierszu; produkcyjne taśmy JUŻ kończą się system rows — precedens silniejszy niż summary).

---

## §2. Pliki

**NOWE:**
- `src/vex-agent/memory/turn-context.ts`, `memory/kind-catalog.ts`, `engine/prompts/memory-section.ts`
- `src/vex-agent/db/migrations/032_usage_cache_savings.sql` + lustro `vex-app/resources/migrations/032_usage_cache_savings.sql`
- `scripts/_cache_livetest.ts` (throwaway — USUWANY po weryfikacji)
- testy: `memory/turn-context.test.ts`, `engine/prompts/memory-section.test.ts`

**EDYCJE (agent):** `engine/prompts/index.ts` (split static/turn), `base.ts`, `tool-usage.ts` (2 odsyłacze), `mission-run.ts`, `resume-packet.ts`; `engine/core/turn.ts` (bez prefetchu; 4-segmentowy buildProviderMessages + cacheHint; logUsage+2), `turn-loop-prompt-stack.ts`, `turn-loop.ts`; `db/repos/session-memories/*` (+`listUnresolvedOutstandingItems`), `db/repos/usage.ts`; `inference/types.ts` (cacheHint, cacheWriteTokens, cacheWritePricePerM), `inference/openrouter.ts` (_fetchConfig), `openrouter/params.ts`+`mappers.ts` (breakpointy A/B + fallback), `cost.ts`; `tools/registry/long-memory.ts`; `memory/index.ts`.

**EDYCJE (vex-app):** `src/main/database/usage-db.ts`, `src/shared/schemas/usage.ts`, `src/renderer/features/appShell/SessionRuntimeBar.tsx`.

**USUNIĘCIA:** `engine/prompts/{memory-state,knowledge-state,knowledge,memory-routing}.ts` (po portowaniu testów).

**NIE DOTYKAMY:** starych `knowledge_*` tooli/registry (S9), semantyki widoczności tooli, OD-1/FIX-3/FIX-4, kanałów IPC, fmtCost-currency, agent-side getStats.

---

## §3. Przepływ po zmianie

```
runTurnLoop → buildTurnPromptStack
  ├─ memory.getTurnContext(sessionId)   → MemoryTurnContext (branch-nullable)
  ├─ hasSessionMemory ← ctx.sessionStats (jedno źródło z sekcją)
  ├─ promptOptions.memorySection ← buildMemorySection(ctx)
  └─ tools ← getOpenAITools(visibilityCtx)
executeTurn
  ├─ buildPromptStack → { staticLayers, turnLayers }
  ├─ buildProviderMessages → [static(hint), summary(hint)?, …history(+history_tail hint), turn-state(hint)]
  └─ logUsage(+cachedSavings, +cacheWriteTokens)
inference/openrouter (params/mappers — mechaniczne, wg cacheHint)
  ├─ explicit-cache model + cachePricePerM≠null → A na static, B na history_tail
  ├─ fallback (wynik D-LIVETEST): merge turn-state→static part 2; B zostaje
  └─ extractUsage: cachedTokens + cacheWriteTokens (stream i non-stream)
vex-app main → usage-db (SUM-y) → DTO (bez .min(0) na savings) → UsageChip (⚡ + saved/net $)
```

---

## §4. Testy

1. **Porządek warstw** (prompt-stack.test.ts — aktualizacja istniejącego, w tym pin `Iteration: 5` z linii 269): staticLayers bez markerów zmiennych (`# Runtime Clock`, `# Memory`, Tool Map, `# Loaded Content`, `Iteration:`); turnLayers w porządku: pressure → resume → `# Memory`(routing na końcu) → activePlan → Tool Map → mission turn-state → one-shoty; base bez Loaded Content; grep-gate „above/below" między rozdzielonymi warstwami.
2. **buildProviderMessages**: 4 segmenty + cacheHint; history_tail = ostatnia NIEPUSTA (przypadki: taśma kończąca się continue-cue system row; pusty content na ogonie); pusta historia ⇒ [static, turn-state] bez history_tail; summary z markerem.
3. **memory-section**: empty-states (prawdziwe zera) vs **fail-states (branch null ⇒ linie pominięte, routing zostaje)**; capy 12/3000/200/500; obie szerokości kinds (5 vs pełna); 4 linie routingu verbatim.
4. **turn-context**: fail-soft per gałąź (knowledge throw ⇒ knowledge null, stats żywe; odwrotnie); happy-path; spójność hasSessionMemory↔sekcja (activeCount=0 ⇒ memory tools ukryte + „Skip memory_recall”).
5. **PORTOWANE SUITY (intent zachowany):** `turn-active-knowledge.test.ts` (drift-guard 10 testów na messages[0]) → przepisany na nowy szew: fasada+memory-section+segment turn-state providerMessages (limity 12/30, treść dociera do promptu, fail-soft); `knowledge.test.ts` → asercje do memory-section.test.ts PRZED usunięciem formattera.
6. **params/mappers (D-CACHE)**: anthropic+cena → A (content jako części) + B na history_tail (user/assistant/tool/system carrier); auto-provider → zero cacheControl; cachePricePerM=null → zero nawet dla anthropic; brak history_tail ⇒ brak B; **fallback-merge: jawny test, że [static(+cc), turn-state] zachowuje B na history_tail** (Codex gate R2); history_tail markowany po repair (taśma z nieodpowiedzianym tool-callem ⇒ marker za placeholderem).
7. **cost.ts/extractUsage**: per-term gating (cachePrice set + writePrice null + cachedTokens>0 ⇒ DODATNIE savings); ujemne savings (write-heavy); brak promptTokensDetails.cacheWriteTokens ⇒ surcharge 0; **pin nowego localTotal dla write-heavy fixture** (jawna zmiana fallback-estymaty); aktualizacja pinów cost-calculation.test.ts:51,96 + types.test.ts:121-126.
8. **usage repo**: logUsage +2 pola, default 0.
9. **vex-app (4 suity enumerowane):** `main/database/__tests__/usage-db.test.ts` (toEqual fixtures + SUM-y + ujemne savings + zero-row fallback), `shared/schemas/__tests__/usage.test.ts` (strict fixtures + nowe REQUIRED pola + reject-extra-key + ujemne przechodzi), `main/ipc/__tests__/ipc-handler-surface/messages-usage.test.ts` (fixtures mocków usage-db), `renderer/.../SessionRuntimeBar.test.tsx` (ISTNIEJE — fixtures z/bez savings + ujemny przypadek; stuby window.vex nietypowane ⇒ aktualizacja ŚWIADOMA, tsc nie złapie).
10. **resume-packet** + **crud-surface.test.ts** (exact-surface +1 nazwa).
11. **Integracja (temp-harness `_struct_tmp`, realny pgvector — DDL dotknięte ⇒ OBOWIĄZKOWA):** migracja 032 przechodzi na świeżej bazie ORAZ idempotentnie na bazie już-zmigrowanej; logUsage→SUM round-trip (w tym ujemne savings); `listUnresolvedOutstandingItems` 1:1 ze starym SQL.
12. **D-LIVETEST** (manualny, wzmocniony — bramka F3): wyniki per-segment do §6.

`tsc --noEmit` (agent) + `pnpm --dir vex-app lint` + celowane vitest.

---

## §5. Gate-points (dla Codex plan-gate)

1. D-LAYOUT: przeniesienia + DWA jawne wyjątki (odsyłacze pozycyjne ×2; flip routing↔activePlan); sygnały→routing→catalog zachowane; one-shoty/resume świadomie nie-cache'owane; semantyka one-shotów niezależna od pozycji warstwy (zweryfikowane: transcript-gate / consume-once per loop).
2. Trailing turn-state: precedens (taśmy produkcyjne kończą się system rows; oba repair-pasy nie ruszają ogona); ryzyko per-provider domknięte WZMOCNIONYM D-LIVETEST (per-segment, trailing-vs-merged) + fallback zachowujący B.
3. D-FACADE: branch-nullable ⇒ omission semantics RÓWNE dzisiejszym (fail ≠ empty); jedno źródło hasSessionMemory↔sekcja; filtry w repo; import-specifiers pinowane pod vi.mock.
4. D-CACHE: gating (lista rodzin z cytatem + cachePricePerM≠null) ⇒ zero markupu dla auto/bez-cache; turn-state nigdy z breakpointem; 2<4 breakpointów; engine markuje segmenty (zero heurystyk w mapperze); typy SDK natywne, zero `as any`.
5. D-SAVINGS: per-term gating (auto-providerzy dostają dodatnie savings); ujemne zapisywane; migracja 032 numerowana+idempotentna+lustrzana (NIE edycja 001 — stale-DB ⇒ pad logUsage); localTotal-coupling jawny i pinowany.
6. D-UI-COST: schema bez .min(0) na savings (jawnie); fmtSignedCost dla ujemnych; zero matematyki cen w rendererze; bez nowych kanałów; preload/bridge bez edycji.
7. Zero zmian semantyki widoczności tooli; OD-1 grep-gate czysty; stare knowledge_* nietknięte; granice procesów vex-app zachowane (renderer: tylko typy z shared).
8. Testowy blast-radius DOMKNIĘTY enumeratywnie (§4.5/§4.9/§4.10) — w tym port drift-guarda zamiast kasowania.

---

## §6. Ślad bramek

- Recon STRUCTURE (4 soczewki, poprzednia sesja) — fakty w §1.
- DeepResearch (OpenRouter caching + hierarchia): **DONE 2026-06-10** — §0a.
- Recon usage/pricing (3 soczewki /workflows): **DONE 2026-06-10** — D-SAVINGS/D-UI-COST/D-AUDIT.
- Krytyka adwersarialna /workflows (4 soczewki): **DONE 2026-06-10** — 4× SOUND_WITH_FIXES; rozsądzenie w §1a (16 wcielonych, 3 odrzucone/zamknięte).
- Codex plan-gate `harness-memory-structure`: **R1 BLOCKED-misframe (oceniał brak implementacji — odrzucone w całości ze sprostowaniem framingu) → R2 GREEN LIGHT (2026-06-10)** + 3 uzupełnienia wcielone: history_tail po repair, asercja payloadu cache_control, jawny test fallback-merge-zachowuje-B.
- Implementacja (Fable 5): **DONE 2026-06-11** — pełna powierzchnia §2; moja weryfikacja: tsc ×2 czyste, agent 326+61+59, vex-app 55, integracja realny pgvector 7/7 (032 świeża+idempotentna, ujemne savings round-trip, repo 1:1 z legacy SQL), grep-gates czyste, +1 fix odsyłacza (tool-usage.ts:48).
- Codex Phase-6: **GREEN, zero defektów (2026-06-11)**.
- **D-LIVETEST: ALL PASS (2026-06-11, Haiku 4.5 + gpt-4o-mini; 3 rundy — r1 padła na minimum cacheowalności Haiku 4096t przy prefiksie ~3.4k realnych tokenów, r2 ujawniła topologię, r3 komplet):**
  - Anthropic trailing: call1 write=9128 (FULL prompt — dowód HOISTU: OpenRouter wkleja trailing system PRZED historię w bloku system); call2 cached=**8569/9128 (94%)** write=559 uncached=0; call3 przyrostowy cached=8569; **trailing ≡ merged (identyczne 8569/559)** ⇒ `MERGE_TURN_STATE_FALLBACK_ENABLED` zostaje **false** (flip = no-op dla Anthropic, a trailing zachowuje pełny zysk na OpenAI-format).
  - Konsekwencja hoistu (Anthropic): steady-state hit = statyczny prefiks; turn-state+historia re-write ~1.25× przy churnie turn-state. Follow-up kandydat (poza fazą): zmniejszyć churn turn-state dla misji.
  - OpenAI auto (zero markupu): call2 cached=**8448/8509 (99.3%)** — system+HISTORIA cache'owane IN-PLACE z trailing turn-state.
  - Placement payloadu: 100% asercji PASS we wszystkich rundach (A na static, B na history_tail, turn-state/summary czyste, auto-provider zero markupu).
  - Skrypt `_cache_livetest.ts` USUNIĘTY po runie (throwaway wg §2).
- Bonus z fazy: zdiagnozowano u właściciela AVG Web Shield (TLS interception) blokujące cały HTTPS z Node — naprawione wyłączeniem skanowania HTTPS; kandydat produktowy: errno w logu verify + hint w UI wizarda.
