/**
 * Web research tools.
 *
 * - `web_research` — Tavily-backed search + fetch. Gated on TAVILY_API_KEY:
 *   hidden from the LLM when the env var is missing.
 * - `website_context` — FREE raw-fetch of a project website for context +
 *   quality signals. No API key, always available.
 */

import type { ToolDef } from "../types.js";

export const WEB_TOOLS: readonly ToolDef[] = [
  {
    name: "web_research", kind: "internal", mutating: false, pressureSafety: "read_only", actionKind: "read", requiresEnv: "TAVILY_API_KEY",
    description: "Search the web and (by default) auto-scrape the top 5 results' full content in a single Tavily batch call. Pass `query` for the standard search+scrape flow, `url` for a single page fetch, or `fetchTop: 0` to skip scraping entirely. Tavily extracts only chunks relevant to your query for better signal-to-noise. Cached for 15 min (search) / 60 min (per-URL fetch).",
    parameters: { type: "object", properties: {
      query: { type: "string", description: "Search query. Pass this OR `url`, not both." },
      url: { type: "string", description: "Absolute http:// or https:// URL to fetch as markdown. Other schemes (ftp, file, mailto, data) rejected. Pass this OR `query`, not both." },
      fetchTop: { type: "number", description: "Search-only. Number of top results to auto-scrape in one batch call (0-10, default 5). Use 0 to skip scraping (search results only)." },
      searchDepth: { type: "string", enum: ["basic", "advanced"], description: "Search-only. `advanced` costs more Tavily credits but improves recall. Default: `basic`." },
    } },
  },
  {
    name: "website_context", kind: "internal", mutating: false, pressureSafety: "read_only", actionKind: "read",
    description: [
      "Fetch a token PROJECT'S OWN WEBSITE (e.g. the site link from its DexScreener profile/socials) and return what the project is about plus neutral quality signals.",
      "FREE — no API key, direct bounded fetch (hard timeout, size cap, ≤2 redirects). Use it on a SHORTLISTED token to understand the project and gauge whether the site looks professional or junk.",
      "Returns FACTS + SIGNALS, never a verdict: title, meta description, a readable text excerpt, and signals { reachable, https, wordCount, hasSubstantiveContent, isParkedOrPlaceholder, redirectsToSocialOnly, markers{docs,whitepaper,roadmap,tokenomics,team,github,audit}, hasProjectMarkers }.",
      "YOU make the professional-vs-junk call from the excerpt + signals. A missing / parked / social-only / near-empty site is a CAUTION flag; a clear site with real docs/roadmap/tokenomics is a mild positive. Advisory only — price/liquidity rules still govern the trade.",
      "Graceful: no URL → status 'unavailable' reason 'no website'; unreachable/timeout/404 → 'unavailable' with the plain reason. Never crashes a run. Website-only (no Twitter/X).",
    ].join(" "),
    parameters: { type: "object", properties: {
      url: { type: "string", description: "The project website URL. Full or bare accepted (`https://site.xyz`, `site.xyz`); trailing junk is stripped. Omit/blank → returns 'unavailable: no website'." },
    } },
  },
];
