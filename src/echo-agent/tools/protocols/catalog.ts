/**
 * Protocol tool catalog — all protocol manifests in one place.
 *
 * New protocols register their manifests here.
 * Discovery searches this catalog. Execution looks up handlers.
 */

import type { ProtocolNamespace, ProtocolToolManifest, ProtocolHandler, PortfolioRole } from "./types.js";
import { PROTOCOL_NAMESPACE_NAVIGATION } from "./descriptions.js";
import { KHALANI_TOOLS } from "./khalani/manifest.js";
import { KHALANI_HANDLERS } from "./khalani/handlers.js";
import { SOLANA_JUPITER_TOOLS } from "./solana-jupiter/manifest.js";
import { SOLANA_JUPITER_HANDLERS } from "./solana-jupiter/handlers.js";
import { KYBERSWAP_TOOLS } from "./kyberswap/manifest.js";
import { KYBERSWAP_HANDLERS } from "./kyberswap/handlers.js";
import { DEXSCREENER_TOOLS } from "./dexscreener/manifest.js";
import { DEXSCREENER_HANDLERS } from "./dexscreener/handlers.js";
import { CHAINSCAN_TOOLS } from "./0g/chainscan/manifest.js";
import { CHAINSCAN_HANDLERS } from "./0g/chainscan/handlers.js";
import { JAINE_TOOLS } from "./0g/jaine/manifest.js";
import { JAINE_HANDLERS } from "./0g/jaine/handlers.js";
import { SLOP_TOOLS } from "./0g/slop/manifest.js";
import { SLOP_HANDLERS } from "./0g/slop/handlers.js";
import { ECHOBOOK_TOOLS } from "./echobook/manifest.js";
import { ECHOBOOK_HANDLERS } from "./echobook/handlers.js";
import { POLYMARKET_TOOLS } from "./polymarket/manifest.js";
import { POLYMARKET_HANDLERS } from "./polymarket/handlers.js";
import { SLOP_APP_TOOLS } from "./0g/slop-app/manifest.js";
import { SLOP_APP_HANDLERS } from "./0g/slop-app/handlers.js";

// ── Namespace allowlist ──────────────────────────────────────────

export const PROTOCOL_NAMESPACE_ALLOWLIST: readonly ProtocolNamespace[] = [
  "khalani",
  "kyberswap",
  "solana",
  "polymarket",
  "0g-compute",
  "0g-storage",
  "jaine",
  "slop",
  "dexscreener",
  "echobook",
  "chainscan",
  "slop-app",
] as const;

export const PROTOCOL_ADVERTISED_NAMESPACE_ALLOWLIST: readonly ProtocolNamespace[] =
  PROTOCOL_NAMESPACE_ALLOWLIST.filter((namespace) => PROTOCOL_NAMESPACE_NAVIGATION[namespace].advertised);

export function isKnownProtocolNamespace(value: string): value is ProtocolNamespace {
  return PROTOCOL_NAMESPACE_ALLOWLIST.includes(value as ProtocolNamespace);
}

export function isAdvertisedProtocolNamespace(value: string): value is ProtocolNamespace {
  return PROTOCOL_ADVERTISED_NAMESPACE_ALLOWLIST.includes(value as ProtocolNamespace);
}

// ── Runtime availability ─────────────────────────────────────────
//
// Mirrors the gate enforced by `discoverProtocolCapabilities` and
// `executeProtocolTool`. Single source of truth for "is this manifest
// actually usable right now". Projection / docs / instructions / prompt
// must reuse these so they never advertise tools that runtime would hide.

/** True iff the manifest is active AND its `requiresEnv` (if any) is set. */
export function isProtocolToolAvailable(manifest: ProtocolToolManifest): boolean {
  if (manifest.lifecycle !== "active") return false;
  if (manifest.requiresEnv && !process.env[manifest.requiresEnv]?.trim()) return false;
  return true;
}

/** Count tools in `namespace` that pass `isProtocolToolAvailable`. */
export function countAvailableToolsForNamespace(namespace: ProtocolNamespace): number {
  let count = 0;
  for (const tool of PROTOCOL_TOOLS) {
    if (tool.namespace === namespace && isProtocolToolAvailable(tool)) count += 1;
  }
  return count;
}

/**
 * Distinct unset env vars that gate active tools in `namespace`.
 * Empty array means no env gating (all required envs are present, or
 * none of the active tools declare `requiresEnv`). Used by docs /
 * instructions / prompt to render `_(requires X to enable)_` hints
 * when a namespace has zero available tools.
 */
export function getMissingEnvForNamespace(namespace: ProtocolNamespace): string[] {
  const missing = new Set<string>();
  for (const tool of PROTOCOL_TOOLS) {
    if (tool.namespace !== namespace) continue;
    if (tool.lifecycle !== "active") continue;
    if (!tool.requiresEnv) continue;
    if (process.env[tool.requiresEnv]?.trim()) continue;
    missing.add(tool.requiresEnv);
  }
  return [...missing].sort();
}

// ── All protocol manifests ───────────────────────────────────────

export const PROTOCOL_TOOLS: readonly ProtocolToolManifest[] = [
  ...KHALANI_TOOLS,
  ...SOLANA_JUPITER_TOOLS,
  ...KYBERSWAP_TOOLS,
  ...DEXSCREENER_TOOLS,
  ...CHAINSCAN_TOOLS,
  ...JAINE_TOOLS,
  ...SLOP_TOOLS,
  ...ECHOBOOK_TOOLS,
  ...POLYMARKET_TOOLS,
  ...SLOP_APP_TOOLS,
];

// ── Handler registry ─────────────────────────────────────────────

const HANDLER_MAP: Record<string, ProtocolHandler> = {
  ...KHALANI_HANDLERS,
  ...SOLANA_JUPITER_HANDLERS,
  ...KYBERSWAP_HANDLERS,
  ...DEXSCREENER_HANDLERS,
  ...CHAINSCAN_HANDLERS,
  ...JAINE_HANDLERS,
  ...SLOP_HANDLERS,
  ...ECHOBOOK_HANDLERS,
  ...POLYMARKET_HANDLERS,
  ...SLOP_APP_HANDLERS,
};

/** Get the handler function for a protocol tool by toolId */
export function getProtocolHandler(toolId: string): ProtocolHandler | undefined {
  return HANDLER_MAP[toolId];
}

/** Get a manifest by toolId */
export function getProtocolManifest(toolId: string): ProtocolToolManifest | undefined {
  return PROTOCOL_TOOLS.find(t => t.toolId === toolId);
}

// ── Namespace defaults ──────────────────────────────────────────
// Helper for "pure" namespaces. NOT runtime truth: mixed namespaces
// have tools in multiple PortfolioRole classes. Per-tool matrix in
// mutation-matrix.ts (MUTATION_MATRIX) is the canonical source-of-truth.

export type NamespaceDefault = "mixed_trading" | "bridge" | "non_portfolio";

export const NAMESPACE_DEFAULTS: Record<ProtocolNamespace, NamespaceDefault> = {
  solana: "mixed_trading",
  kyberswap: "mixed_trading",
  jaine: "mixed_trading",
  slop: "mixed_trading",
  polymarket: "mixed_trading",
  khalani: "bridge",
  dexscreener: "non_portfolio",
  chainscan: "non_portfolio",
  echobook: "non_portfolio",
  "slop-app": "non_portfolio",
  "0g-compute": "non_portfolio",
  "0g-storage": "non_portfolio",
};
