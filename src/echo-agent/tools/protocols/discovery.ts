import {
  PROTOCOL_TOOLS,
  isAdvertisedProtocolNamespace,
  isKnownProtocolNamespace,
  isProtocolToolAvailable,
} from "./catalog.js";
import { buildDiscoverNamespaceDescription, getDiscoveryStringsForTool } from "./descriptions.js";
import type {
  ProtocolDiscoveryItem,
  ProtocolDiscoveryRequest,
  ProtocolDiscoveryResult,
  ProtocolToolManifest,
} from "./types.js";

const DEFAULT_DISCOVERY_LIMIT = 15;
const TOKEN_SPLIT_RE = /[^a-z0-9]+/g;
const CAMEL_CASE_RE = /([a-z0-9])([A-Z])/g;

interface ScoredManifest {
  manifest: ProtocolToolManifest;
  score: number;
}

interface WeightedSearchField {
  value: string;
  weight: number;
}

function normalizeText(value: string): string {
  return value
    .replace(CAMEL_CASE_RE, "$1 $2")
    .replace(TOKEN_SPLIT_RE, " ")
    .trim()
    .toLowerCase();
}

function tokenize(value: string): string[] {
  return normalizeText(value)
    .split(" ")
    .filter((token) => token.length > 1);
}

function buildSearchFields(manifest: ProtocolToolManifest): WeightedSearchField[] {
  const navigationFields = getDiscoveryStringsForTool(manifest.namespace, manifest.toolId)
    .map((value) => ({ value, weight: 4 }));
  return [
    { value: manifest.toolId, weight: 8 },
    { value: manifest.namespace, weight: 5 },
    { value: manifest.description, weight: 6 },
    ...navigationFields,
  ];
}

function scoreManifest(manifest: ProtocolToolManifest, rawQuery: string): number {
  const normalizedQuery = normalizeText(rawQuery);
  const queryTokens = tokenize(rawQuery);
  if (normalizedQuery.length === 0 || queryTokens.length === 0) return 1;

  let score = 0;
  const matchedTokens = new Set<string>();

  for (const field of buildSearchFields(manifest)) {
    const normalizedField = normalizeText(field.value);
    if (normalizedField.length === 0) continue;

    if (normalizedField.includes(normalizedQuery)) {
      score += field.weight * 6;
    }

    const fieldTokens = new Set(tokenize(field.value));
    let tokenMatches = 0;
    for (const token of queryTokens) {
      if (fieldTokens.has(token)) {
        matchedTokens.add(token);
        tokenMatches += 1;
      }
    }
    score += tokenMatches * field.weight;
  }

  if (matchedTokens.size === 0) return 0;
  if (matchedTokens.size === queryTokens.length) score += 12;
  return score;
}

function toDiscoveryItem(manifest: ProtocolToolManifest): ProtocolDiscoveryItem {
  return {
    toolId: manifest.toolId,
    namespace: manifest.namespace,
    lifecycle: manifest.lifecycle,
    description: manifest.description,
    mutating: manifest.mutating,
    params: manifest.params,
    exampleParams: manifest.exampleParams,
  };
}

function buildDiscoveryFailure(message: string): ProtocolDiscoveryResult {
  return {
    success: false,
    count: 0,
    totalCount: 0,
    hasMore: false,
    tools: [],
    warnings: [message],
  };
}

function resolveRequestedNamespace(rawNamespace: string | undefined): string | ProtocolDiscoveryResult | null {
  if (typeof rawNamespace !== "string" || rawNamespace.trim().length === 0) return null;

  const namespace = rawNamespace.trim();
  if (!isKnownProtocolNamespace(namespace)) {
    return buildDiscoveryFailure(`Unknown namespace "${namespace}". ${buildDiscoverNamespaceDescription()}`);
  }
  if (!isAdvertisedProtocolNamespace(namespace)) {
    return buildDiscoveryFailure(`Namespace "${namespace}" is reserved and not available through discover_tools. ${buildDiscoverNamespaceDescription()}`);
  }
  return namespace;
}

export function discoverProtocolCapabilities(
  request: ProtocolDiscoveryRequest,
): ProtocolDiscoveryResult {
  const limit = typeof request.limit === "number" && Number.isFinite(request.limit)
    ? Math.max(1, Math.floor(request.limit))
    : DEFAULT_DISCOVERY_LIMIT;

  const resolvedNamespace = resolveRequestedNamespace(request.namespace);
  if (resolvedNamespace && typeof resolvedNamespace !== "string") {
    return resolvedNamespace;
  }

  const query = typeof request.query === "string" ? request.query.trim() : "";
  const filteredTools = PROTOCOL_TOOLS
    // Defense-in-depth: reserved namespaces never leak to free-text discovery
    // even if a manifest is added before its allowlist entry is flipped.
    .filter((manifest) => isAdvertisedProtocolNamespace(manifest.namespace))
    .filter((manifest) => resolvedNamespace ? manifest.namespace === resolvedNamespace : true)
    .filter((manifest) => request.includeMutating ? true : !manifest.mutating)
    .filter((manifest) => {
      if (request.includeDeclared) {
        // Declared tools are metadata-only but env-gated lookups would still mislead.
        return !manifest.requiresEnv || Boolean(process.env[manifest.requiresEnv]?.trim());
      }
      return isProtocolToolAvailable(manifest);
    });

  const matchingTools: readonly ProtocolToolManifest[] = query.length === 0
    ? filteredTools
    : filteredTools
      .map((manifest): ScoredManifest => ({ manifest, score: scoreManifest(manifest, query) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score || a.manifest.toolId.localeCompare(b.manifest.toolId))
      .map((entry) => entry.manifest);

  const tools = matchingTools.slice(0, limit).map(toDiscoveryItem);
  const warnings: string[] = [];
  if (tools.length === 0) {
    warnings.push("No protocol capabilities matched the query/filter.");
  }
  if (matchingTools.length > tools.length) {
    warnings.push(`Showing first ${tools.length} of ${matchingTools.length} matching capabilities. Increase limit to see more.`);
  }

  return {
    success: true,
    count: tools.length,
    totalCount: matchingTools.length,
    hasMore: matchingTools.length > tools.length,
    tools,
    warnings,
  };
}
