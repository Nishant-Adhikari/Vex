/**
 * Tool dispatcher — routes tool calls to the correct handler.
 *
 * The engine calls dispatchTool() for every tool call from the LLM.
 * Dispatcher decides: internal tool → direct handler, or
 * discover/execute → protocol runtime.
 *
 * Internal tool handlers are lazy-imported to avoid loading
 * all dependencies at startup.
 */

import type { ToolCallRequest, ToolResult } from "./types.js";
import type { InternalToolContext } from "./internal/types.js";
import { isInternalTool } from "./registry.js";
import { discoverProtocolCapabilities } from "./protocols/runtime.js";
import { executeProtocolTool } from "./protocols/runtime.js";
import logger from "@utils/logger.js";

/**
 * Dispatch a tool call to the appropriate handler.
 *
 * Returns a ToolResult that the engine feeds back to the LLM.
 * Never throws — errors are caught and returned as failed results.
 */
export async function dispatchTool(
  call: ToolCallRequest,
  context: InternalToolContext,
): Promise<ToolResult> {
  const startTime = Date.now();

  try {
    const result = await routeToolCall(call, context);
    const durationMs = Date.now() - startTime;

    logger.debug("tools.dispatch.completed", {
      tool: call.name,
      success: result.success,
      durationMs,
    });

    return result;
  } catch (err) {
    const durationMs = Date.now() - startTime;
    const message = err instanceof Error ? err.message : String(err);

    logger.warn("tools.dispatch.failed", {
      tool: call.name,
      error: message,
      durationMs,
    });

    return { success: false, output: `Tool ${call.name} failed: ${message}` };
  }
}

// ── Routing ──────────────────────────────────────────────────────

async function routeToolCall(
  call: ToolCallRequest,
  context: InternalToolContext,
): Promise<ToolResult> {
  // Protocol meta-tools
  if (call.name === "discover_tools") {
    const result = discoverProtocolCapabilities({
      query: typeof call.args.query === "string" ? call.args.query : undefined,
      namespace: typeof call.args.namespace === "string" ? call.args.namespace as any : undefined,
      includeMutating: call.args.includeMutating === true,
      includeDeclared: call.args.includeDeclared === true,
      limit: typeof call.args.limit === "number" ? call.args.limit : undefined,
    });
    return {
      success: result.success,
      output: JSON.stringify(result, null, 2),
      data: result as unknown as Record<string, unknown>,
    };
  }

  if (call.name === "execute_tool") {
    const toolId = typeof call.args.toolId === "string" ? call.args.toolId : "";
    const params = typeof call.args.params === "object" && call.args.params !== null
      ? call.args.params as Record<string, unknown>
      : {};

    if (!toolId) {
      return { success: false, output: "Missing required parameter: toolId" };
    }

    return executeProtocolTool(
      { toolId, params },
      { loopMode: context.loopMode, approved: context.approved },
    );
  }

  // Internal tools — route by name
  if (!isInternalTool(call.name)) {
    return { success: false, output: `Unknown tool: ${call.name}` };
  }

  return routeInternalTool(call, context);
}

// ── Internal tool routing ────────────────────────────────────────
// Stub implementations — each returns a placeholder until the
// corresponding handler module is fully implemented.
// This lets the system compile and tests pass while we build
// handlers incrementally.

async function routeInternalTool(
  call: ToolCallRequest,
  context: InternalToolContext,
): Promise<ToolResult> {
  switch (call.name) {
    // Web
    case "web_search":
    case "web_fetch":
      return stubResult(call.name, "Web handlers not yet migrated");

    // Files
    case "file_read":
    case "file_write":
    case "file_list":
    case "file_delete":
      return stubResult(call.name, "File handlers not yet migrated");

    // Memory
    case "memory_manage":
      return stubResult(call.name, "Memory handler not yet migrated");

    // Scheduling
    case "schedule_create":
    case "schedule_remove":
      return stubResult(call.name, "Scheduling handlers not yet migrated");

    // Subagents
    case "subagent_spawn":
    case "subagent_status":
    case "subagent_stop":
      return stubResult(call.name, "Subagent handlers not yet migrated");

    // Wallet
    case "wallet_read": {
      const { handleWalletRead } = await import("./internal/wallet.js");
      return handleWalletRead(call.args, context);
    }
    case "wallet_send_prepare": {
      const { handleWalletSendPrepare } = await import("./internal/wallet.js");
      return handleWalletSendPrepare(call.args, context);
    }
    case "wallet_send_confirm": {
      const { handleWalletSendConfirm } = await import("./internal/wallet.js");
      return handleWalletSendConfirm(call.args, context);
    }

    default:
      return { success: false, output: `Unknown internal tool: ${call.name}` };
  }
}

function stubResult(name: string, message: string): ToolResult {
  return {
    success: false,
    output: `[STUB] ${name}: ${message}. This handler will be implemented in a subsequent step.`,
  };
}
