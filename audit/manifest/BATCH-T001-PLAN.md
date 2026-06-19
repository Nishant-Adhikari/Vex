# Batch T-001 — AppShell renderer test-split (biggest; flat-describe + gather-all)

**Baseline:** `HEAD == origin/main == 772f775`. Clean tree. 1 Opus agent (RENDERER/jsdom). Combines the flat-describe split (T-012) + gather-all-module-scope (T-013) patterns. **Agent MUST NOT run the renderer vitest** (slow jsdom suite — caused the T5 timeout); grep-only self-check; the orchestrator runs the authoritative renderer vitest.

## File: `vex-app/src/renderer/features/appShell/__tests__/AppShell.test.tsx` (1447, 41 it, 4 vi.mock, ONE flat `describe("AppShell")` at 258, NO nested describe)
Module-scope (brace-depth-0) code — copy ALL of it (Codex enumerated the full set):
- **1-20:** imports.
- **21-74:** 4 `vi.mock` blocks (21 `@hugeicons/react`, 25 `@hugeicons/core-free-icons`, 60 `@thesvg/react`, 71 `../../wizard/steps/provider/ModelBrandIcon.js`).
- **75-96:** the `AppShell` dynamic import (`await import("../AppShell.js")`) + the module-scope `vi.fn` spies.
- **98-134:** a module-scope `beforeAll`.
- **136-~250:** the module-scope `beforeEach` (clears localStorage; resets session/chat/health/mission/runtime spies; resets `useUiStore`; installs default mock results; redefines `window.vex`) — it references the per-file spies, so duplicating per file is correct.
- **258-~1320:** `describe("AppShell", () => {` wrapping 41 `it`s directly (no nested describe).
- **1321-1447:** 6 module-scope `function` helper declarations (hoisted): `makeAgentRow` (1321), `renderShell` (1335), `renderShellStrict` (1358), `makeSessionRows` (1370), `localIsoDaysAgo` (1419), `makeHealthReport` (1426).

## Split rule (GATHER-ALL-MODULE-SCOPE + flat-describe grouping)
Create subdir `__tests__/AppShell/` and DELETE the original. Each new file = the UNION of EVERY module-scope statement (the imports + all 4 `vi.mock` + the module-scope `beforeEach` + all 6 helper `function`s) reproduced VERBATIM (depths recomputed), wrapped so its assigned `it`s run: `describe("AppShell", () => { <module-scope beforeEach> <its subset> })`, with the 6 helper functions reproduced at module scope (they hoist, so keep them as the original `function` declarations — after the describe is fine). Do NOT trace mock usage — copy all 4 vi.mock + all helpers into every file. Group the 41 `it`s by CONTIGUOUS ranges (each file gets a contiguous block, so allocation is unambiguous; the title-set guard catches any drop/dup):
- `shell-sidebar.test.tsx`        ← its 259-314 (4: hero/footer, Today/Yesterday/Older grouping, mission-mode filter, sidebar collapse/expand).
- `composer-send.test.tsx`        ← its 315-445 (6: submit via chat IPC, quick-action chips ×2, ENTER sends, Shift+Enter no-send, ENTER pending-guard).
- `composer-retry-stop.test.tsx`  ← its 446-786 (9: retry arming/re-send, double-submit guards, non-retryable/mode-gate, cross-session clear, Stop/streaming, 'Stopped.', bug-A Send-enable ×2).
- `welcome-create.test.tsx`       ← its 787-1001 (8: welcome→create draft/first-message/failed-send/StrictMode + new-session modal flex/mission/goal/name-gate).
- `pin.test.tsx`                  ← its 1002-1144 (4: Pinned section, setPinned, no-select-on-pin-key, missionStatus preserved).
- `remove-library.test.tsx`       ← its 1145-1320 (10: Browse-all library switch + remove dialog open/confirm/blocked-active/blocked-pending/state_changed/already_removed/not_found/Library-path/Cancel).
Total = 4+6+9+8+4+10 = 41. Keep its in ORIGINAL order within each file.

**Depth:** `appShell/__tests__/` → `appShell/__tests__/AppShell/` is +1. Recompute EVERY relative specifier +1: the component-under-test dynamic import `await import("../AppShell.js")` → `await import("../../AppShell.js")` (Codex catch); `../../../lib/api/sessions.js`, `../../../app/queryClient.js`, `../../../stores/uiStore.js` … → `../../../../…`; the `vi.mock("../../wizard/steps/provider/ModelBrandIcon.js")` → `../../../wizard/…`. The 3 package vi.mocks (@hugeicons ×2, @thesvg) + any `@`-alias (@shared) imports are UNCHANGED. node:* unchanged. (The agent recomputes ALL relative specifiers it copies.)

## Verification (owned by main Claude)
1. Title-set equality (HEAD vs new): 41 it. Identical multiset; describe title "AppShell" preserved (replicated across files = expected).
2. `pnpm --dir vex-app lint` (tsc -p + boundary) EXIT 0.
3. vex-app RENDERER vitest over the subdir → 41 passed, zero fail/skip: `pnpm --dir vex-app exec vitest run --no-file-parallelism src/renderer/features/appShell/__tests__/AppShell/`.
4. git scope: 1 original deleted + 1 new subdir; ZERO production/other-test; the pre-existing sibling component tests (ApprovalCard.test.tsx, etc.) UNTOUCHED. Codex final → 1 commit → FF push.

## Open questions for Codex
1. Confirm GATHER-ALL-MODULE-SCOPE is safe here (4 vi.mock incl. 3 package + 1 relative; the module-scope beforeEach; 6 hoisted helper functions) — any module-scope state mutated across its that breaks when its are separated (beyond the beforeEach reset)? Does the `beforeEach` (136) reference mock spies that must stay co-located? Cite.
2. Confirm the contiguous it-range groupings are clean (no it depends on a sibling it's side effect; testing-library renders are independent per-test).
3. Confirm the +1 depth applies to ALL relative imports + the ModelBrandIcon vi.mock; package mocks + @-aliases unchanged. Any relative specifier I should flag?
4. Is the renderer beforeEach/render lifecycle safe to replicate per file (no shared QueryClient/store singleton leaking across files)? Anything to serialize.
