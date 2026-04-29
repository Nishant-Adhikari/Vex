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
  maybeGetProtocolNamespaceNavigation,
  getProtocolNamespaceNavigation,
} from "./descriptions.js";
import { compileToolDiscoveryMetadata } from "./metadata-compile.js";
import type {
  ProtocolDiscoveryItem,
  ProtocolDiscoveryRequest,
  ProtocolDiscoveryResult,
  ProtocolDiscoveryRetrievalMeta,
  ProtocolToolManifest,
  ToolDiscoveryMetadata,
} from "./types.js";
import { embedQuery } from "@vex-agent/embeddings/client.js";
import { loadEmbeddingConfig } from "@vex-agent/embeddings/config.js";
import { searchByVector } from "@vex-agent/db/repos/tool-embeddings.js";
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
    const meta = compileToolDiscoveryMetadata(manifest, maybeGetProtocolNamespaceNavigation(manifest.namespace));
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
  // Order matters: camelCase split must run BEFORE lowercase (its regex
  // looks for `[a-z0-9][A-Z]`), and lowercase must run BEFORE the token
  // split (TOKEN_SPLIT_RE = `[^a-z0-9]+` would otherwise strip uppercase
  // letters, turning "Plasma" → " lasma" → "lasma" and silently breaking
  // recall on every title-case proper noun like chain names).
  return value
    .replace(CAMEL_CASE_RE, "$1 $2")
    .toLowerCase()
    .replace(TOKEN_SPLIT_RE, " ")
    .trim();
}

function tokenize(value: string): string[] {
  return normalizeText(value)
    .split(" ")
    .filter((token) => token.length > 1);
}

function buildSearchFields(manifest: ProtocolToolManifest): WeightedSearchField[] {
  const namespaceNavigation = maybeGetProtocolNamespaceNavigation(manifest.namespace);
  const navStrings = getDiscoveryStringsForTool(manifest.namespace, manifest.toolId);
  const navigationFields = navStrings.map((value) => ({ value, weight: 4, tag: "navigation" }));
  const navAliasSet = new Set((namespaceNavigation?.aliases ?? []).map((a) => a.toLowerCase()));
  const navStringSet = new Set(navStrings.map((s) => s.toLowerCase()));
  const paramFields = manifest.params.flatMap((param) => [
    { value: param.key, weight: 6, tag: "params" },
    { value: param.description, weight: 6, tag: "params" },
  ]);
  const metadata = compileToolDiscoveryMetadata(manifest, namespaceNavigation);
  const metadataFields = buildMetadataFields(metadata, navAliasSet, navStringSet);
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
  navAliasSet: Set<string>,
  navStringSet: Set<string>,
): WeightedSearchField[] {
  const fields: WeightedSearchField[] = [];
  if (metadata.canonicalSummary) {
    fields.push({ value: metadata.canonicalSummary, weight: 7, tag: "canonicalSummary" });
  }
  // NOTE: `metadata.embeddingText` is deliberately NOT a lexical field.
  // It is reserved for dense retrieval (`tool_embeddings`) where it is
  // embedded and matched via cosine similarity. Including it as lexical
  // weight pressures authors to keyword-stuff passages, which hurts dense
  // recall quality. Lexical retrieval uses `canonicalSummary` (weight 7),
  // `aliases` (5), `exampleIntents` (6), `description` (6), and `chains` (3).
  // See A3 of the iteration plan and Phase 4 of the long-term architecture.
  if (metadata.aliases) {
    for (const alias of metadata.aliases) {
      if (!navAliasSet.has(alias.toLowerCase())) {
        fields.push({ value: alias, weight: 5, tag: "metadata" });
      }
    }
  }
  if (metadata.exampleIntents) {
    for (const intent of metadata.exampleIntents) {
      if (!navStringSet.has(intent.toLowerCase())) {
        fields.push({ value: intent, weight: 6, tag: "metadata" });
      }
    }
  }
  if (metadata.chains) {
    for (const chain of metadata.chains) {
      // Weight 3 — below aliases (5) and description (6). Chain alone never
      // outranks intent-relevant tools, but chain + intent both matching
      // tips the ranking toward the right chain-supporting tool.
      fields.push({ value: chain, weight: 3, tag: "chains" });
    }
  }
  return fields;
}

