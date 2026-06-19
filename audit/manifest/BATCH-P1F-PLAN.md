# Batch P1-F — Finish P1: openrouter, registry, kyber-limit, polymarket-clob (A-028, A-029, A-031, A-032)

**Baseline:** `HEAD == origin/main == 7ec4ff7`. Clean tree. 4 Opus agents parallel, file-disjoint, all root `src/`. Nested-subdir convention. ZERO behavior change.

## A-028 — `src/vex-agent/inference/openrouter.ts` (454) — a CLASS (only export: OpenRouterProvider)
The `openrouter/` subdir already has `cost.ts/errors.ts/mappers.ts/params.ts`. **Façade exports only `OpenRouterProvider` (class) — it STAYS in openrouter.ts.**
Extract ONLY clearly-stateless helper logic the class methods call (request-body building, response/usage parsing, stream-delta assembly) into NEW `openrouter/{request,response,stream}.ts` as functions; class methods call them. If a method needs heavy `this` (this.client/this.config/this.modelCache) and can't extract cleanly, **LEAVE IT in the class (honest minimal split, like A-019 — do not force or invent abstractions).**
**Importers (untouched):** src/lib/openrouter-client.ts, compact-jobs/chunker-call.ts, inference/registry.ts. **Guards:** openrouter-errors, cost-calculation, openrouter-mapper-usage, openrouter-mapper-orphan, openrouter-loadconfig, registry, mission-error-classifier tests.

## A-029 — `src/vex-agent/tools/registry.ts` (384) — AGGREGATOR (existing registry/ subdir holds tool-DEF modules)
**Façade exports (exact, 16):** `ToolVisibilityContext`, `ToolVisibilityBase`, `defaultVisibilityContext`, `getToolDef`, `isInternalTool`, `isMutatingTool`, `getPressureSafety`, `getActionKind`, `getAllTools`, `getVisibleToolDefs`, `getOpenAITools`, `isToolBlockedForRole`, `ToolMapCategory`, `TOOL_MAP_CATEGORIES`, `VisibleToolMapCategory`, `getVisibleToolsByCategory`.
**New modules under `tools/registry/` (sibling to the existing tool-def modules — first LIST the dir, pick NON-COLLIDING names):** `lookup.ts` (getToolDef, isInternalTool, isMutatingTool, getPressureSafety, getActionKind, getAllTools) · `visibility.ts` (ToolVisibilityContext, ToolVisibilityBase, defaultVisibilityContext, getVisibleToolDefs, isToolBlockedForRole) · `openai-tools.ts` (getOpenAITools) · `tool-map.ts` (ToolMapCategory, TOOL_MAP_CATEGORIES, VisibleToolMapCategory, getVisibleToolsByCategory).
**CRITICAL (cycles):** the existing `registry/*.ts` tool-def modules import the `ToolDef` type from its canonical source (NOT from the registry.ts façade). The NEW modules must likewise import `ToolDef`/types from their canonical module (e.g. tools/types.ts), NEVER from the façade. `getAllTools` still aggregates the existing tool-def modules unchanged. registry.ts façade re-exports all 16. If a clean acyclic seam isn't possible for a given symbol, keep it in the façade.
**Importers (untouched, 10):** turn-loop-tool-batch, turn-loop-prompt-stack, runner/{agent,mission-run,shared,setup-turn}, prompts/{tool-usage,tool-catalog}, subagents/runner, dispatcher, prequote/{record,gate}. **Guards:** registry-tool-map, tool-catalog, dispatcher-pressure-deny, turn-loop, runner tests.

## A-031 — `src/vex-agent/tools/protocols/kyberswap/handlers/limit-order.ts` (364)
**Façade export (exact):** `LIMIT_ORDER_HANDLERS` (Record<string, ProtocolHandler>).
Split by operation under `handlers/limit-order/{create,cancel,status,validation}.ts` (+ a `helpers.ts` if shared helpers exist); façade re-assembles `LIMIT_ORDER_HANDLERS` with identical keys. Like A-030.
**Importer (untouched):** kyberswap/handlers.ts. **Guard:** kyberswap-handlers.test.ts.

## A-032 — `src/vex-agent/tools/protocols/polymarket/handlers-clob.ts` (441) — first P2
**Façade export (exact):** `CLOB_HANDLERS` (Record<string, ProtocolHandler>).
Split by resource group under `polymarket/handlers-clob/{orders,markets,positions,auth}.ts` (+ helpers if shared); façade re-assembles `CLOB_HANDLERS` with identical keys. (Use `handlers-clob/` nested subdir — coexist with sibling handlers-*.ts.)
**Importer (untouched):** polymarket/handlers.ts. **Guard:** polymarket CLOB handler tests.

## Verification (owned by main Claude)
root `tsc` + `vex-app lint` + root vitest over guards + 4 surface tests. git scope: 4 façades + new subdirs + 4 surface; zero importers. Codex final → per-item commit → FF push.

## Open questions for Codex
1. A-028: is any of OpenRouterProvider's logic cleanly extractable to stateless functions, or is it mostly this-bound (→ honest minimal split)? Name what's safely extractable vs must-stay. Cite lines.
2. A-029: confirm the cycle-safe seam — where does ToolDef live, do existing registry/*.ts import the façade or the type module, and which of the 16 symbols can move to lookup/visibility/openai-tools/tool-map vs must stay in the façade? Any name collision with existing registry/*.ts? Cite lines.
3. A-031 / A-032: confirm each handler map is self-contained, the per-operation/per-resource split is clean, and key names + registry spread stay intact. Cite lines.
4. Anything to serialize, or extra guard.
