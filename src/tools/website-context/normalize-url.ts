/**
 * URL normalization for the website-context tool.
 *
 * Generic, dependency-free (upstreamable): turns a loosely-typed "website"
 * value — the kind that arrives from a token's DexScreener socials or straight
 * from an LLM — into a canonical absolute http(s) URL, or `null` when there is
 * nothing usable to fetch.
 *
 * Accepts: `https://site.xyz`, `site.xyz`, `  site.xyz/  `, and trailing junk
 * like `site.xyz).` or `<https://site.xyz>`. Rejects: empty input and
 * non-web schemes (mailto:, javascript:, data:, ftp:, file:, …).
 */

/** Trailing characters that commonly cling to a URL pasted from prose/markdown. */
const TRAILING_JUNK = /[)\]}>.,;:!'"`\s]+$/;
/** Leading wrappers (markdown angle-brackets, quotes, parens). */
const LEADING_JUNK = /^[<([{'"`\s]+/;

function isHttpProtocol(protocol: string): boolean {
  return protocol === "http:" || protocol === "https:";
}

/**
 * Normalize a raw website value to a canonical http(s) URL string.
 *
 * @returns the normalized absolute URL, or `null` when the input is empty or
 *          cannot be resolved to an http(s) URL. Callers treat `null` as the
 *          "no website" caution signal — never throws.
 */
export function normalizeWebsiteUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;

  let candidate = raw.trim().replace(LEADING_JUNK, "").replace(TRAILING_JUNK, "");
  if (candidate.length === 0) return null;

  // Reject obvious non-web schemes up front so `https://` prefixing below
  // never rescues a `mailto:` / `javascript:` / `data:` value.
  const schemeMatch = candidate.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/);
  if (schemeMatch?.[1]) {
    const scheme = `${schemeMatch[1].toLowerCase()}:`;
    if (!isHttpProtocol(scheme)) return null;
  } else {
    // Scheme-less ("site.xyz", "www.site.xyz/path") → default to https.
    // Guard against protocol-relative ("//site.xyz") which URL() would treat
    // as a path when a base is missing.
    candidate = `https://${candidate.replace(/^\/+/, "")}`;
  }

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }

  if (!isHttpProtocol(url.protocol)) return null;
  // A hostname with no dot and not `localhost` is almost never a real site
  // (e.g. a bare word the LLM passed); reject rather than fetch garbage.
  if (!url.hostname.includes(".") && url.hostname !== "localhost") return null;

  return url.toString();
}
