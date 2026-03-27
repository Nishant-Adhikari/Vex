/**
 * Protocol tool catalog — all protocol manifests in one place.
 *
 * New protocols register their manifests here.
 * Discovery searches this catalog. Execution looks up handlers.
 */

import type { ProtocolNamespace, ProtocolToolManifest, ProtocolHandler } from "./types.js";
import { KHALANI_TOOLS } from "./khalani/manifest.js";
import { KHALANI_HANDLERS } from "./khalani/handlers.js";

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
] as const;

// ── All protocol manifests ───────────────────────────────────────

export const PROTOCOL_TOOLS: readonly ProtocolToolManifest[] = [
  ...KHALANI_TOOLS,
  // Add more protocols here as they are implemented:
  // ...KYBERSWAP_TOOLS,
  // ...SOLANA_TOOLS,
  // ...POLYMARKET_TOOLS,
];

// ── Handler registry ─────────────────────────────────────────────

const HANDLER_MAP: Record<string, ProtocolHandler> = {
  ...KHALANI_HANDLERS,
  // Add more protocol handlers here:
  // ...KYBERSWAP_HANDLERS,
  // ...SOLANA_HANDLERS,
  // ...POLYMARKET_HANDLERS,
};

/** Get the handler function for a protocol tool by toolId */
export function getProtocolHandler(toolId: string): ProtocolHandler | undefined {
  return HANDLER_MAP[toolId];
}

/** Get a manifest by toolId */
export function getProtocolManifest(toolId: string): ProtocolToolManifest | undefined {
  return PROTOCOL_TOOLS.find(t => t.toolId === toolId);
}
