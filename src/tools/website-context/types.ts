/**
 * Types for the website-context research tool.
 *
 * The tool returns FACTS + neutral quality SIGNALS about a project website.
 * It never emits a verdict / rating — the agent judges professional-vs-junk
 * from the excerpt and signals. Kept generic and fork-decoupled (upstreamable).
 */

/** Real-project markers detected in the page (links or mentions). Facts, not scores. */
export interface ProjectMarkers {
  docs: boolean;
  whitepaper: boolean;
  roadmap: boolean;
  tokenomics: boolean;
  team: boolean;
  github: boolean;
  audit: boolean;
}

/** Neutral quality signals — observations, never a professional/junk verdict. */
export interface WebsiteQualitySignals {
  /** A 2xx page with usable HTML was retrieved. */
  reachable: boolean;
  /** Final URL is served over https. */
  https: boolean;
  /** Words in the readable text excerpt. */
  wordCount: number;
  /** Enough real prose to describe a project (heuristic threshold). */
  hasSubstantiveContent: boolean;
  /** "Coming soon" / domain-parking / lorem-ipsum / near-empty page. */
  isParkedOrPlaceholder: boolean;
  /** Site just bounces to x.com / t.me / discord etc. rather than hosting content. */
  redirectsToSocialOnly: boolean;
  /** Individual real-project markers found in the page. */
  markers: ProjectMarkers;
  /** True when any {@link ProjectMarkers} marker is present. */
  hasProjectMarkers: boolean;
}

/**
 * Result of a website-context check.
 *
 * `status: "ok"` → a page was fetched and parsed; inspect `signals` + `excerpt`.
 * `status: "unavailable"` → nothing usable (no URL, unreachable, timeout,
 *   non-2xx, blocked host). `reason` explains it; this is itself a caution
 *   signal, NOT a tool error — the mission never crashes on it.
 */
export interface WebsiteContextResult {
  status: "ok" | "unavailable";
  /** Present when `status === "unavailable"` — plain-language cause. */
  reason?: string;
  /** The URL we normalized and attempted (absent only when no URL was given). */
  requestedUrl?: string;
  /** Final URL after redirects (may differ from requested). */
  finalUrl: string | null;
  /** Last HTTP status observed (null when no response was received). */
  httpStatus: number | null;
  /** `<title>` text, trimmed. */
  title: string | null;
  /** Meta description / og:description, trimmed. */
  description: string | null;
  /** Readable text excerpt (script/style/nav stripped, whitespace collapsed, capped). */
  excerpt: string;
  /** Neutral quality signals — always present, degraded when unavailable. */
  signals: WebsiteQualitySignals;
}
