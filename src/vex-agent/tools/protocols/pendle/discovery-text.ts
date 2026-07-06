/**
 * Pendle discovery text — chain list for low-weight lexical recall.
 * Pendle runs on 11 chains; the slugs come straight from the chain registry
 * (`@tools/pendle/chains.ts`) so this list never drifts from what the tools
 * actually support.
 */

import { PENDLE_CHAIN_REGISTRY } from "@tools/pendle/chains.js";

export const PENDLE_CHAINS: readonly string[] = PENDLE_CHAIN_REGISTRY.map((c) => c.slug);
