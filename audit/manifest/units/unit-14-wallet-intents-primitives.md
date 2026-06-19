### 2.14 Work Unit 14 — Wallet intents and wallet primitives

#### Files & LOC

- `src/vex-agent/tools/internal/wallet/resolve.ts` 149 LOC
- `src/vex-agent/tools/internal/wallet/send.ts` 379 LOC — **god-file/refactor candidate**
- `src/vex-agent/tools/internal/wallet/send-types.ts` 87 LOC
- `src/vex-agent/tools/internal/wallet/send-execute-evm.ts` 184 LOC
- `src/vex-agent/tools/internal/wallet/send-execute-solana.ts` 211 LOC
- `src/tools/wallet/keystore.ts` 213 LOC
- `src/tools/wallet/solana-keystore.ts` 96 LOC
- `src/tools/wallet/multi-auth.ts` 169 LOC
- `src/tools/wallet/inventory.ts` 271 LOC
- `src/tools/wallet/backup-restore.ts` 722 LOC — **god-file/refactor candidate**
- `src/tools/wallet/backup.ts` 421 LOC — **god-file/refactor candidate**
- `src/vex-agent/db/repos/wallet-intents.ts`
- `src/vex-agent/db/migrations/025_wallet_intents.sql` 96 LOC

Tests:

- `src/__tests__/vex-agent/tools/internal/wallet/send.test.ts` 588 LOC — **test god-file**

#### Responsibility

- Resolve selected wallet address/signing authority.
- Prepare and confirm wallet send intents.
- Encrypt/decrypt local wallet keys.
- Execute EVM/Solana wallet sends.
- Backup/restore wallet material.
- Ensure session wallet scope and mission wallet policy.

#### Mechanisms/patterns

- Address-only read path before decrypt.
- Decrypt only immediately before broadcast.
- DB-backed wallet intent with TTL and status.
- Session ownership checks.
- Network/status/expiry validation.
- Restricted-mode approval gate before decrypt.
- CAS consume before execution.
- Staged EVM/Solana execution.
- Structural error hashes for failures.

#### Dependencies & data-flow

Entry points:

- Tool dispatcher routes wallet tools.
- Renderer wallets UI queries selected wallet/prepared intents through main.
- Protocol handlers call wallet resolution helpers.

Imports/dependencies:

- Wallet inventory/keystore.
- DB wallet intent repo.
- EVM/Solana execution helpers.
- Mission wallet policy.

Side effects:

- Wallet key decrypt.
- EVM/Solana RPC broadcast.
- DB wallet intent updates.
- Wallet backup/restore files.

#### Security surface

- Local user private keys.
- Session wallet scope must fail closed.
- Any default wallet fallback in production is high risk.
- Wallet confirmation must not auto-retry non-idempotent mutations.
- Backup/restore paths handle raw wallet material.

#### Hotspots

- `send.ts` 379 LOC is a key transaction lifecycle file.
- `backup-restore.ts` 722 LOC and `backup.ts` 421 LOC are crypto-sensitive.
- Protocol runtime default omitted wallet scope to `source:"default"` for legacy/test callers is risky if production bypasses dispatcher.
- JS string key material cannot be zeroized.

`console.*` density:

- Wallet failure paths use structural hashes; direct logging of key material must be prohibited. Audit direct console hits globally.

#### Tests

Covered:

- Wallet send.
- Wallet intents.
- Keystore.
- Inventory.
- Backup.
- Multi-auth.
- Protocol wallet scope.
- Polymarket wallet scope.

Not covered / unclear:

- Full OS-level backup/restore failure matrix.
- End-to-end approval → wallet broadcast.
- Retry/idempotency behavior for each EVM/Solana provider.
- Secret zeroization/lifetime beyond best-effort JS constraints.

#### Open risks/smells

- Audit every production caller for session wallet scope, not default wallet.
- Split backup/restore.
- Verify no wallet send mutation has automatic retry without idempotency.
- Keep signer import allowlist current.

