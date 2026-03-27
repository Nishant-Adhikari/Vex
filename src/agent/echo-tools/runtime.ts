/**
 * echoTools runtime scaffold.
 *
 * This template keeps API shape stable before full implementation:
 * - discover_tools => protocol capabilities only
 * - execute_tool => protocol execution only
 *
 * Internal tools (memory_manage, subagent_*, file_*, web_*, schedule_*, trade_log)
 * are intentionally outside this catalog and remain direct runtime tools.
 */

import type {
  ProtocolToolManifest,
  ProtocolDiscoveryRequest,
  ProtocolDiscoveryResult,
  ProtocolExecuteRequest,
  PrepareProtocolExecutionResult,
} from "./types.js";
import { PROTOCOL_NAMESPACE_ALLOWLIST, PROTOCOL_TOOLS } from "./catalog.js";

const DEFAULT_DISCOVERY_LIMIT = 10;

function normalizeText(value: string): string {
  return value.trim().toLowerCase();
}

function matchesQuery(manifest: ProtocolToolManifest, query?: string): boolean {
  if (!query) return true;
  const q = normalizeText(query);
  const haystacks = [
    manifest.toolId,
    manifest.namespace,
    manifest.description,
    ...manifest.commandPath,
    ...manifest.docRefs,
  ];
  return haystacks.some((value) => normalizeText(value).includes(q));
}

function buildArgsString(manifest: ProtocolToolManifest, params: Record<string, unknown>): string {
  const positional = manifest.params
    .filter((param) => typeof param.positional === "number")
    .sort((a, b) => (a.positional ?? 0) - (b.positional ?? 0));

  const flagged = manifest.params.filter((param) => param.flag);
  const parts: string[] = [];

  for (const param of positional) {
    const value = params[param.key];
    if (value === undefined || value === null || value === "") continue;
    parts.push(String(value));
  }

  for (const param of flagged) {
    const value = params[param.key];
    if (value === undefined || value === null || value === "") continue;
    if (param.type === "boolean") {
      if (value === true) {
        parts.push(param.flag!);
      }
      continue;
    }
    parts.push(param.flag!, String(value));
  }

  return parts.join(" ");
}

/**
 * Manifest-backed discovery for protocol capabilities only.
 */
export function discoverProtocolCapabilities(
  request: ProtocolDiscoveryRequest,
): ProtocolDiscoveryResult {
  const limit = typeof request.limit === "number" && Number.isFinite(request.limit)
    ? Math.max(1, Math.floor(request.limit))
    : DEFAULT_DISCOVERY_LIMIT;

  const tools = PROTOCOL_TOOLS
    .filter((manifest) => request.namespace ? manifest.namespace === request.namespace : true)
    .filter((manifest) => request.includeMutating ? true : !manifest.mutating)
    .filter((manifest) => request.includeDeclared ? true : manifest.lifecycle === "active")
    .filter((manifest) => matchesQuery(manifest, request.query))
    .slice(0, limit)
    .map((manifest) => ({
      toolId: manifest.toolId,
      namespace: manifest.namespace,
      lifecycle: manifest.lifecycle,
      description: manifest.description,
      mutating: manifest.mutating,
      exampleParams: manifest.exampleParams,
      docRefs: manifest.docRefs,
    }));

  const warnings: string[] = [];
  if (tools.length === 0) {
    warnings.push("No protocol capabilities matched the current query/filter.");
  }
  const activeNamespaces = new Set(PROTOCOL_TOOLS.map((tool) => tool.namespace));
  const declaredOnly = PROTOCOL_NAMESPACE_ALLOWLIST.filter((namespace) => !activeNamespaces.has(namespace));
  if (declaredOnly.length > 0) {
    warnings.push(`Declared-only namespaces: ${declaredOnly.join(", ")}`);
  }

  return {
    success: true,
    count: tools.length,
    tools,
    warnings,
  };
}

/**
 * Prepare a protocol capability for executor-backed CLI dispatch.
 */
export function prepareProtocolExecution(
  request: ProtocolExecuteRequest,
): PrepareProtocolExecutionResult {
  const manifest = PROTOCOL_TOOLS.find((entry) => entry.toolId === request.toolId);
  if (!manifest) {
    return {
      ok: false,
      code: "ECHO_TOOL_NOT_FOUND",
      message: `Unknown protocol toolId: ${request.toolId}`,
    };
  }

  if (manifest.lifecycle !== "active") {
    return {
      ok: false,
      code: "ECHO_TOOL_DECLARED_ONLY",
      message: `Protocol tool is declared only and cannot execute yet: ${request.toolId}`,
    };
  }

  const params = request.params ?? {};
  for (const param of manifest.params) {
    const value = params[param.key];
    if (param.required && (value === undefined || value === null || value === "")) {
      return {
        ok: false,
        code: "ECHO_TOOL_VALIDATION_ERROR",
        message: `Missing required parameter "${param.key}" for ${request.toolId}`,
      };
    }
  }

  const mode = request.mode ?? "execute";
  const commandPath = mode === "preview" && manifest.previewCommandPath
    ? manifest.previewCommandPath
    : manifest.commandPath;
  const argsString = buildArgsString(manifest, params);

  return {
    ok: true,
    prepared: {
      manifest,
      mode,
      commandPath,
      toolCall: {
        command: commandPath.join("_"),
        args: argsString ? { args: argsString } : {},
        confirm: manifest.mutating,
      },
    },
    warnings: mode === "preview" && !manifest.previewCommandPath
      ? ["Preview mode requested but no preview command is defined; using execute command path."]
      : [],
  };
}
