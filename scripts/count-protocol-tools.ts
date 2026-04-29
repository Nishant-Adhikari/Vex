#!/usr/bin/env tsx
/**
 * Canonical counter for the Vex protocol surface.
 *
 * Single source of truth for the numbers cited in plans, RFCs, and
 * `agents_dm/discover-quality-baseline.md`. Resolves the historic 240 vs 258
 * discrepancy by reporting BOTH metrics and labelling them.
 *
 * Usage: `npx tsx scripts/count-protocol-tools.ts`
 */

import { PROTOCOL_TOOLS, PROTOCOL_NAMESPACE_ALLOWLIST, PROTOCOL_ADVERTISED_NAMESPACE_ALLOWLIST } from "../src/vex-agent/tools/protocols/catalog.js";
import { getAllTools } from "../src/vex-agent/tools/registry.js";

interface NamespaceCount {
  namespace: string;
  total: number;
  active: number;
  declared: number;
  mutating: number;
}

function countByNamespace(): NamespaceCount[] {
  const buckets = new Map<string, NamespaceCount>();
  for (const namespace of PROTOCOL_NAMESPACE_ALLOWLIST) {
    buckets.set(namespace, { namespace, total: 0, active: 0, declared: 0, mutating: 0 });
  }
  for (const manifest of PROTOCOL_TOOLS) {
    const bucket = buckets.get(manifest.namespace);
    if (!bucket) continue;
    bucket.total += 1;
    if (manifest.lifecycle === "active") bucket.active += 1;
    if (manifest.lifecycle === "declared") bucket.declared += 1;
    if (manifest.mutating) bucket.mutating += 1;
  }
  return [...buckets.values()].sort((a, b) => b.total - a.total);
}

function main(): void {
  const uniqueToolIds = new Set(PROTOCOL_TOOLS.map((t) => t.toolId));
  const advertisedSet = new Set<string>(PROTOCOL_ADVERTISED_NAMESPACE_ALLOWLIST);
  const reservedNamespaces = PROTOCOL_NAMESPACE_ALLOWLIST.filter((n) => !advertisedSet.has(n));
  const allTools = getAllTools();
  const metaTools = allTools.filter((t) => t.name === "discover_tools" || t.name === "execute_tool");
  const subagentTools = allTools.filter((t) => t.name.startsWith("subagent_"));
  const directInternal = allTools.length - metaTools.length;

  console.log("# Vex protocol surface — canonical counts\n");
  console.log("## Protocol manifests\n");
  console.log(`- PROTOCOL_TOOLS array length:       ${PROTOCOL_TOOLS.length}`);
  console.log(`- Unique toolIds:                    ${uniqueToolIds.size}`);
  console.log(`- Duplicate toolIds:                 ${PROTOCOL_TOOLS.length - uniqueToolIds.size}`);
  console.log("");

  console.log("## Namespaces\n");
  console.log(`- Total in allowlist:                ${PROTOCOL_NAMESPACE_ALLOWLIST.length}`);
  console.log(`- Advertised (visible to LLM):       ${PROTOCOL_ADVERTISED_NAMESPACE_ALLOWLIST.length}`);
  console.log(`- Reserved (hidden):                 ${reservedNamespaces.length}`);
  console.log(`  - reserved set: ${reservedNamespaces.join(", ")}`);
  console.log("");

  console.log("## Per-namespace breakdown (sorted by total)\n");
  console.log("| Namespace | Total | Active | Declared | Mutating |");
  console.log("|-----------|-------|--------|----------|----------|");
  for (const c of countByNamespace()) {
    console.log(`| ${c.namespace} | ${c.total} | ${c.active} | ${c.declared} | ${c.mutating} |`);
  }
  console.log("");

  console.log("## Internal tools (registry)\n");
  console.log(`- Registry total:                    ${allTools.length}`);
  console.log(`- Meta tools (discover/execute):     ${metaTools.length}`);
  console.log(`- Direct internal tools:             ${directInternal}`);
  console.log(`- subagent_* tools (MCP-excluded):   ${subagentTools.length}`);
  console.log("");
}

main();
