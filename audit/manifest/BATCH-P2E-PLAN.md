# Batch P2-E — appShell/systemCheck component splits (A-053, A-054, A-055, A-056)

**Baseline:** `HEAD == origin/main == 10719f1`. Clean tree. 4 Opus agents parallel, file-disjoint, all vex-app renderer. Nested-subdir convention. ZERO behavior change. Same React-split pattern as P2-D: keep the file's public exports (component(s)+Props), extract presentational subcomponents / local hooks / pure helpers into a co-located `<Component>/` subdir; preserve rendering/state/effects/a11y; existing `.test.tsx` is the primary guard; renderer stays pure (no privileged import).

## A-053 — `appShell/SessionRows.tsx` (416) — already multi-export
**Exports (exact, 5):** `SessionGroups`, `SessionsLoadingPlaceholder`, `SessionsErrorPlaceholder`, `SessionsEmptyPlaceholder`, + the 5th (read it). All STAY on the façade.
Extract under `SessionRows/`: the per-row component, status badge, row actions, and each placeholder body. Keep the 5 exports re-exported from SessionRows.tsx. Importers (untouched): SessionsList, sessionListLayout, SessionsLibrary. Guard: `__tests__/AppShell.test.tsx`.

## A-054 — `appShell/SessionCreator.tsx` (380)
**Export (exact):** `SessionCreator`.
Extract under `SessionCreator/`: the form, wallet-scope picker, mode toggle, submit/validation helper (local hook). Keep `SessionCreator`. Importers (untouched): AppShell, SessionComposer, SessionWalletSelect. Guard: the AppShell/ReportIssueDialog tests that render it (run AppShell.test.tsx).

## A-055 — `appShell/ApprovalCard.tsx` (305) — SECURITY-relevant (approval decision UX)
**Exports (exact):** `ApprovalCardProps`, `ApprovalCard`.
Extract under `ApprovalCard/`: risk classification helper, countdown, decision actions, approval details. Keep `ApprovalCard`+Props. CRITICAL: preserve the reject-focus default, the risk/severity classification, and the EXTRA-confirmation gating for high/critical/destructive/user-wallet-broadcast actions (do not weaken any confirm gate). Importer (untouched): ApprovalsRegion. Guard: `__tests__/ApprovalCard.test.tsx` (dedicated) + ApprovalsRegion.test.tsx.

## A-056 — `systemCheck/SystemCheck.tsx` (367)
**Export (exact):** `SystemCheck`.
Extract under `SystemCheck/`: state/orchestration hook, DockerCheck, DatabaseCheck, EmbeddingCheck, Actions. Keep `SystemCheck`. Importers (untouched): App.tsx, compose/bootstrap/constants, docker/BootstrapPanel. Guard: `__tests__/SystemCheck.test.tsx`.

## Verification (owned by main Claude)
`vex-app lint` (tsc + boundary) + vex-app vitest over the 4 component tests (+ AppShell.test.tsx + ApprovalsRegion.test.tsx). git scope: 4 components + 4 subdirs; zero importers. Codex final → per-item commit → FF push.

## Open questions for Codex
1. For each: cleanly-extractable subcomponents/hooks/helpers vs must-stay (the props contract, top-level state/effect wiring). For A-053, list the exact 5 exports. Cite lines.
2. A-055: where are the risk classification + extra-confirmation gates (high/critical/destructive/user-wallet-broadcast) + reject-focus default? Confirm the split keeps them intact and the dedicated ApprovalCard.test.tsx covers them. Cite lines.
3. Any shared hook/helper already existing across these (don't duplicate)? Any renderer-purity risk in the extracted code? Cite.
4. Anything to serialize, or an additional invariant-guard (a11y, approval confirm gate).
