# Batch T4 — vex-app IPC test-splits (T-005, T-006, T-009)

**Baseline:** `HEAD == origin/main == f6ace2f`. Clean tree. 3 Opus agents parallel, file-disjoint, all vex-app `node`-project IPC tests. Proven harness (T1/T2/T3 landed green: 253 tests reorganized, title-sets identical, zero production touched). Conventions identical (full preamble per file, delete original, verbatim titles/bodies).

**vex-app specifics:** vitest `node` project include glob is RECURSIVE: `src/main/**/__tests__/**/*.test.ts` — so a subdir UNDER `__tests__/` named after the file (`__tests__/<name>/<area>.test.ts`) IS auto-discovered. `globals: true` (tests may not import describe/it from vitest — reproduce the original preamble exactly, whatever it is). Aliases `@shared`, `@vex-lib`, `@vex-agent`, `@tools`, `@utils`, `@config` UNCHANGED. **Depth:** moving from `__tests__/<name>.test.ts` to `__tests__/<name>/<area>.test.ts` adds +1 `../` to every RELATIVE specifier (e.g. handler-under-test `../<name>.js` → `../../<name>.js`; test-sender helper `../../__tests__/test-sender.js` → `../../../__tests__/test-sender.js`). Recompute ALL relative specifiers. Run vitest from repo root: `pnpm --dir vex-app exec vitest run --no-file-parallelism <subdir>`.

## T-005 — `vex-app/src/main/ipc/onboarding/__tests__/polymarket-setup.test.ts` (921, 25 it, 8 vi.mock, 8 top describe) — SECURITY (paired with A-062, already split)
Preamble above first describe (251). Split into `__tests__/polymarket-setup/` (6 files):
- `input-validation.test.ts` ← "input validation (Zod schema at boundary)".
- `preconditions.test.ts`    ← "preconditions" + "pre-network overwrite check (per selected wallet)".
- `re-auth.test.ts`          ← "vault re-auth".
- `acquire.test.ts`          ← "acquire mapping".
- `happy-path.test.ts`       ← "happy path — key selection via buildPolymarketVaultUpdates".
- `toctou-and-security.test.ts` ← "TOCTOU race re-check under the lock (per selected wallet)" + "security regressions".
NOTE: this `__tests__/` dir ALSO holds the unrelated `polymarket-setup-lock-nesting.test.ts` (added in P2-F) — DO NOT touch or move it; it stays a sibling of the new `polymarket-setup/` subdir. Delete only the original `polymarket-setup.test.ts`.

## T-006 — `vex-app/src/main/ipc/__tests__/wallet-export.test.ts` (881, 29 it, 8 vi.mock, 8 top describe)
Pair A-027/A-052 (done). Split into `__tests__/wallet-export/` (6 files):
- `input-validation.test.ts` ← "input validation (Zod schema at boundary)".
- `gates.test.ts`            ← "throttle gate" + "session lock check" + "password re-auth".
- `wallet-resolution.test.ts` ← "wallet resolution + decrypt / verify".
- `success-evm.test.ts`      ← "success path — EVM".
- `success-solana.test.ts`   ← "success path — Solana".
- `clipboard-lease.test.ts`  ← "clipboard lease lifecycle".
Delete original.

## T-009 — `vex-app/src/main/ipc/onboarding/__tests__/wallets.test.ts` (829, 32 it, 13 vi.mock, 11 top describe)
Pair A-007 (done). 11 handler describes → group into `__tests__/wallets/` (5 files):
- `generate.test.ts`       ← "walletGenerateEvm handler" + "walletGenerateSolana handler".
- `import.test.ts`         ← "walletImportEvm handler" + "walletAddEvm handler (inventory generate-add)" + "walletImportAddSolana handler (inventory import-add)".
- `backup.test.ts`         ← "walletRestoreFromBackup handler" + "walletOpenBackupFolder handler" + "walletListBackups handler".
- `export.test.ts`         ← "walletExportAll handler".
- `restore-archive.test.ts` ← "walletRestoreArchive handler" + "walletRestoreArchive schema validation".
Keep each describe's ORIGINAL relative order within a grouped file. Delete original. (13-mock preamble reproduced verbatim per file.)

## Verification (owned by main Claude)
1. Title-set equality (HEAD original vs new files): T-005=25, T-006=29, T-009=32.
2. `pnpm --dir vex-app lint` (tsc -p + boundary) EXIT 0.
3. vex-app vitest over the 3 subdirs → 25+29+32 = 86 passed, zero fail/skip. (For T-005 also confirm the sibling `polymarket-setup-lock-nesting.test.ts` still passes — run the whole `polymarket-setup/` subdir + that sibling.)
4. git scope: 3 originals deleted + 3 new subdirs; ZERO production/other-test; the lock-nesting sibling UNCHANGED. Codex final → 3 per-item commits → FF push.

## Open questions for Codex
1. Each file: do any top describes share a module-scope mutable beyond reset-in-beforeEach mocks (cite)? Are the groupings sound?
2. T-005: confirm the security describes ("TOCTOU race…", "security regressions") move verbatim and the sibling lock-nesting test is untouched.
3. Confirm the +1 relative-depth rule for these vex-app paths (handler-under-test + test-sender helper). Any specific specifier to flag?
4. Anything to serialize.
