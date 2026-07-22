/**
 * Pure HTML parsing + neutral signal extraction for the website-context tool.
 *
 * No network, no fork deps — every function here is deterministic
 * (html-in → facts-out) and unit-testable in isolation (upstreamable).
 * We deliberately use bounded regex extraction rather than a full DOM parser:
 * the input is untrusted memecoin-site HTML, the output is a short prompt
 * excerpt + boolean signals, and a heavy parser buys nothing here.
 */

import type { ProjectMarkers, WebsiteQualitySignals } from "./types.js";

/** Max characters of readable text kept in the excerpt (fits a prompt). */
export const MAX_EXCERPT_CHARS = 2000;
/** Below this word count a page is not "substantive". */
const SUBSTANTIVE_WORD_MIN = 40;
/** At/below this word count a page is treated as near-empty. */
const NEAR_EMPTY_WORD_MAX = 20;

/** Hosts that mean "this isn't a real site, it's a social/link redirect". */
const SOCIAL_HOSTS = [
  "x.com",
  "twitter.com",
  "t.me",
  "telegram.me",
  "telegram.org",
  "discord.gg",
  "discord.com",
  "instagram.com",
  "facebook.com",
  "fb.com",
  "tiktok.com",
  "youtube.com",
  "youtu.be",
  "linktr.ee",
];

/** Phrases that mark a parked / placeholder / under-construction page. */
const PARKED_PHRASES = [
  "coming soon",
  "under construction",
  "launching soon",
  "site coming soon",
  "domain is parked",
  "domain parking",
  "buy this domain",
  "this domain is for sale",
  "parked free",
  "godaddy",
  "sedo",
  "hugedomains",
  "lorem ipsum",
  "default web page",
  "it works!",
  "welcome to nginx",
  "index of /",
];

const TAG_STRIP = /<(script|style|noscript|svg|template|iframe)\b[^>]*>[\s\S]*?<\/\1>/gi;
const COMMENT_STRIP = /<!--[\s\S]*?-->/g;
/** Structural tags whose text is navigation chrome, not project prose. */
const CHROME_STRIP = /<(nav|header|footer|form)\b[^>]*>[\s\S]*?<\/\1>/gi;

const MINIMAL_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
};

function decodeEntities(text: string): string {
  let out = text.replace(/&(amp|lt|gt|quot|apos|#39|nbsp);/g, (m) => MINIMAL_ENTITIES[m] ?? m);
  // Numeric decimal entities (bounded).
  out = out.replace(/&#(\d{1,6});/g, (_m, code: string) => {
    const n = Number(code);
    return Number.isFinite(n) && n > 0 && n < 0x110000 ? safeFromCodePoint(n) : _m;
  });
  return out;
}

function safeFromCodePoint(n: number): string {
  try {
    return String.fromCodePoint(n);
  } catch {
    return "";
  }
}

/** Extract the trimmed `<title>` text, or null. */
export function extractTitle(html: string): string | null {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!m?.[1]) return null;
  const title = decodeEntities(m[1]).replace(/\s+/g, " ").trim();
  return title.length > 0 ? title : null;
}

