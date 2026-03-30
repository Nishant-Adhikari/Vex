# Password — Keystore Password Health & Compatibility

> Detects, validates, and resolves the keystore password across multiple sources. Guards against password drift, missing passwords, and invalid decryption before agent/container start.
>
> **Last updated: 2026-03-30**
>
> **LLM maintainers:** If you modify any file in this folder, update this document to reflect the change — add/remove files, update descriptions, fix stale references.

---

## Directory Structure

```
src/password/
  health.ts    — Password health diagnostics (status, source, drift detection, decrypt validation)
  compat.ts    — Pre-start guard: blocks agent if password is drifted/invalid, ensures ENV is set
```

---

## Password Sources

The keystore password can come from two places:

| Source | Location | Label |
|--------|----------|-------|
| `env` | `process.env.ECHO_KEYSTORE_PASSWORD` | Set by shell, CI, or parent process |
| `app-env` | `~/.echoclaw/.env` → `ECHO_KEYSTORE_PASSWORD` | Set by EchoClaw setup/commands |

Resolution order: `getKeystorePassword()` (from `utils/env.ts`) returns whichever is available — `env` takes priority over `app-env`.

---

## Health Statuses (`health.ts`)

`getPasswordHealth()` returns:

| Status | Meaning |
|--------|---------|
| `ready` | Password resolved, single source, decrypts keystore |
| `missing` | No password found in any source |
| `drift` | Multiple sources with **different** values — dangerous, blocks agent start |
| `invalid` | Password found but **fails to decrypt** the keystore |

### Drift detection

If both `env` and `app-env` are set but contain different values → `drift`. The `driftSources` array lists which sources conflict.

### Decrypt validation

When keystore exists and password is resolved, `health.ts` attempts actual decryption via `decryptPrivateKey()`. If it throws → `invalid`.

---

## Agent Compatibility Guard (`compat.ts`)

`ensureAgentPasswordReadyForContainer()`:

1. Calls `getPasswordHealth()`
2. **Throws** `EchoError` if `drift` — "conflicting password sources detected"
3. **Throws** `EchoError` if `invalid` — "password does not decrypt the wallet keystore"
4. If `ready` or `missing` — sets `process.env.ECHO_KEYSTORE_PASSWORD` so Docker compose inherits it
5. Returns `{ health, migrated, appPath }`

Called before every agent start (both CLI `agent-cmd.ts` and launcher `handlers/agent.ts`).

---

## Dependencies

| Module | What's used |
|--------|-------------|
| `utils/env.ts` | `getKeystorePassword()` — resolve from env/app-env |
| `providers/env-resolution.ts` | `readEnvValue()` — read specific key from .env file |
| `tools/wallet/keystore.ts` | `keystoreExists()`, `loadKeystore()`, `decryptPrivateKey()` |
| `config/paths.ts` | `ENV_FILE` |
| `errors.ts` | `EchoError`, `ErrorCodes` |

---

## Consumed by

- `commands/echo/agent-cmd.ts` — before `docker compose up`
- `commands/echo/echoclaw.ts` — before interactive agent start
- `launcher/handlers/agent.ts` — before HTTP-triggered agent start
- `update/runtime-update-service.ts` — before runtime update apply
- `commands/echo/password-health.ts` — diagnostic display

---

## Tests

```bash
npx vitest run src/__tests__/password/
```

| File | Coverage |
|------|----------|
| `password-health.test.ts` | All 4 statuses, drift detection, decrypt validation, source resolution |
| `password-compat.test.ts` | Agent guard: drift/invalid throw, ready/missing pass-through |
| `setup-provider-password.test.ts` | Password setup flow |
