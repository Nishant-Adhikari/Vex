/**
 * Bounded website fetcher for the website-context tool.
 *
 * FREE: raw http(s) fetch, no API key, no paid tier. The codebase's existing
 * web-fetch path (`web_research`) is Tavily-backed (requires TAVILY_API_KEY and
 * returns cleaned markdown), so it cannot supply the raw HTTP status, redirect
 * chain, `<title>`/meta tags, and parked-page structure this quality check
 * needs — hence a dedicated bounded fetch here (per the tool spec).
 *
 * Bounding (defense against hostile / runaway sites):
 *   - hard request timeout per hop (via {@link fetchWithTimeout})
 *   - at most {@link MAX_REDIRECTS} manual redirects (default 2)
 *   - response body STREAM-capped at {@link MAX_BODY_BYTES} (a dribbled,
 *     unbounded body is aborted at the cap — never fully buffered)
 *   - SSRF guard on every hop: refuses private/loopback/link-local hosts by
 *     literal string AND by RESOLVED address (public host → private IP)
 *   - normal browser User-Agent
 *
 * Graceful degradation is MANDATORY: every failure path returns an
 * `unavailable` result — this function never throws, so a mission run can never
 * crash on it.
 */

import { lookup } from "node:dns/promises";
import { fetchWithTimeout } from "../../utils/http.js";
import { normalizeWebsiteUrl } from "./normalize-url.js";
import { computeSignals, extractMetaDescription, extractText, extractTitle, isSocialHost } from "./parse.js";
import type { WebsiteContextResult, WebsiteQualitySignals } from "./types.js";

const REQUEST_TIMEOUT_MS = 8000;
const MAX_REDIRECTS = 2;
const MAX_BODY_BYTES = 512 * 1024; // 512 KB is plenty for a landing page.
const USER_AGENT =
  "Mozilla/5.0 (compatible; VexResearchBot/1.0; +https://github.com/Vex-Foundation/Vex)";

/**
 * Resolves a hostname to its IP addresses. Injectable so tests never touch
 * real DNS. Default uses the OS resolver.
 */
export type HostResolver = (host: string) => Promise<string[]>;

const defaultResolveHost: HostResolver = async (host) => {
  const records = await lookup(host, { all: true });
  return records.map((r) => r.address);
};

/** Options for {@link fetchWebsiteContext} — primarily test seams. */
export interface FetchWebsiteOptions {
  /** Override DNS resolution (tests). Defaults to the OS resolver. */
  resolveHost?: HostResolver;
}

/** Neutral "nothing usable" signal block for unavailable results. */
function unreachableSignals(): WebsiteQualitySignals {
  return {
    reachable: false,
    https: false,
    wordCount: 0,
    hasSubstantiveContent: false,
    isParkedOrPlaceholder: false,
    redirectsToSocialOnly: false,
    markers: {
      docs: false,
      whitepaper: false,
      roadmap: false,
      tokenomics: false,
      team: false,
      github: false,
      audit: false,
    },
    hasProjectMarkers: false,
  };
}

function unavailable(reason: string, requestedUrl: string | undefined, finalUrl: string | null, httpStatus: number | null): WebsiteContextResult {
  return {
    status: "unavailable",
    reason,
    ...(requestedUrl !== undefined ? { requestedUrl } : {}),
    finalUrl,
    httpStatus,
    title: null,
    description: null,
    excerpt: "",
    signals: unreachableSignals(),
  };
}

/**
 * Refuse hosts that resolve to internal infrastructure. This is a syntactic
 * guard (hostname/literal-IP inspection) — it blocks the obvious SSRF vectors
 * (localhost, RFC-1918, link-local, `.local`/`.internal`) without a DNS
 * round-trip. A memecoin website URL is fully attacker-controlled, so this
 * matters even for a read-only fetch.
 */
export function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".lan")) return true;
  if (host === "::1" || host === "0.0.0.0") return true;
  // IPv6 unique-local / link-local.
  if (host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80")) return true;
  // IPv4 literal ranges.
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 127) return true; // loopback
    if (a === 0) return true;
    if (a === 169 && b === 254) return true; // link-local
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
  }
  return false;
}

/** True for an IPv4/IPv6 literal (already covered by {@link isBlockedHost}). */
function isIpLiteral(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "");
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.includes(":");
}

/**
 * Reject a hostname whose RESOLVED addresses point at internal infrastructure.
 * Closes the gap where a public hostname has a private/loopback A/AAAA record
 * ({@link isBlockedHost} only sees the literal host string). Returns a block
 * reason, or null when every resolved address is public.
 *
 * NOTE: this narrows the SSRF window but does not fully close DNS-rebinding —
 * undici re-resolves at connect time, so a record that flips between this
 * check and the socket connect is still a (much smaller) TOCTOU. A fully
 * rebinding-proof fetch would pin the validated IP into the connection; that
 * is deliberately out of scope for this advisory research tool.
 */
