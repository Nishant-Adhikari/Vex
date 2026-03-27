/**
 * Protocol runtime — discover_tools + execute_tool handlers.
 *
 * These are the two internal tools that the LLM uses to interact
 * with protocol capabilities. Discovery returns metadata.
 * Execution validates params, finds the handler, and calls it.
 */

import type {
  ProtocolDiscoveryRequest,
  ProtocolDiscoveryResult,
  ProtocolExecuteRequest,
  ProtocolExecutionContext,
} from "./types.js";
import type { ToolResult } from "../types.js";
import { PROTOCOL_TOOLS, PROTOCOL_NAMESPACE_ALLOWLIST, getProtocolHandler, getProtocolManifest } from "./catalog.js";
import logger from "@utils/logger.js";

const DEFAULT_DISCOVERY_LIMIT = 15;

// ── Discovery ────────────────────────────────────────────────────

function normalizeText(value: string): string {
  return value.trim().toLowerCase();
}

export function discoverProtocolCapabilities(
  request: ProtocolDiscoveryRequest,
): ProtocolDiscoveryResult {
  const limit = typeof request.limit === "number" && Number.isFinite(request.limit)
    ? Math.max(1, Math.floor(request.limit))
    : DEFAULT_DISCOVERY_LIMIT;

  const tools = PROTOCOL_TOOLS
    .filter(m => request.namespace ? m.namespace === request.namespace : true)
    .filter(m => request.includeMutating ? true : !m.mutating)
    .filter(m => request.includeDeclared ? true : m.lifecycle === "active")
    .filter(m => {
      if (!request.query) return true;
      const q = normalizeText(request.query);
      return [m.toolId, m.namespace, m.description]
        .some(v => normalizeText(v).includes(q));
    })
    .slice(0, limit)
    .map(m => ({
      toolId: m.toolId,
      namespace: m.namespace,
      lifecycle: m.lifecycle,
      description: m.description,
      mutating: m.mutating,
      params: m.params,
      exampleParams: m.exampleParams,
    }));

  const warnings: string[] = [];
  if (tools.length === 0) {
    warnings.push("No protocol capabilities matched the query/filter.");
  }

  const activeNamespaces = new Set(PROTOCOL_TOOLS.map(t => t.namespace));
  const declaredOnly = PROTOCOL_NAMESPACE_ALLOWLIST.filter(ns => !activeNamespaces.has(ns));
  if (declaredOnly.length > 0) {
    warnings.push(`Declared-only namespaces (coming soon): ${declaredOnly.join(", ")}`);
  }

  return { success: true, count: tools.length, tools, warnings };
}

// ── Execution ────────────────────────────────────────────────────

export async function executeProtocolTool(
  request: ProtocolExecuteRequest,
  context: ProtocolExecutionContext,
): Promise<ToolResult> {
  const manifest = getProtocolManifest(request.toolId);
  if (!manifest) {
    return {
      success: false,
      output: `Unknown protocol tool: ${request.toolId}. Use discover_tools to find available tools.`,
    };
  }

  if (manifest.lifecycle !== "active") {
    return {
      success: false,
      output: `Protocol tool "${request.toolId}" is declared but not yet executable.`,
    };
  }

  // Validate required params
  const params = request.params ?? {};
  for (const param of manifest.params) {
    if (param.required) {
      const value = params[param.key];
      if (value === undefined || value === null || value === "") {
        return {
          success: false,
          output: `Missing required parameter "${param.key}" for ${request.toolId}`,
        };
      }
    }
  }

  // Find handler
  const handler = getProtocolHandler(request.toolId);
  if (!handler) {
    return {
      success: false,
      output: `No handler registered for ${request.toolId}. This is a bug — manifest exists but handler is missing.`,
    };
  }

  // Execute
  const startTime = Date.now();
  try {
    const result = await handler(params, context);
    const durationMs = Date.now() - startTime;

    logger.info("protocol.execute.completed", {
      toolId: request.toolId,
      success: result.success,
      durationMs,
    });

    return result;
  } catch (err) {
    const durationMs = Date.now() - startTime;
    const message = err instanceof Error ? err.message : String(err);

    logger.warn("protocol.execute.failed", {
      toolId: request.toolId,
      error: message,
      durationMs,
    });

    return { success: false, output: `${request.toolId} failed: ${message}` };
  }
}
