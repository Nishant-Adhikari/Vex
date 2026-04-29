/**
 * Production MCP — surface projection.
 *
 * Thin re-export over `getProductionMcpTools()` from the registry. Keeping a
 * dedicated `src/mcp` projection module preserves a single import point in
 * `src/mcp/surface/tool-bridge.ts` and tests, even though today it is a
 * one-liner. If the surface ever grows additional MCP-specific filters
 * (per-host blocklist, capability negotiation, …) they live here, not in
 * the registry.
 */

import { getProductionMcpTools } from "@vex-agent/tools/registry.js";
import type { ToolDef } from "@vex-agent/tools/types.js";

export function getProductionTools(): readonly ToolDef[] {
  return getProductionMcpTools();
}
