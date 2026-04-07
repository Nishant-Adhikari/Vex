/**
 * Production MCP — tool bridge.
 *
 * For each tool returned by `getProductionTools()`, register an individual
 * MCP tool on the supplied `McpServer`. The handler dispatches the call
 * through the canonical Echo Agent dispatcher (`dispatchTool`) using a
 * fresh `InternalToolContext` created by `makeProductionContext()`.
 *
 * No `echo_internal` god-tool: every internal tool surfaces by its real
 * registry name (`knowledge_write`, `wallet_read`, …) so the agent in
 * Cursor / Claude Code / Codex sees exactly the same contract Echo Agent
 * uses internally.
 *
 * JsonSchema → Zod conversion is intentionally minimal: the registry's
 * JsonSchema dialect is also intentionally simple (objects with primitive
 * properties, optional `enum`, optional `required` list). A full schema
 * walker would be premature — extend `jsonSchemaToZodShape` if a registry
 * tool ever needs nested objects or complex array shapes.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { JsonSchema, ToolDef } from "@echo-agent/tools/types.js";
import { dispatchTool } from "@echo-agent/tools/dispatcher.js";
import { getProductionTools } from "./profile.js";
import { makeProductionContext } from "../context.js";
import logger from "@utils/logger.js";

/**
 * Register every production tool from the registry on the given McpServer.
 * `sessionIdProvider` returns the current MCP session id for each invocation
 * so the dispatched `InternalToolContext` carries the correct DB session id.
 */
export function registerProductionTools(
  server: McpServer,
  sessionIdProvider: () => string,
): void {
  const tools = getProductionTools();
  for (const tool of tools) {
    registerOne(server, tool, sessionIdProvider);
  }
  logger.info("mcp.tool_bridge.registered", { count: tools.length });
}

function registerOne(
  server: McpServer,
  tool: ToolDef,
  sessionIdProvider: () => string,
): void {
  const inputShape = jsonSchemaToZodShape(tool.parameters);

  server.registerTool(
    tool.name,
    {
      description: tool.description,
      inputSchema: inputShape,
    },
    async (args: Record<string, unknown>) => {
      const sessionId = sessionIdProvider();
      const context = makeProductionContext(sessionId);
      const toolCallId = `mcp-${tool.name}-${Date.now()}`;
      const result = await dispatchTool(
        { name: tool.name, args: args ?? {}, toolCallId },
        context,
      );
      return {
        content: [{ type: "text" as const, text: result.output }],
        isError: result.success ? undefined : true,
      };
    },
  );
}

// ── JsonSchema → Zod shape converter ────────────────────────────

/**
 * Convert the registry's lightweight JsonSchema dialect into a flat Zod
 * shape suitable for `McpServer.registerTool({ inputSchema })`.
 *
 * Supported per-property `type` values: string, number, boolean, object, array.
 * `enum` is honoured for string properties (becomes `z.enum([...])`).
 * Properties listed in `required` are mandatory; everything else is `.optional()`.
 *
 * Object / array property `type`s are accepted as opaque `z.record()` /
 * `z.array(z.unknown())` because the registry never recurses into nested
 * shapes — descriptions document inner structure for the LLM. If a future
 * tool needs a deep schema, extend this walker accordingly.
 */
export function jsonSchemaToZodShape(
  schema: JsonSchema,
): Record<string, z.ZodType> {
  const shape: Record<string, z.ZodType> = {};
  const requiredSet = new Set(schema.required ?? []);

  for (const [key, prop] of Object.entries(schema.properties)) {
    let zodType: z.ZodType;

    if (prop.enum && prop.enum.length > 0) {
      // z.enum requires a non-empty tuple
      zodType = z.enum(prop.enum as [string, ...string[]]);
    } else {
      switch (prop.type) {
        case "string":
          zodType = z.string();
          break;
        case "number":
          zodType = z.number();
          break;
        case "boolean":
          zodType = z.boolean();
          break;
        case "array":
          zodType = z.array(z.unknown());
          break;
        case "object":
          zodType = z.record(z.string(), z.unknown());
          break;
        default:
          // Unknown type — accept anything to avoid blocking the surface.
          // This should not happen with the current registry; if it does,
          // the test suite will catch it via `surface/profile.test.ts`.
          zodType = z.unknown();
      }
    }

    if (prop.description) {
      zodType = zodType.describe(prop.description);
    }
    if (!requiredSet.has(key)) {
      zodType = zodType.optional();
    }

    shape[key] = zodType;
  }

  return shape;
}
