# Batch P2-C — Polymarket manifest + embedding literal splits (A-036, A-037, A-038, A-039)

**Baseline:** `HEAD == origin/main == 2da3e83`. Clean tree. 4 Opus agents parallel, file-disjoint, all root `src/`. Nested-subdir convention. ZERO behavior change. Each is a single big DATA LITERAL (array/object) → split into per-resource chunk modules re-assembled in the façade.

## A-036 — `…/polymarket/manifests/clob.ts` (412)
**Façade export (exact):** `CLOB_TOOLS: readonly ProtocolToolManifest[]`.
Split the array into per-resource sub-array modules under `manifests/clob/` (orders / markets / account — group by the tool's `toolId` prefix). Façade re-assembles `CLOB_TOOLS = [...ordersTools, ...marketsTools, ...]` preserving the EXACT element order + every toolId. Move each manifest object VERBATIM.

## A-037 — `…/polymarket/manifests/gamma.ts` (460)
**Façade export (exact):** `GAMMA_TOOLS: readonly ProtocolToolManifest[]`.
Same pattern under `manifests/gamma/` (markets / events / search — group by toolId). Re-assemble preserving order + every toolId.

## A-038 — `…/embeddings/polymarket/clob.ts` (604)
**Façade export (exact):** `POLYMARKET_CLOB_DISCOVERY` (object — embedding/discovery entries).
Split the object's entries into per-resource modules under `embeddings/polymarket/clob/`; façade re-assembles `POLYMARKET_CLOB_DISCOVERY = { ...ordersEntries, ...marketsEntries, ... }` preserving EXACT keys + values. Move each entry VERBATIM.

## A-039 — `…/embeddings/polymarket/gamma.ts` (556)
**Façade export (exact):** `POLYMARKET_GAMMA_DISCOVERY` (object).
Same pattern under `embeddings/polymarket/gamma/`.

## Verification (owned by main Claude)
root `tsc` (the literals must typecheck against ProtocolToolManifest / the discovery type) + root vitest over manifest/discovery guards + 4 surface tests. Surface test pins: for manifests, the exact set + count of `toolId`s (and order); for discovery, the exact key set. git scope: 4 façades + 4 subdirs + 4 surface; zero importers. Codex final → per-item commit → FF push.

## Open questions for Codex
1. For each file: who imports the export (the manifest aggregator / embedding registry), and what's the strongest existing guard test (manifest↔handler key parity? discovery golden?)? Cite.
2. Confirm splitting the array/object by toolId/key group and re-assembling in the façade preserves EXACT element order (arrays) / key order (objects) — does anything depend on order? Any shared private const/helper across groups to single-source?
3. Any entry that doesn't fit a clean group (so I don't drop/force it)? Cite the toolId/key.
4. Anything to serialize, or an additional guard (e.g. exact toolId-set surface pin).
