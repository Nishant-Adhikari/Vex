/**
 * Tool registry — single source of truth for all tools the LLM can call.
 *
 * Defines internal tools (handled in-process) and two protocol meta-tools
 * (discover_tools, execute_tool) that give access to protocol capabilities.
 *
 * No trade_log — runtime captures automatically.
 * No memory_update — deprecated, use memory_manage.
 */

import type { ToolDef, JsonSchema, OpenAITool } from "./types.js";
import { toOpenAITools } from "./types.js";

// ── execute_tool params schema ───────────────────────────────────

const EXECUTE_TOOL_PARAMS: JsonSchema = {
  type: "object",
  properties: {
    toolId: { type: "string", description: "Protocol tool ID from discover_tools" },
    params: { type: "object", description: "Tool parameters object" },
  },
  required: ["toolId", "params"],
};

// ── Internal tool definitions ────────────────────────────────────

const TOOLS: readonly ToolDef[] = [
  // Protocol meta-tools
  {
    name: "discover_tools", kind: "internal", mutating: false,
    description: "Search available protocol capabilities by query or namespace. Returns tool metadata (ID, params, description) for use with execute_tool.",
    parameters: { type: "object", properties: {
      query: { type: "string", description: "Free-text intent (e.g. 'bridge usdc', 'swap on solana')" },
      namespace: { type: "string", description: "Protocol filter (khalani, kyberswap, solana, polymarket)" },
      includeMutating: { type: "boolean", description: "Include mutating/trading capabilities" },
      includeDeclared: { type: "boolean", description: "Include not-yet-active capabilities" },
      limit: { type: "number", description: "Max tools to return" },
    } },
  },
  {
    name: "execute_tool", kind: "internal", mutating: false,
    description: "Execute a discovered protocol tool by toolId with structured params. Mutating tools require approval in restricted/off mode.",
    parameters: EXECUTE_TOOL_PARAMS,
  },

  // Web
  {
    name: "web_search", kind: "internal", mutating: false, requiresEnv: "TAVILY_API_KEY",
    description: "Search the internet — token research, market news, protocol docs, chain analytics, contract audits.",
    parameters: { type: "object", properties: {
      query: { type: "string", description: "Search query" },
    }, required: ["query"] },
  },
  {
    name: "web_fetch", kind: "internal", mutating: false, requiresEnv: "TAVILY_API_KEY",
    description: "Fetch any URL as markdown — docs, block explorers, dashboards, API responses.",
    parameters: { type: "object", properties: {
      url: { type: "string", description: "URL to fetch" },
    }, required: ["url"] },
  },

  // Files
  {
    name: "file_read", kind: "internal", mutating: false,
    description: "Load a knowledge file into context. Use preview=true to see first 1000 chars without full context load.",
    parameters: { type: "object", properties: {
      path: { type: "string", description: "File path" },
      preview: { type: "boolean", description: "Preview mode (first 1000 chars, no context load)" },
    }, required: ["path"] },
  },
  {
    name: "file_write", kind: "internal", mutating: false,
    description: "Create or update a knowledge file.",
    parameters: { type: "object", properties: {
      path: { type: "string", description: "File path" },
      content: { type: "string", description: "File content" },
    }, required: ["path", "content"] },
  },
  {
    name: "file_list", kind: "internal", mutating: false,
    description: "List files in a knowledge directory.",
    parameters: { type: "object", properties: {
      path: { type: "string", description: "Directory path" },
    } },
  },
  {
    name: "file_delete", kind: "internal", mutating: false,
    description: "Delete a knowledge file.",
    parameters: { type: "object", properties: {
      path: { type: "string", description: "File path" },
    }, required: ["path"] },
  },

  // Memory
  {
    name: "memory_manage", kind: "internal", mutating: false,
    description: "Manage persistent memory — list, append, replace, or delete entries. Memory is in every prompt, keep entries short (1-2 lines).",
    parameters: { type: "object", properties: {
      action: { type: "string", enum: ["list", "append", "replace", "delete"], description: "Action to perform" },
      append: { type: "string", description: "Text to append (action=append)" },
      id: { type: "number", description: "Entry ID (action=replace/delete)" },
      content: { type: "string", description: "New content (action=replace)" },
    }, required: ["action"] },
  },

  // Scheduling
  {
    name: "schedule_create", kind: "internal", mutating: false,
    description: "Create a recurring cron task.",
    parameters: { type: "object", properties: {
      name: { type: "string", description: "Task name" },
      cron: { type: "string", description: "Cron expression" },
      type: { type: "string", enum: ["cli_execute", "inference", "alert", "snapshot", "backup"], description: "Task type" },
      description: { type: "string", description: "Task description" },
      payload: { type: "object", description: "Task payload" },
    }, required: ["name", "cron", "type"] },
  },
  {
    name: "schedule_remove", kind: "internal", mutating: false,
    description: "Remove a scheduled task.",
    parameters: { type: "object", properties: {
      id: { type: "string", description: "Task ID" },
    }, required: ["id"] },
  },

  // Subagents
  {
    name: "subagent_spawn", kind: "internal", mutating: false,
    description: "Spawn a background subagent. Returns immediately. Use subagent_status to check progress.",
    parameters: { type: "object", properties: {
      name: { type: "string", description: "Echo-prefixed name (e.g. EchoSpark, EchoNibble)" },
      task: { type: "string", description: "Full task description with context and output location" },
      allow_trades: { type: "boolean", description: "Allow mutating/trading tools (default: false)" },
      max_iterations: { type: "number", description: "Max tool iterations (default: 25)" },
    }, required: ["name", "task"] },
  },
  {
    name: "subagent_status", kind: "internal", mutating: false,
    description: "Check status and results of spawned subagents.",
    parameters: { type: "object", properties: {
      id: { type: "string", description: "Subagent ID (omit for all)" },
    } },
  },
  {
    name: "subagent_stop", kind: "internal", mutating: false,
    description: "Stop a running subagent. Partial results preserved.",
    parameters: { type: "object", properties: {
      id: { type: "string", description: "Subagent ID" },
    }, required: ["id"] },
  },

  // Wallet
  {
    name: "wallet_read", kind: "internal", mutating: false,
    description: "Read wallet state — address, balance, or multi-chain token balances via Khalani.",
    parameters: { type: "object", properties: {
      action: { type: "string", enum: ["address", "balance", "balances"], description: "Read operation" },
      chain: { type: "string", enum: ["eip155", "solana"], description: "Chain family for address" },
      wallet: { type: "string", enum: ["eip155", "solana", "all"], description: "Wallet scope for balances" },
      chainIds: { type: "string", description: "Chain filter for balances (comma-separated)" },
    }, required: ["action"] },
  },
  {
    name: "wallet_send_prepare", kind: "internal", mutating: false,
    description: "Prepare a transfer intent (no broadcast). Returns intent ID for confirmation.",
    parameters: { type: "object", properties: {
      network: { type: "string", enum: ["eip155", "solana"], description: "Network family" },
      to: { type: "string", description: "Recipient address" },
      amount: { type: "string", description: "Amount in user-facing units" },
      token: { type: "string", description: "Token symbol or mint (Solana SPL)" },
    }, required: ["network", "to", "amount"] },
  },
  {
    name: "wallet_send_confirm", kind: "internal", mutating: true,
    description: "Confirm and broadcast a prepared transfer. Requires approval in restricted/off mode.",
    parameters: { type: "object", properties: {
      network: { type: "string", enum: ["eip155", "solana"], description: "Network family" },
      intentId: { type: "string", description: "Prepared intent ID" },
    }, required: ["network", "intentId"] },
  },
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

/** Get tools as OpenAI format, filtering by mode and ENV availability */
export function getOpenAITools(chatMode: "full" | "restricted" | "off" = "off"): OpenAITool[] {
  const filtered = TOOLS
    .filter(t => !t.requiresEnv || Boolean(process.env[t.requiresEnv]?.trim()))
    .filter(t => chatMode === "off" ? !t.proactive : true);
  return toOpenAITools(filtered);
}
