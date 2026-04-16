import {
  PROTOCOL_TOOLS,
  isAdvertisedProtocolNamespace,
  isKnownProtocolNamespace,
  isProtocolToolAvailable,
} from "./catalog.js";
import {
  buildDiscoverNamespaceDescription,
  getDiscoveryStringsForTool,
  getMatchingFacetsForTool,
  getProtocolNamespaceNavigation,
} from "./descriptions.js";
import { compileToolDiscoveryMetadata } from "./metadata-compile.js";
import type {
  ProtocolDiscoveryItem,
  ProtocolDiscoveryRequest,
  ProtocolDiscoveryResult,
  ProtocolToolManifest,
  ToolDiscoveryMetadata,
} from "./types.js";
import logger from "@utils/logger.js";

const DEFAULT_DISCOVERY_LIMIT = 5;
const TOKEN_SPLIT_RE = /[^a-z0-9]+/g;
const CAMEL_CASE_RE = /([a-z0-9])([A-Z])/g;
const BIAS_COVERAGE_THRESHOLD = 0.4;

// preferredFor/avoidFor bias gated at 40% catalog coverage to prevent sparse over-steering.
const biasFieldCoverage = computeBiasCoverage();

function computeBiasCoverage(): { preferredFor: boolean; avoidFor: boolean } {
  const total = PROTOCOL_TOOLS.length;
  if (total === 0) return { preferredFor: false, avoidFor: false };
  let preferredCount = 0;
  let avoidCount = 0;
  for (const manifest of PROTOCOL_TOOLS) {
    const meta = compileToolDiscoveryMetadata(manifest, getProtocolNamespaceNavigation(manifest.namespace));
    if (meta.preferredFor && meta.preferredFor.length > 0) preferredCount++;
    if (meta.avoidFor && meta.avoidFor.length > 0) avoidCount++;
  }
  const preferredPct = preferredCount / total;
  const avoidPct = avoidCount / total;
  const preferredPass = preferredPct >= BIAS_COVERAGE_THRESHOLD;
  const avoidPass = avoidPct >= BIAS_COVERAGE_THRESHOLD;
  if (!preferredPass) {
    logger.debug("discovery.coverage_gate", { field: "preferredFor", pct: (preferredPct * 100).toFixed(1), gated: true });
  }
  if (!avoidPass) {
    logger.debug("discovery.coverage_gate", { field: "avoidFor", pct: (avoidPct * 100).toFixed(1), gated: true });
  }
  return { preferredFor: preferredPass, avoidFor: avoidPass };
}

interface ScoredManifest {
  manifest: ProtocolToolManifest;
  score: number;
  whyMatched: string[];
}

interface WeightedSearchField {
  value: string;
  weight: number;
  /** Stable signal tag emitted in whyMatched when this field contributes to the score. */
  tag: string;
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
    .map((value) => ({ value, weight: 4, tag: "navigation" }));
  const navigationAliasSet = new Set(
    getProtocolNamespaceNavigation(manifest.namespace).aliases.map((a) => a.toLowerCase()),
  );
  const paramFields = manifest.params.flatMap((param) => [
    { value: param.key, weight: 6, tag: "params" },
    { value: param.description, weight: 6, tag: "params" },
  ]);

  const metadata = compileToolDiscoveryMetadata(manifest, getProtocolNamespaceNavigation(manifest.namespace));
  const metadataFields = buildMetadataFields(metadata, navigationAliasSet);

  return [
    { value: manifest.toolId, weight: 8, tag: "toolId" },
    { value: manifest.namespace, weight: 5, tag: "namespace" },
    { value: manifest.description, weight: 6, tag: "description" },
    ...navigationFields,
    ...paramFields,
    ...buildExampleQueryFields(manifest),
    ...metadataFields,
  ];
}

function buildMetadataFields(
  metadata: ToolDiscoveryMetadata,
  navigationAliasSet: Set<string>,
): WeightedSearchField[] {
  const fields: WeightedSearchField[] = [];
  if (metadata.canonicalSummary) {
    fields.push({ value: metadata.canonicalSummary, weight: 7, tag: "canonicalSummary" });
  }
  if (metadata.aliases) {
    for (const alias of metadata.aliases) {
      if (!navigationAliasSet.has(alias.toLowerCase())) {
        fields.push({ value: alias, weight: 5, tag: "metadata" });
      }
    }
  }
  if (metadata.exampleIntents) {
    for (const intent of metadata.exampleIntents) {
      fields.push({ value: intent, weight: 6, tag: "metadata" });
    }
  }
  return fields;
}

