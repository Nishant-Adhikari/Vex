# QA matrix

Manual verification grid for release-candidate sign-off. Run every cell on a
clean install (see [`LOCAL_RUNTIME.md`](./LOCAL_RUNTIME.md) → "Clean-slate
reset") before declaring an RC ready.

Cells are scored:
- ✅ pass — feature behaves as specified, no console errors, no log warnings
  beyond the documented noise floor
- ⚠️ pass-with-notes — works, but flag observed friction
- ❌ fail — bug or regression; do not ship

## Platforms

| ID | Platform | Notes |
|---|---|---|
| W11 | Windows 11 (x64) | Primary release target |
| MAS | macOS 14+ Apple Silicon | Primary release target |
| MIN | macOS 14+ Intel | Best-effort (community-tested) |
| U22 | Ubuntu 22.04 (x64) | Primary release target |
| U24 | Ubuntu 24.04 (x64) | Primary release target |

## Feature matrix

| Feature | W11 | MAS | MIN | U22 | U24 |
|---|---|---|---|---|---|
| App boot → splash → SystemCheck visible | | | | | |
| System Check probes (Docker daemon, network, OS) | | | | | |
| Docker bootstrap panel — install/start prompts | | | | | |
| Compose up (fresh): pg + embeddings healthy < 10 min on cold pull | | | | | |
| Compose up: cancel mid-flight returns Result.error.code = `internal.cancelled` | | | | | |
| Migrations: 15 SQL files applied, progress events streamed | | | | | |
| Wizard step `keystore` — master password + keystore set, `secrets.vault.json` created | | | | | |
| Wizard step `wallets` — EVM + Solana wallets generated, addresses in `config.json` | | | | | |
| Wizard step `apiKeys` — Jupiter / Tavily / Rettiwt / Polymarket entries persisted to vault | | | | | |
| Wizard step `embedding` — model + dim accepted, embeddings runtime probed | | | | | |
| Wizard step `agentCore` — agent-core tuning written to `.env` | | | | | |
| Wizard step `provider` — OpenRouter API key set + AGENT_MODEL chosen | | | | | |
| Wizard step `review` — finalize + telemetry consent toggle + setup-complete marker written | | | | | |
| Unlock screen (after relaunch / lock-on-quit) — correct password unlocks | | | | | |
| Unlock screen — wrong password throttles after 5 attempts, retryAfterMs honoured | | | | | |
| Polymarket one-click setup from `apiKeys` step — credentials persisted | | | | | |
| Wallet private-key export (from app shell) — clipboard cleared after lease | | | | | |
| App quit relocks vault, in-flight handlers torn down via globalCleanup | | | | | |

Wizard step IDs match `vex-app/src/shared/schemas/wizard.ts` (canonical
order after the M12 mode/wake removal: `keystore → wallets → apiKeys →
embedding → agentCore → provider → review`). The `keystore` step
historically owned just the keystore but now also creates the master
password + vault — the ID stayed for backwards compat. Telemetry
consent is a checkbox inside the `review` step; there is no separate
Settings UI as of this writing.

## Per-OS known gotchas

### Windows 11
- `%APPDATA%` path uses backslashes; copy/paste from this doc may need
  escaping in a shell.
- Docker Desktop must have the WSL2 backend enabled. The Hyper-V backend
  has bind-mount path bugs not yet reproduced in CI.

### macOS (Apple Silicon + Intel)
- First launch after install triggers Gatekeeper. RC binaries are not yet
  notarized — Gatekeeper bypass via `xattr -d com.apple.quarantine` is
  required and documented in the release flow (out of scope here).
- Keychain integration is NOT used; secrets live in the vault file.

### Ubuntu 22.04 + 24.04
- `electron.shell.openExternal` calls into `xdg-open` from `xdg-utils`.
  A standard Ubuntu desktop install ships this; **minimal / headless
  containers may not**, in which case `sudo apt-get install -y xdg-utils`.
- The embeddings-runtime image is ~333 MB; first-run compose-up downloads
  it from HuggingFace and can take 5–15 min on slow networks.

## Reporting

Open one GitHub issue per failing cell with:
- Cell coordinates (feature + platform)
- App version + commit SHA (visible in the dev diagnostics panel,
  or from `dist/main/index.js` build metadata)
- Repro steps starting from a clean install
- Relevant log slice (`.electron-state/logs/main.log` — redact any
  secrets / wallet addresses before pasting)
