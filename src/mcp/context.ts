/**
 * Production MCP — `InternalToolContext` factory.
 *
 * The MCP server is a passive tool surface bridge over Vex Agent's existing
 * dispatcher / registry / repos. It is NOT an agent — it has no `loopMode`,
 * no autonomous loop, no own decision making. The fields below are inherited
 * from `InternalToolContext` (which was designed for Vex Agent's mission
 * loop) and the values are chosen so that the dispatcher executes the tool
 * call directly, with no server-side gate.
 *
 * Concretely:
 *   - `loopMode: "full"` and `approved: true` are dispatcher gate bypass
 *     flags. They do NOT mean "MCP runs in full mode" — MCP has no modes.
 *     They mean "the dispatcher's mutation gate (designed for Vex Agent
 *     mission loop) does not apply here". Gate decisions for MCP belong to
 *     the host MCP client (Claude Code / Cursor / Codex permission UX) and
 *     to the transport boundary (stdio process trust / HTTP bearer token).
 *   - `role: "parent"` so child-only subagent tools (`subagent_request_parent`,
 *     `subagent_report_complete`) are filtered out by registry, AND the
 *     `getProductionMcpTools` projection separately hard-excludes any
 *     `subagent_*` tool by name as defense in depth.
 *   - `sourceSurface: "mcp_local"` and `sourceSession: <sessionId>` so
 *     knowledge writes coming through MCP are tagged in the
 *     `knowledge_entries.source_surface` column for audit / future export.
 *   - `loadedDocuments` is unused (MCP has no document context tracking) but
 *     must be a real Map because some handlers (e.g. `knowledge_get`) call
 *     `.set()` on it.
 *   - `missionRunId: null` because MCP is not a mission run.
 *
 * If a future programmatic MCP client needs a server-side gate, that is a
 * separate architecture (a proxy MCP routing through Vex Agent mission
 * loop), NOT a parameter on this factory. v1 has no `requireApproval` knob.
 */

import type { InternalToolContext } from "@vex-agent/tools/internal/types.js";

export function makeProductionContext(sessionId: string): InternalToolContext {
  return {
    sessionId,
    loadedDocuments: new Map(),
    loopMode: "full",            // dispatcher gate bypass — NOT a mode statement
    approved: true,              // dispatcher gate bypass — NOT an approval statement
    role: "parent",              // hides child-only subagent tools via registry filter
    missionRunId: null,          // MCP is not a mission run
    sessionKind: "chat",         // MCP is a passive tool surface, never a mission/autonomous runtime
    contextUsageBand: "normal",  // no turn loop → no accumulating pressure to surface
    sourceSurface: "mcp_local",  // knowledge provenance tag
    sourceSession: sessionId,
  };
}
