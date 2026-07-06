/**
 * Protocol prompt — constant layer, always present.
 *
 * Auto-generated from protocol manifests plus shared navigation metadata.
 * The prompt intentionally exposes product groups and "when to use" guidance
 * instead of heuristic toolId families.
 */

import {
  PROTOCOL_ADVERTISED_NAMESPACE_ALLOWLIST,
  PROTOCOL_TOOLS,
  isProtocolToolAvailable,
  getMissingEnvForNamespace,
} from "@vex-agent/tools/protocols/catalog.js";
import {
  getGroupedAdvertisedProtocolNavigation,
} from "@vex-agent/tools/protocols/descriptions.js";
import type { ProtocolNamespace, ProtocolToolManifest } from "@vex-agent/tools/protocols/types.js";

// ── Auto-generation from manifests ──────────────────────────────

interface NamespaceSummary {
  toolCount: number;
  activeCount: number;
  hasMutating: boolean;
  missingEnv: string[];
}

function groupByNamespace(
  tools: readonly ProtocolToolManifest[],
): Map<ProtocolNamespace, ProtocolToolManifest[]> {
  const map = new Map<ProtocolNamespace, ProtocolToolManifest[]>();
  for (const t of tools) {
    const arr = map.get(t.namespace) ?? [];
    arr.push(t);
    map.set(t.namespace, arr);
  }
  return map;
}

function buildNamespaceSummaries(): Map<ProtocolNamespace, NamespaceSummary> {
  const byNs = groupByNamespace(
    PROTOCOL_TOOLS.filter((tool) => PROTOCOL_ADVERTISED_NAMESPACE_ALLOWLIST.includes(tool.namespace)),
  );
  const summaries = new Map<ProtocolNamespace, NamespaceSummary>();

  for (const [ns, tools] of byNs) {
    summaries.set(ns, {
      toolCount: tools.length,
      // env-aware: matches what discover_tools would return right now
      activeCount: tools.filter((t) => isProtocolToolAvailable(t)).length,
      hasMutating: tools.some(t => t.mutating),
      missingEnv: getMissingEnvForNamespace(ns),
    });
  }

  return summaries;
}

// ── Public API ──────────────────────────────────────────────────

/** Cached result — built once per process. */
let cached: string | null = null;

