/**
 * Tool registry — single source of truth for all tools the LLM can call.
 *
 * Defines internal tools (handled in-process) and two protocol meta-tools
 * (discover_tools, execute_tool) that give access to protocol capabilities.
 *
 * Public API module. ToolDef arrays live in `./registry/<domain>.ts` (one
 * file per cohesive domain) — this barrel concatenates them and exposes the
 * lookup / filtering / projection functions consumers depend on. Adding a
 * new tool = touch one domain file plus this barrel's import + concat.
 *
 * No trade_log — runtime captures automatically.
 * No memory_manage / memory_update — replaced by knowledge_* (canonical agent memory layer).
 */

import type { ToolDef, OpenAITool } from "./types.js";
import { toOpenAITools } from "./types.js";

import { PROTOCOL_TOOLS } from "./registry/protocol.js";
import { WEB_TOOLS } from "./registry/web.js";
import { DOCUMENT_TOOLS } from "./registry/documents.js";
import { KNOWLEDGE_TOOLS } from "./registry/knowledge.js";
import { SCHEDULING_TOOLS } from "./registry/scheduling.js";
import { PORTFOLIO_TOOLS } from "./registry/portfolio.js";
import { SETUP_TOOLS } from "./registry/setup.js";
import { MISSION_TOOLS } from "./registry/mission.js";
import { SUBAGENT_TOOLS } from "./registry/subagents.js";
import { EVM_TOOLS } from "./registry/evm.js";
import { WALLET_TOOLS } from "./registry/wallet.js";

// Order matters — the LLM sees tools in this order, which can subtly bias
// proactive selection. Keep this aligned with the historical layout.
const TOOLS: readonly ToolDef[] = [
  ...PROTOCOL_TOOLS,
  ...WEB_TOOLS,
  ...DOCUMENT_TOOLS,
  ...KNOWLEDGE_TOOLS,
  ...SCHEDULING_TOOLS,
  ...PORTFOLIO_TOOLS,
  ...SETUP_TOOLS,
  ...MISSION_TOOLS,
  ...SUBAGENT_TOOLS,
  ...EVM_TOOLS,
  ...WALLET_TOOLS,
];

// ── Registry API ─────────────────────────────────────────────────

const byName = new Map<string, ToolDef>(TOOLS.map(t => [t.name, t]));

export function getToolDef(name: string): ToolDef | undefined {
  return byName.get(name);
}

export function isInternalTool(name: string): boolean {
  return byName.has(name);
}

export function isMutatingTool(name: string): boolean {
  return byName.get(name)?.mutating === true;
}

export function getAllTools(): readonly ToolDef[] {
  return TOOLS;
}

/** Get tools as OpenAI format, filtering by mode, ENV availability, and role. */
export function getOpenAITools(
  chatMode: "full" | "restricted" | "off" = "off",
  role: "parent" | "subagent" = "parent",
): OpenAITool[] {
  const filtered = TOOLS
    .filter(t => !t.requiresEnv || Boolean(process.env[t.requiresEnv]?.trim()))
    .filter(t => !t.showOnlyWhenEnvMissing || !process.env[t.showOnlyWhenEnvMissing]?.trim())
    .filter(t => chatMode === "off" ? !t.proactive : true)
    .filter(t => !t.excludeRoles?.includes(role));
  return toOpenAITools(filtered);
}

/**
 * Surface for the production MCP server (`src/mcp`).
 *
 * Reuses the canonical env / showOnlyWhenEnvMissing / role filtering used
 * everywhere else. The MCP server is a passive bridge — it surfaces the
 * `parent`-role view of tools (no subagent child-only tools), drops anything
 * marked `excludeFromMcp` (e.g. `schedule_*`, `mission_stop` — runtime
 * concepts owned by Echo Agent, not the MCP host), and hard-excludes any
 * name starting with `subagent_` as defense in depth (today these are
 * already filtered by `excludeRoles: ["subagent"]` for child-only ones, but
 * parent-spawn tools like subagent_spawn / subagent_status / subagent_stop /
 * subagent_reply are NOT role-filtered out — they belong to parent. We do
 * NOT want them in MCP regardless of role).
 *
 * MCP does NOT pass a `chatMode` filter — there is no concept of "MCP mode".
 * Proactive tools (none today) would be visible.
 */
export function getProductionMcpTools(): readonly ToolDef[] {
  return TOOLS
    .filter(t => !t.requiresEnv || Boolean(process.env[t.requiresEnv]?.trim()))
    .filter(t => !t.showOnlyWhenEnvMissing || !process.env[t.showOnlyWhenEnvMissing]?.trim())
    .filter(t => !t.excludeRoles?.includes("parent")) // none today, defensive
    .filter(t => !t.excludeFromMcp)                   // schedule_*, mission_stop — echo-agent only
    .filter(t => !t.name.startsWith("subagent_"));    // hard guard for `full-minus-subagents`
}

/** Check if a tool is blocked for a given role. Hard enforcement at dispatch time. */
export function isToolBlockedForRole(name: string, role: "parent" | "subagent"): boolean {
  const def = byName.get(name);
  if (!def) return false;
  return def.excludeRoles?.includes(role) ?? false;
}