async function blockedByResolution(host: string, resolveHost: HostResolver): Promise<string | null> {
  if (isIpLiteral(host)) return null; // literal already vetted by isBlockedHost
  const addresses = await resolveHost(host);
  if (addresses.length === 0) return "unreachable: DNS returned no records";
  const bad = addresses.find((addr) => isBlockedHost(addr));
  return bad ? `blocked host (resolves to private/loopback address ${bad})` : null;
}

/**
 * Read the response body with a hard byte cap, streaming so a hostile site
 * that dribbles an unbounded body (no honest Content-Length) can neither
 * exhaust memory nor hang past the cap. Falls back to `text()` for response
 * doubles that expose no `body` stream (test mocks).
 */
async function readBoundedText(response: Response): Promise<string> {
  const body = (response as { body?: ReadableStream<Uint8Array> | null }).body;
  if (!body || typeof body.getReader !== "function") {
    // No stream (mock/legacy) — buffer then cap.
    const text = await response.text();
    return text.length > MAX_BODY_BYTES ? text.slice(0, MAX_BODY_BYTES) : text;
  }

  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: false });
  let out = "";
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      bytes += value.byteLength;
      const remaining = MAX_BODY_BYTES - (bytes - value.byteLength);
      const slice = bytes > MAX_BODY_BYTES ? value.subarray(0, Math.max(0, remaining)) : value;
      out += decoder.decode(slice, { stream: true });
      if (bytes >= MAX_BODY_BYTES) break; // cap hit — stop reading
    }
  } finally {
    // Abort the underlying request so a never-ending body can't linger.
    await reader.cancel().catch(() => undefined);
  }
  out += decoder.decode();
  return out;
}

/**
 * Fetch a website URL and return context + neutral quality signals.
 *
 * @param rawUrl a website URL (full or bare, e.g. `site.xyz`). Undefined /
 *   empty / no-website → `unavailable` with reason "no website".
 */
export async function fetchWebsiteContext(
  rawUrl: unknown,
  options: FetchWebsiteOptions = {},
): Promise<WebsiteContextResult> {
  const resolveHost = options.resolveHost ?? defaultResolveHost;
  const normalized = normalizeWebsiteUrl(rawUrl);
  if (normalized === null) {
    const provided = typeof rawUrl === "string" && rawUrl.trim().length > 0;
    return unavailable(provided ? "invalid or non-web URL" : "no website", undefined, null, null);
  }

  let currentUrl = normalized;
  let redirectChainToSocial = false;

  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      let host: string;
      try {
        host = new URL(currentUrl).hostname;
      } catch {
        return unavailable("invalid or non-web URL", normalized, currentUrl, null);
      }
      if (isBlockedHost(host)) {
        return unavailable("blocked host (private/loopback address)", normalized, currentUrl, null);
      }
      // Resolved-IP SSRF guard: block a public hostname that points at a
      // private/loopback address (DNS-level vector isBlockedHost can't see).
      const resolutionBlock = await blockedByResolution(host, resolveHost);
      if (resolutionBlock !== null) {
        return unavailable(resolutionBlock, normalized, currentUrl, null);
      }
      if (isSocialHost(host) && currentUrl !== normalized) redirectChainToSocial = true;

      const response = await fetchWithTimeout(currentUrl, {
        timeoutMs: REQUEST_TIMEOUT_MS,
        redirect: "manual",
        headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml" },
      });

      // Manual redirect handling (bounded).
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers?.get?.("location");
        if (!location) {
          return unavailable(`redirect with no location (HTTP ${response.status})`, normalized, currentUrl, response.status);
        }
        if (hop === MAX_REDIRECTS) {
          return unavailable(`too many redirects (> ${MAX_REDIRECTS})`, normalized, currentUrl, response.status);
        }
        try {
          currentUrl = new URL(location, currentUrl).toString();
        } catch {
          return unavailable("invalid redirect target", normalized, currentUrl, response.status);
        }
        continue;
      }

      if (!response.ok) {
        // 4xx/5xx — a plain caution signal, not a crash.
        return unavailable(`HTTP ${response.status}`, normalized, currentUrl, response.status);
      }

      const html = await readBoundedText(response);
      const finalUrl = currentUrl;
      const title = extractTitle(html);
      const description = extractMetaDescription(html);
      const excerpt = extractText(html);
      const signals = computeSignals({
        finalUrl,
        reachable: true,
        html,
        text: excerpt,
        redirectChainToSocial,
      });

      return {
        status: "ok",
        requestedUrl: normalized,
        finalUrl,
        httpStatus: response.status,
        title,
        description,
        excerpt,
        signals,
      };
    }
    // Loop exhausted without returning (all hops were redirects).
    return unavailable(`too many redirects (> ${MAX_REDIRECTS})`, normalized, currentUrl, null);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return unavailable(`unreachable: ${message}`, normalized, currentUrl, null);
  }
}
