# Providers — AI Runtime Detection & Skill Installation

> Adapter pattern for detecting and integrating with AI runtimes (OpenClaw, Claude Code, Codex, other). Handles skill installation (symlink/junction/copy), env resolution, and filesystem linking.
>
> **Last updated: 2026-03-30**
>
> **LLM maintainers:** If you modify any file in this folder, update this document to reflect the change — add/remove providers, update adapter interfaces, fix stale references.

---

## Directory Structure

```
src/providers/
  types.ts            — ProviderAdapter interface, SkillTargets, DetectionResult, SkillInstallResult
  registry.ts         — Provider registry: resolve by name, detect all, auto-detect best
  env-resolution.ts   — Provider-neutral .env handling (read, load, write app .env)
  link-utils.ts       — Filesystem linking (symlink → junction → copy fallback)
  openclaw.ts         — OpenClawAdapter: ~/.openclaw/, hot-reload, workspace target
  claude-code.ts      — ClaudeCodeAdapter: ~/.claude/skills/
  codex.ts            — CodexAdapter: ~/.agents/skills/
  other.ts            — OtherAdapter: manual install fallback
```

---

## ProviderAdapter Interface

Every provider implements:

```typescript
interface ProviderAdapter {
  name: ProviderName;           // "openclaw" | "claude-code" | "codex" | "other"
  displayName: string;
  detect(): DetectionResult;    // is this runtime installed?
  getSkillTargets(scope): SkillTargets;  // where to install skill
  installSkill(opts): SkillInstallResult; // symlink/copy skill
  getRestartInfo(): RestartInfo; // how to reload after install
}
```

---

## Providers

| Provider | Detection | Skill Location | Linking | Restart |
|----------|-----------|----------------|---------|---------|
| **OpenClaw** | `~/.openclaw/` exists + `openclaw.json` | `~/.openclaw/skills/echoclaw/` + `~/.openclaw/workspace/skills/echoclaw/` | Delegates to `setup/openclaw-link.ts` (user scope) or `linkToTarget` (project scope) | Hot-reload (automatic) |
| **Claude Code** | `~/.claude/` exists | `~/.claude/skills/echoclaw/` | `linkToTarget` (symlink → junction → copy) | Manual restart required |
| **Codex** | `~/.agents/` exists | `~/.agents/skills/echoclaw/` | `linkToTarget` (symlink → junction → copy) | Manual restart required |
| **Other** | Always detected (fallback) | Package source dir (no link) | Manual — returns `status: "manual_required"` | Manual |

---

## Registry (`registry.ts`)

| Function | Purpose |
|----------|---------|
| `resolveProvider(name)` | Get adapter by name. Aliases: `"claude"` → `"claude-code"` |
| `detectProviders()` | Run `detect()` on all 4 providers, return results map |
| `autoDetectProvider()` | Priority: openclaw → claude-code → codex → other (first detected wins) |

---

## Linking Strategy (`link-utils.ts`)

`linkToTarget(source, target, opts)`:

1. **Symlink** (Unix) or **Junction** (Windows) — preferred
2. If `EPERM` / `EACCES` → **Copy** fallback (cpSync recursive)
3. If target exists → requires `force: true` to overwrite
4. Handles both symlinks and directories at target

`getSkillSourcePath()` resolves `<package-root>/skills/echoclaw/` from the installed npm package.

---

## Env Resolution (`env-resolution.ts`)

Provider-neutral wrapper over `utils/dotenv.ts`:

| Function | Purpose |
|----------|---------|
| `loadProviderDotenv()` | Load `~/.echoclaw/.env` into `process.env` (called at CLI startup) |
| `readEnvValue(key, path)` | Read single key from a .env file |
| `writeAppEnvValue(key, value)` | Append/update key in `~/.echoclaw/.env` |

---

## Dependencies

| Module | What's used |
|--------|-------------|
| `config/paths.ts` | `ENV_FILE` |
| `utils/dotenv.ts` | .env file parsing/writing |
| `setup/openclaw-link.ts` | `linkOpenclawSkill()` for OpenClaw user-scope install |
| `openclaw/config.ts` | `getOpenclawHome()`, `loadOpenclawConfig()` |

---

## Consumed by

- `commands/skill.ts` — `echoclaw skill install`
- `commands/echo/connect.ts` — headless connect flow
- `commands/echo/assessment.ts` — runtime normalization
- `launcher/handlers/connect.ts` — HTTP connect plan/apply
- `cli-runtime.ts` — `loadProviderDotenv()` at startup
- `password/health.ts` — `readEnvValue()` for password source detection

---

## Tests

```bash
npx vitest run src/__tests__/providers/
```

| File | Coverage |
|------|----------|
| `providers-registry.test.ts` | Resolve, detect all, auto-detect priority |
| `providers-adapters.test.ts` | All 4 adapters: detect, targets, install, restart |
| `providers-link-utils.test.ts` | Symlink, junction, copy fallback, force overwrite |
| `compute-selection.test.ts` | Compute provider selection logic |