/** Extract meta description or og:description, or null. */
export function extractMetaDescription(html: string): string | null {
  const patterns = [
    /<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i,
    /<meta[^>]+content=["']([^"']*)["'][^>]*name=["']description["']/i,
    /<meta[^>]+property=["']og:description["'][^>]*content=["']([^"']*)["']/i,
    /<meta[^>]+content=["']([^"']*)["'][^>]*property=["']og:description["']/i,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m && m[1]) {
      const desc = decodeEntities(m[1]).replace(/\s+/g, " ").trim();
      if (desc.length > 0) return desc;
    }
  }
  return null;
}

/**
 * Strip script/style/nav/chrome and all remaining tags, decode a minimal set
 * of entities, collapse whitespace, and cap length. Returns readable prose.
 */
export function extractText(html: string): string {
  const stripped = html
    .replace(COMMENT_STRIP, " ")
    .replace(TAG_STRIP, " ")
    .replace(CHROME_STRIP, " ")
    .replace(/<[^>]+>/g, " ");
  const text = decodeEntities(stripped).replace(/\s+/g, " ").trim();
  return text.length > MAX_EXCERPT_CHARS ? `${text.slice(0, MAX_EXCERPT_CHARS).trimEnd()}…` : text;
}

function countWords(text: string): number {
  if (text.length === 0) return 0;
  return text.split(/\s+/).filter((w) => w.length > 0).length;
}

/** Is this host (or a parent of it) a known social/link-aggregator host? */
export function isSocialHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^www\./, "");
  return SOCIAL_HOSTS.some((social) => host === social || host.endsWith(`.${social}`));
}

/** Detect a meta-refresh or JS redirect whose target is a social host. */
function bodyRedirectsToSocial(html: string): boolean {
  const refresh = html.match(/<meta[^>]+http-equiv=["']refresh["'][^>]*content=["'][^"']*url=([^"']+)["']/i);
  const jsLoc = html.match(/(?:window\.)?location(?:\.href)?\s*=\s*["']([^"']+)["']/i);
  for (const candidate of [refresh?.[1], jsLoc?.[1]]) {
    if (!candidate) continue;
    try {
      const host = new URL(candidate, "https://placeholder.invalid").hostname;
      if (isSocialHost(host)) return true;
    } catch {
      /* ignore malformed redirect target */
    }
  }
  return false;
}

function detectMarkers(haystack: string): {
  markers: ProjectMarkers;
  hasProjectMarkers: boolean;
} {
  const has = (...needles: string[]) => needles.some((n) => haystack.includes(n));
  const markers = {
    docs: has("docs", "documentation", "gitbook", "read the docs"),
    whitepaper: has("whitepaper", "white paper", "litepaper", "yellowpaper"),
    roadmap: has("roadmap", "milestones"),
    tokenomics: has("tokenomics", "token allocation", "token distribution", "vesting"),
    team: has(">team<", "our team", "meet the team", "founders", "core team", "about us"),
    github: has("github.com", "gitlab.com"),
    audit: has("audit", "certik", "hacken", "peckshield", "audited by"),
  };
  const hasProjectMarkers = Object.values(markers).some(Boolean);
  return { markers, hasProjectMarkers };
}

export interface SignalInput {
  /** Final URL after redirects (used for host classification). */
  finalUrl: string | null;
  /** True when the response was 2xx with a body. */
  reachable: boolean;
  /** Raw (bounded) HTML body. */
  html: string;
  /** Cleaned excerpt text (output of {@link extractText}). */
  text: string;
  /** True when the redirect CHAIN landed on a social host (from the fetcher). */
  redirectChainToSocial?: boolean;
}

/** Compute the neutral quality signals from parsed page facts. */
export function computeSignals(input: SignalInput): WebsiteQualitySignals {
  const { finalUrl, reachable, html, text, redirectChainToSocial } = input;

  let https = false;
  let finalHostSocial = false;
  if (finalUrl) {
    try {
      const u = new URL(finalUrl);
      https = u.protocol === "https:";
      finalHostSocial = isSocialHost(u.hostname);
    } catch {
      /* leave defaults */
    }
  }

  const wordCount = countWords(text);
  const lowerText = text.toLowerCase();
  // Search markers/parked phrases in text + raw HTML (links live in attrs).
  const haystack = `${lowerText} ${html.toLowerCase()}`;

  const { markers, hasProjectMarkers } = detectMarkers(haystack);

  const redirectsToSocialOnly =
    finalHostSocial || redirectChainToSocial === true || (reachable && bodyRedirectsToSocial(html));

  const hasSubstantiveContent = wordCount >= SUBSTANTIVE_WORD_MIN;

  const parkedByPhrase = PARKED_PHRASES.some((p) => lowerText.includes(p));
  const nearEmpty = reachable && wordCount <= NEAR_EMPTY_WORD_MAX && !hasProjectMarkers;
  const isParkedOrPlaceholder = reachable && (parkedByPhrase || nearEmpty);

  return {
    reachable,
    https,
    wordCount,
    hasSubstantiveContent,
    isParkedOrPlaceholder,
    redirectsToSocialOnly,
    markers,
    hasProjectMarkers,
  };
}