// Weight 3: shared across namespace, lower than per-tool params (6) to avoid oversteering.
function buildExampleQueryFields(manifest: ProtocolToolManifest): WeightedSearchField[] {
  const matchingFacets = getMatchingFacetsForTool(manifest.namespace, manifest.toolId);
  if (matchingFacets.length === 0) return [];
  const namespaceMetadata = getProtocolNamespaceNavigation(manifest.namespace);
  return namespaceMetadata.exampleQueries.map((value) => ({
    value, weight: 3, tag: "exampleQueries",
  }));
}

function scoreManifest(manifest: ProtocolToolManifest, rawQuery: string): { score: number; whyMatched: string[] } {
  const normalizedQuery = normalizeText(rawQuery);
  const queryTokens = tokenize(rawQuery);
  if (normalizedQuery.length === 0 || queryTokens.length === 0) return { score: 1, whyMatched: [] };

  let score = 0;
  const matchedTokens = new Set<string>();
  const whyMatched = new Set<string>();

  for (const field of buildSearchFields(manifest)) {
    const normalizedField = normalizeText(field.value);
    if (normalizedField.length === 0) continue;

    let fieldHit = false;
    if (normalizedField.includes(normalizedQuery)) {
      score += field.weight * 6;
      fieldHit = true;
    }

    const fieldTokens = new Set(tokenize(field.value));
    let tokenMatches = 0;
    for (const token of queryTokens) {
      if (fieldTokens.has(token)) {
        matchedTokens.add(token);
        tokenMatches += 1;
      }
    }
    if (tokenMatches > 0) {
      score += tokenMatches * field.weight;
      fieldHit = true;
    }
    if (fieldHit) whyMatched.add(field.tag);
  }

  if (matchedTokens.size === 0) return { score: 0, whyMatched: [] };
  if (matchedTokens.size === queryTokens.length) score += 12;

  score = applyBiasAdjustment(manifest, queryTokens, score, whyMatched);
  return { score, whyMatched: [...whyMatched] };
}

function applyBiasAdjustment(
  manifest: ProtocolToolManifest,
  queryTokens: string[],
  score: number,
  whyMatched: Set<string>,
): number {
  const metadata = compileToolDiscoveryMetadata(manifest, getProtocolNamespaceNavigation(manifest.namespace));
  const querySet = new Set(queryTokens);

  if (biasFieldCoverage.preferredFor && metadata.preferredFor) {
    const hit = metadata.preferredFor.some((phrase) =>
      tokenize(phrase).some((token) => querySet.has(token)),
    );
    if (hit) {
      score += 5;
      whyMatched.add("preferredFor");
    }
  }

  if (biasFieldCoverage.avoidFor && metadata.avoidFor) {
    const hit = metadata.avoidFor.some((phrase) =>
      tokenize(phrase).some((token) => querySet.has(token)),
    );
    if (hit) {
      score = Math.max(1, score - 5);
      whyMatched.add("avoidFor");
    }
  }

  return score;
}

function toDiscoveryItem(entry: ScoredManifest): ProtocolDiscoveryItem {
  return {
    toolId: entry.manifest.toolId,
    namespace: entry.manifest.namespace,
    lifecycle: entry.manifest.lifecycle,
    description: entry.manifest.description,
    mutating: entry.manifest.mutating,
    params: entry.manifest.params,
    exampleParams: entry.manifest.exampleParams,
    score: entry.score,
    whyMatched: entry.whyMatched,
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
    .filter((manifest) => isAdvertisedProtocolNamespace(manifest.namespace))
    .filter((manifest) => resolvedNamespace ? manifest.namespace === resolvedNamespace : true)
    .filter((manifest) => request.includeMutating ? true : !manifest.mutating)
    .filter((manifest) => {
      if (request.includeDeclared) {
        return !manifest.requiresEnv || Boolean(process.env[manifest.requiresEnv]?.trim());
      }
      return isProtocolToolAvailable(manifest);
    });

  const scoredTools: ScoredManifest[] = query.length === 0
    ? filteredTools.map((manifest) => ({ manifest, score: 0, whyMatched: [] }))
    : filteredTools
      .map((manifest): ScoredManifest => ({ manifest, ...scoreManifest(manifest, query) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score || a.manifest.toolId.localeCompare(b.manifest.toolId));

  const tools = scoredTools.slice(0, limit).map(toDiscoveryItem);
  const warnings: string[] = [];
  if (tools.length === 0) {
    warnings.push("No protocol capabilities matched the query/filter.");
  }
  if (scoredTools.length > tools.length) {
    warnings.push(`Showing first ${tools.length} of ${scoredTools.length} matching capabilities. Increase limit to see more.`);
  }

  return {
    success: true,
    count: tools.length,
    totalCount: scoredTools.length,
    hasMore: scoredTools.length > tools.length,
    tools,
    warnings,
  };
}