function buildExampleQueryFields(manifest: ProtocolToolManifest): WeightedSearchField[] {
  const matchingFacets = getMatchingFacetsForTool(manifest.namespace, manifest.toolId);
  if (matchingFacets.length === 0) return [];
  return matchingFacets.flatMap((facet) =>
    facet.hints.map((value) => ({ value, weight: 3, tag: "exampleQueries" })),
  );
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
      for (const token of queryTokens) matchedTokens.add(token);
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
  const metadata = compileToolDiscoveryMetadata(manifest, maybeGetProtocolNamespaceNavigation(manifest.namespace));
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

// ── Hybrid retrieval (A5) ───────────────────────────────────────
//
// `hybridScore` combines the lexical scorer above with a dense leg backed
// by `tool_embeddings` (pgvector cosine search). The two ranked lists are
// fused with Reciprocal Rank Fusion (k=60, the canonical Cormack et al.
// parameter). When the dense leg fails (embedding service down, missing
// rows for the configured model+dim), the function logs and falls back to
// pure lexical so user-facing latency never blocks on the sidecar.
//
// Activated only when `VEX_RETRIEVAL_MODE=hybrid`. Default mode (lexical)
// keeps the pre-A5 path verbatim — no behavioral change for production
// until the operator opts in.

const RRF_K = 60;
const DENSE_OVERFETCH_FACTOR = 4;

interface HybridScoreOutcome {
  scored: ScoredManifest[];
  meta: ProtocolDiscoveryRetrievalMeta;
}

async function hybridScore(
  query: string,
  candidates: ProtocolToolManifest[],
): Promise<HybridScoreOutcome> {
  // Lexical leg — same as the default path.
  const lexicalScored = candidates
    .map((manifest): ScoredManifest => ({ manifest, ...scoreManifest(manifest, query) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.manifest.toolId.localeCompare(b.manifest.toolId));

  const lexicalRank = new Map<string, number>();
  lexicalScored.forEach((entry, idx) => {
    lexicalRank.set(entry.manifest.toolId, idx + 1);
  });

  // Dense leg — embed query once, fetch top-(k * 4) by cosine.
  let denseFailed = false;
  let embeddingModel: string | undefined;
  let embeddingDim: number | undefined;
  const denseRank = new Map<string, number>();

  try {
    const config = loadEmbeddingConfig();
    const queryEmb = await embedQuery(query, config);
    embeddingModel = queryEmb.providerModel;
    embeddingDim = queryEmb.embedding.length;
    const hits = await searchByVector(queryEmb.embedding, {
      k: Math.max(candidates.length, DEFAULT_DISCOVERY_LIMIT * DENSE_OVERFETCH_FACTOR),
      embeddingModel: queryEmb.providerModel,
      embeddingDim: queryEmb.embedding.length,
    });
    hits.forEach((hit, idx) => {
      denseRank.set(hit.toolId, idx + 1);
    });
  } catch (err) {
    denseFailed = true;
    logger.warn("discovery.hybrid.dense_failed", {
      query,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // If dense produced nothing (failure or empty `tool_embeddings`), fall back
  // to lexical-only — return lexical scored as-is.
  if (denseRank.size === 0) {
    return {
      scored: lexicalScored,
      meta: {
        method: "lexical",
        denseFailed,
        embeddingModel,
        embeddingDim,
        candidateCount: candidates.length,
      },
    };
  }

  // RRF fusion. Iterate union of lexical and dense hit IDs, build new
  // scored list keyed by candidate manifests (dense may return a tool that
  // is filtered out by env / lifecycle — those drop here).
  const candidatesById = new Map(candidates.map((m) => [m.toolId, m]));
  const allIds = new Set<string>([...lexicalRank.keys(), ...denseRank.keys()]);
  const fused: ScoredManifest[] = [];
  for (const id of allIds) {
    const manifest = candidatesById.get(id);
    if (!manifest) continue;
    const lex = lexicalRank.get(id);
    const den = denseRank.get(id);
    const score = (lex !== undefined ? 1 / (RRF_K + lex) : 0)
                + (den !== undefined ? 1 / (RRF_K + den) : 0);
    const why: string[] = [];
    if (lex !== undefined) why.push("lexical");
    if (den !== undefined) why.push("dense");
    fused.push({ manifest, score, whyMatched: why });
  }
  fused.sort(
    (a, b) => b.score - a.score || a.manifest.toolId.localeCompare(b.manifest.toolId),
  );

  return {
    scored: fused,
    meta: {
      method: "hybrid",
      denseFailed: false,
      embeddingModel,
      embeddingDim,
      candidateCount: candidates.length,
    },
  };
}

function resolveRetrievalMode(): "lexical" | "hybrid" {
  const value = process.env.VEX_RETRIEVAL_MODE?.trim().toLowerCase();
  if (value === "hybrid") return "hybrid";
  if (value && value !== "lexical") {
    logger.warn("discovery.retrieval_mode.unknown", { value, fallback: "lexical" });
  }
  return "lexical";
}

export async function discoverProtocolCapabilities(
  request: ProtocolDiscoveryRequest,
): Promise<ProtocolDiscoveryResult> {
  const limit = typeof request.limit === "number" && Number.isFinite(request.limit)
    ? Math.max(1, Math.floor(request.limit))
    : DEFAULT_DISCOVERY_LIMIT;

  const resolvedNamespace = resolveRequestedNamespace(request.namespace);
  if (resolvedNamespace && typeof resolvedNamespace !== "string") {
    return resolvedNamespace;
  }

  const query = typeof request.query === "string" ? request.query.trim() : "";
  // Availability is strictly `isProtocolToolAvailable` (lifecycle + env).
  // The mutating filter that used to live here was cosmetic — the real
  // safety gate lives at execute time (`runtime.ts`:
  // `manifest.mutating && !context.approved && context.loopMode !== "full"
  // && !isPreviewExecution`). Hiding mutating tools from discovery only
  // prevented the agent from finding them and triggering the proper
  // approval flow, so the filter (and the `includeMutating` request flag)
  // were removed.
  const filteredTools = PROTOCOL_TOOLS
    .filter((manifest) => isAdvertisedProtocolNamespace(manifest.namespace))
    .filter((manifest) => resolvedNamespace ? manifest.namespace === resolvedNamespace : true)
    .filter((manifest) => isProtocolToolAvailable(manifest));

  const mode = resolveRetrievalMode();

  let scoredTools: ScoredManifest[];
  let retrievalMeta: ProtocolDiscoveryRetrievalMeta;

  if (query.length === 0) {
    scoredTools = filteredTools.map((manifest) => ({ manifest, score: 0, whyMatched: [] }));
    retrievalMeta = {
      method: mode,
      denseFailed: false,
      candidateCount: filteredTools.length,
    };
  } else if (mode === "hybrid") {
    const outcome = await hybridScore(query, filteredTools);
    scoredTools = outcome.scored;
    retrievalMeta = outcome.meta;
  } else {
    scoredTools = filteredTools
      .map((manifest): ScoredManifest => ({ manifest, ...scoreManifest(manifest, query) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score || a.manifest.toolId.localeCompare(b.manifest.toolId));
    retrievalMeta = {
      method: "lexical",
      denseFailed: false,
      candidateCount: filteredTools.length,
    };
  }

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
    retrieval: retrievalMeta,
  };
}