export function buildProtocolsPrompt(): string {
  if (cached) return cached;

  const advertisedTools = PROTOCOL_TOOLS.filter((tool) =>
    PROTOCOL_ADVERTISED_NAMESPACE_ALLOWLIST.includes(tool.namespace),
  );
  const summaries = buildNamespaceSummaries();
  const lines: string[] = [];

  lines.push("# Available Protocol Namespaces");
  lines.push("");
  lines.push(`Total: ${advertisedTools.length} tools across ${summaries.size} namespaces.`);
  lines.push("Use discover_tools(namespace=...) to explore any namespace.");
  lines.push("");

  // Heading discipline (P3 style contract): layer H1 → group H2 → namespace H3.
  // Fixes the former inversion where namespaces (##) outranked their group (###).
  for (const group of getGroupedAdvertisedProtocolNavigation()) {
    lines.push(`## ${group.groupLabel}`);
    lines.push("");

    for (const metadata of group.namespaces) {
      const summary = summaries.get(metadata.namespace);
      if (!summary || summary.toolCount === 0) continue;

      lines.push(`### ${metadata.namespace}`);
      lines.push(metadata.summary);
      lines.push(`Use when: ${metadata.whenToUse}`);
      if (metadata.preferInstead) {
        lines.push(`Use instead: ${metadata.preferInstead}`);
      }
      lines.push(`Tools: ${summary.activeCount} active${summary.toolCount > summary.activeCount ? ` / ${summary.toolCount} total` : ""}`);
      // Surface env requirement only when the namespace is fully gated —
      // partial gating is silent (the count itself is correct).
      if (summary.activeCount === 0 && summary.missingEnv.length > 0) {
        lines.push(`Requires env: ${summary.missingEnv.join(", ")} to enable any tool in this namespace.`);
      }
      if (summary.hasMutating) {
        lines.push("Contains mutating tools (may require approval).");
      }
      if (metadata.facets.length > 0) {
        lines.push("Paths:");
        for (const facet of metadata.facets) {
          lines.push(`- ${facet.label}: ${facet.summary}`);
        }
      }
      if (metadata.exampleQueries.length > 0) {
        lines.push("Examples:");
        for (const example of metadata.exampleQueries) {
          lines.push(`  ${example}`);
        }
      }
      lines.push("");
    }
  }

  // ── Venue & Bridge Routing (Wave 2c) — static routing policy, lands WITH the
  // tools it describes. Imperative rules; no live data (KV-cache safe). Mirrors
  // the venue-router policy modules so guidance and code stay aligned.
  lines.push("## Venue & Bridge Routing");
  lines.push("");
  lines.push("Swap venue by chain:");
  lines.push("- On KyberSwap-supported EVM chains, prefer `kyberswap.*` (aggregated pricing plus honeypot/fee-on-transfer flags).");
  lines.push("- If KyberSwap fails or lacks the chain, fall back to `uniswap.*` (best route across Uniswap V2 and V3).");
  lines.push("- On Robinhood Chain, `uniswap.*` is the ONLY venue. $VEX and other Virtuals agent tokens trade against VIRTUAL there, so route through VIRTUAL (or WETH) as the base pair.");
  lines.push("- Quote and execute on the SAME venue: a `kyberswap` quote authorizes only a `kyberswap` execute, and a `uniswap` quote only a `uniswap` execute. The runtime enforces this.");
  lines.push("");
  lines.push("Bridge venue by chain:");
  lines.push("- Between Khalani-supported chains, use `khalani.*`.");
  lines.push("- Khalani does NOT cover Robinhood Chain — to or from it, use `relay.*`.");
  lines.push("- To fund Robinhood Chain, bridge ETH, USDG, or VIRTUAL in with `relay.*`, then swap on-chain with `uniswap.*`; reverse the flow to exit.");
  lines.push("- Quote and execute on the SAME bridge provider (`khalani` or `relay`). The runtime enforces this.");
  lines.push("");
  lines.push("Balance reads on Robinhood Chain: `wallet_balances` scans it direct-RPC (alias `robinhood` / id 4663). `khalani_tokens_balances` does NOT cover it.");
  lines.push("");

  // ── Virtuals Agent Tokens (Wave 3) — static trading doctrine for Virtuals
  // Protocol agent tokens. Imperative rules; no live data (KV-cache safe).
  // `virtuals.*` is read-only research; execution stays on the venue tools.
  lines.push("## Virtuals Agent Tokens");
  lines.push("");
  lines.push("`virtuals.*` is read-only agent-token intelligence — it never executes. Trade through the venue tools:");
  lines.push("- A GRADUATED agent token trades on its chain's venue quoted in VIRTUAL: `uniswap.*` on Robinhood Chain, `kyberswap.*` on Base/Ethereum, `solana.*` on Solana. The `virtuals.get` result's `tradingRoute` hint names the exact venue and the VIRTUAL quote-token address — use it.");
  lines.push("- ANTI-SNIPER: before buying a graduated agent, call `virtuals.get` and check `antiSniper`. NEVER buy while `windowActive` is true — the buy tax starts near 99% at graduation and decays to ~1% over the window. Wait out `remainingSeconds`, or tell the user the token is inside its sniper-protection window.");
  lines.push("- UNDERGRAD means bonding-curve pre-graduation: illiquid, LP not locked, and it may never graduate. Treat UNDERGRAD agents with extreme caution and prefer graduated (AVAILABLE) ones.");
  lines.push("- `isVerified` is an anti-impersonation badge, not a quality or safety signal — never present it as one.");
  lines.push("");

  // ── Fixed Yield (Pendle) (Wave 5) — static doctrine for fixed-yield PT.
  // Imperative rules; no live numbers (KV-cache safe). `pendle.*` spans 11 chains.
  lines.push("## Fixed Yield (Pendle)");
  lines.push("");
  lines.push("`pendle.*` is fixed-yield across 11 chains (Ethereum, Arbitrum, Base, BSC, and more). A principal token (PT) is a TERM COMMITMENT: buying a PT locks a fixed rate until the market's expiry date. Always pass the `chain` the PT lives on.");
  lines.push("- Buying a PT locks funds until maturity. Exiting EARLY (`pendle.pt.sell`) is market-priced and CAN lose money versus the locked rate — say so before recommending a buy.");
  lines.push("- A MATURED PT redeems ~1:1 to its accounting asset via `pendle.pt.redeem`; value a matured PT at face, never at the underlying spot price.");
  lines.push("- A yield token (YT) is the OPPOSITE leg: `pendle.yt.buy` is VARIABLE, leveraged yield exposure that DECAYS TO ZERO at expiry and is worth nothing after it — NOT fixed yield, and it can lose money. Frame YT as a variable-yield bet, never as a guaranteed or fixed return; `pendle.yt.sell` exits early at the market price.");
  lines.push("- `pendle.claim` sweeps ACCRUED interest and rewards (from held YTs and LP positions) to the wallet WITHOUT closing any position — it moves only income, never principal.");
  lines.push("- `pendle.py.mint` splits ONE token into BOTH an equal PT and YT in a single transaction; `pendle.py.redeem` burns an EQUAL PT+YT pair back to a token BEFORE expiry. Both need a fresh matching `pendle.py.quote`; a MATURED PT (PT only, no YT) uses `pendle.pt.redeem` instead.");
  lines.push("- `pendle.lp.add` provides single-token liquidity (one token → the market's LP), which earns swap fees and rewards; `pendle.lp.remove` burns the LP back to one token. LP is NOT a fixed-rate lock: after expiry it stops earning and only the principal side remains removable. Both need a fresh matching `pendle.lp.quote`; approval-gated.");
  lines.push("- NEVER present points as yield. A `pointsWarning` on a market means it pays speculative points, not a guaranteed return.");
  lines.push("- Check liquidity before sizing — thin markets mean high price impact on exit. Always preview with `pendle.pt.quote` (or `pendle.yt.quote` for YT) first; PT/YT buy/sell/redeem require a fresh matching quote and are approval-gated.");
  lines.push("");

  cached = lines.join("\n");
  return cached;
}

/** For testing — reset cached prompt. */
export function resetProtocolsPromptCache(): void {
  cached = null;
}
