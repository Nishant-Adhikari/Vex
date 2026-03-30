/**
 * Temporary shim for deleted src/agent/ module.
 *
 * TODO(echo-agent): This entire file goes away once commands/, launcher/,
 * and update/ are rewired to src/echo-agent/. Every export here is a
 * migration point — grep for "agent-shim" to find consumers.
 *
 * Migration status as of 2026-03-30:
 * - runtime-update-service.ts was downgraded to TODO-mode when it hits
 *   placeholder shim errors from this file.
 * - GET /api/runtime-update now returns a passive status instead of
 *   throwing `[agent-shim] ... legacy agent removed`.
 * - retry/apply/pull paths in runtime-update persist a short TODO error
 *   message and log `[runtime-update][TODO] ...` instead of surfacing the
 *   raw shim exception.
 * - runtime-update-state.ts no longer imports PACKAGE_ROOT from this shim;
 *   it resolves package.json locally from import.meta.url.
 * - Obsolete tests written against deleted src/agent/* modules were removed:
 *   - src/__tests__/runtime/runtime-update-service.test.ts
 *   - src/__tests__/runtime/runtime-update-state.test.ts
 * - Targeted verification after that downgrade passed:
 *   `pnpm exec vitest run src/__tests__/runtime src/__tests__/update`
 * - Full `pnpm test` still had unrelated failures outside this shim work:
 *   - src/__tests__/password/setup-provider-password.test.ts
 *   - src/__tests__/echo-agent/tools/dexscreener-handlers.test.ts
 *   - src/__tests__/echo-agent/tools/jaine-handlers.test.ts
 *   - src/__tests__/echo-agent/tools/polymarket-handlers.test.ts
 *   - src/__tests__/echo-agent/tools/dispatcher.test.ts
 *
 * Current known consumers still blocked on real Docker migration:
 * - src/commands/echo/agent-cmd.ts
 * - src/commands/echo/echoclaw.ts
 * - src/launcher/handlers/agent.ts
 * - src/launcher/handlers/tavily.ts
 * - src/update/runtime-update-service.ts
 *
 * Constants below are real values and safe to keep. Docker/runtime helpers
 * still throw on purpose so unfinished call sites fail loudly unless they
 * explicitly handle TODO-mode.
 */

import { join } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { platform } from "node:os";
import { CONFIG_DIR } from "./config/paths.js";

// ── Constants (stable, safe to keep) ─────────────────────────────────

// TODO(echo-agent): source from echo-agent config once available
export const AGENT_DEFAULT_PORT = 4201;
export const AGENT_DIR = join(CONFIG_DIR, "agent");
export const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const AGENT_PROJECT_NAME = "echo-agent";
export const AGENT_COMPOSE_FILE = join(PACKAGE_ROOT, "docker", "echo-agent", "docker-compose.yml");

// ── Types ────────────────────────────────────────────────────────────

// TODO(echo-agent): replace with echo-agent's own Docker status type
export interface DockerStatus {
  installed: boolean;
  running: boolean;
  composeAvailable: boolean;
  version: string | null;
}

export interface AgentComposeFailureInfo {
  detail: string | null;
  message: string;
  hint?: string;
  isReleaseIssue: boolean;
}

// ── Pure formatters (no side effects, safe to keep) ──────────────────

// TODO(echo-agent): move to echo-agent utility
export function getAgentUrl(port = AGENT_DEFAULT_PORT): string {
  return `http://127.0.0.1:${port}`;
}

// TODO(echo-agent): move to echo-agent utility
export function getDockerInstallUrl(): string {
  const p = platform();
  if (p === "win32") return "https://docs.docker.com/desktop/setup/install/windows-install/";
  if (p === "darwin") return "https://docs.docker.com/desktop/setup/install/mac-install/";
  return "https://docs.docker.com/engine/install/";
}

// TODO(echo-agent): move to echo-agent utility
export function formatDockerError(status: DockerStatus): string {
  if (!status.installed) {
    return [
      "Docker is not installed.",
      "",
      "Echo Agent requires Docker to run.",
      "",
      `Install Docker: ${getDockerInstallUrl()}`,
      "",
      "After installing, run: echoclaw echo agent start",
    ].join("\n");
  }
  if (!status.running) {
    return "Docker is installed but not running.\n\nStart Docker Desktop (or the docker daemon) and try again.";
  }
  if (!status.composeAvailable) {
    return "Docker Compose plugin is not available. Install it: https://docs.docker.com/compose/install/";
  }
  return "";
}

// TODO(echo-agent): move to echo-agent utility
export function getAgentComposeFailureInfo(
  err: unknown,
  _options: { defaultHint?: string } = {},
): AgentComposeFailureInfo {
  const detail = err instanceof Error ? err.message : String(err);
  return {
    detail,
    isReleaseIssue: false,
    message: `Docker compose failed: ${detail}`,
    hint: _options.defaultHint,
  };
}

// ── Docker functions (throw until echo-agent migration) ──────────────

function notImplemented(fn: string): never {
  throw new Error(`[agent-shim] ${fn}() — legacy agent removed. TODO: migrate to echo-agent/`);
}

// TODO(echo-agent): replace with echo-agent Docker check
export function checkDocker(): DockerStatus {
  return notImplemented("checkDocker");
}

// TODO(echo-agent): replace with echo-agent async Docker check
export async function checkDockerAsync(): Promise<DockerStatus> {
  return notImplemented("checkDockerAsync");
}

// TODO(echo-agent): replace with echo-agent compose runner
export function runAgentCompose(
  _args: string[],
  _options?: {
    envOverrides?: Record<string, string | undefined>;
    includeBuildOverride?: boolean;
    stdio?: "inherit" | "pipe";
    timeoutMs?: number;
  },
): string {
  return notImplemented("runAgentCompose");
}

// TODO(echo-agent): replace with echo-agent health check
export function isAgentRunning(): boolean {
  return notImplemented("isAgentRunning");
}

// TODO(echo-agent): replace with echo-agent health poller
export async function waitForAgentHealth(
  _port?: number,
  _options?: { attempts?: number; intervalMs?: number; timeoutMs?: number },
): Promise<boolean> {
  return notImplemented("waitForAgentHealth");
}

// TODO(echo-agent): replace with echo-agent image resolution
export function getAgentImage(): string {
  return notImplemented("getAgentImage");
}

// TODO(echo-agent): replace with echo-agent image tag resolution
export function getAgentImageTag(): string {
  return notImplemented("getAgentImageTag");
}
