/**
 * Website-context core tests — URL normalization, HTML parsing / signals, and
 * the bounded fetch client. HTTP is fully MOCKED (globalThis.fetch stub, same
 * convention as the DexScreener client tests) — never hits a real site.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeWebsiteUrl } from "@tools/website-context/normalize-url.js";
import {
  computeSignals,
  extractMetaDescription,
  extractText,
  extractTitle,
  isSocialHost,
} from "@tools/website-context/parse.js";
import { fetchWebsiteContext, isBlockedHost } from "@tools/website-context/client.js";

// ── fetch mock plumbing ──────────────────────────────────────────

type MockResponse = {
  status: number;
  ok: boolean;
  headers: { get: (k: string) => string | null };
  text: () => Promise<string>;
};

function mockResponse(opts: {
  status?: number;
  body?: string;
  location?: string;
  contentLength?: string;
}): MockResponse {
  const status = opts.status ?? 200;
  const headers = new Map<string, string>();
  if (opts.location) headers.set("location", opts.location);
  if (opts.contentLength) headers.set("content-length", opts.contentLength);
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (k: string) => headers.get(k.toLowerCase()) ?? null },
    text: async () => opts.body ?? "",
  };
}

const originalFetch = globalThis.fetch;
beforeEach(() => {
  globalThis.fetch = vi.fn() as unknown as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function fetchMock() {
  return globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
}

// ── URL normalization ────────────────────────────────────────────

describe("normalizeWebsiteUrl", () => {
  it("accepts a full https URL", () => {
    expect(normalizeWebsiteUrl("https://site.xyz")).toBe("https://site.xyz/");
  });

  it("prepends https:// to a bare host", () => {
    expect(normalizeWebsiteUrl("site.xyz")).toBe("https://site.xyz/");
  });

  it("strips surrounding whitespace and trailing junk", () => {
    expect(normalizeWebsiteUrl("  site.xyz/).  ")).toBe("https://site.xyz/");
    expect(normalizeWebsiteUrl("<https://site.xyz/path>")).toBe("https://site.xyz/path");
  });

  it("returns null for empty / whitespace input", () => {
    expect(normalizeWebsiteUrl("")).toBeNull();
    expect(normalizeWebsiteUrl("   ")).toBeNull();
    expect(normalizeWebsiteUrl(undefined)).toBeNull();
  });

  it("rejects non-web schemes", () => {
    expect(normalizeWebsiteUrl("mailto:hi@site.xyz")).toBeNull();
    expect(normalizeWebsiteUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeWebsiteUrl("ftp://site.xyz")).toBeNull();
  });

  it("rejects a bare word with no dot", () => {
    expect(normalizeWebsiteUrl("notaurl")).toBeNull();
  });
});

// ── HTML parsing ─────────────────────────────────────────────────

describe("HTML parsing", () => {
  it("extracts title and meta description", () => {
    const html = `<html><head><title>  Acme  Protocol </title>
      <meta name="description" content="An on-chain lending market."></head><body>x</body></html>`;
    expect(extractTitle(html)).toBe("Acme Protocol");
    expect(extractMetaDescription(html)).toBe("An on-chain lending market.");
  });

  it("strips script/style/nav and collapses whitespace in the excerpt", () => {
    const html = `<nav>Home About</nav><style>.a{color:red}</style>
      <script>var x=1;</script><p>Real   project   copy   here.</p>`;
    const text = extractText(html);
    expect(text).toContain("Real project copy here.");
    expect(text).not.toContain("color:red");
    expect(text).not.toContain("var x");
    expect(text).not.toContain("Home About");
  });

  it("classifies social hosts", () => {
    expect(isSocialHost("x.com")).toBe(true);
    expect(isSocialHost("www.t.me")).toBe(true);
    expect(isSocialHost("acme.xyz")).toBe(false);
  });
});

// ── signal computation ───────────────────────────────────────────

describe("computeSignals", () => {
  it("flags docs/roadmap markers and https on a real project page", () => {
    const text =
      "Acme Protocol is a decentralized lending market. Read our documentation and whitepaper. " +
      "Our roadmap outlines Q1 milestones. Tokenomics: 40% community. Meet the team of veteran builders. " +
      "The protocol has been audited by CertiK. ".repeat(2);
    const html = `<a href="https://docs.acme.xyz">Docs</a><a href="https://github.com/acme/acme">GitHub</a>${text}`;
    const signals = computeSignals({ finalUrl: "https://acme.xyz/", reachable: true, html, text });
    expect(signals.https).toBe(true);
    expect(signals.markers.docs).toBe(true);
    expect(signals.markers.whitepaper).toBe(true);
    expect(signals.markers.roadmap).toBe(true);
    expect(signals.markers.tokenomics).toBe(true);
    expect(signals.markers.github).toBe(true);
    expect(signals.markers.audit).toBe(true);
    expect(signals.hasProjectMarkers).toBe(true);
    expect(signals.hasSubstantiveContent).toBe(true);
    expect(signals.isParkedOrPlaceholder).toBe(false);
  });

  it("flags a parked / near-empty page", () => {
    const text = "Coming soon";
    const signals = computeSignals({ finalUrl: "https://acme.xyz/", reachable: true, html: `<p>${text}</p>`, text });
    expect(signals.isParkedOrPlaceholder).toBe(true);
    expect(signals.hasSubstantiveContent).toBe(false);
    expect(signals.hasProjectMarkers).toBe(false);
    expect(signals.wordCount).toBeLessThan(10);
  });
});

describe("isBlockedHost (SSRF guard)", () => {
  it("blocks loopback / private / link-local hosts", () => {
    expect(isBlockedHost("localhost")).toBe(true);
    expect(isBlockedHost("127.0.0.1")).toBe(true);
    expect(isBlockedHost("10.1.2.3")).toBe(true);
    expect(isBlockedHost("192.168.0.1")).toBe(true);
    expect(isBlockedHost("169.254.1.1")).toBe(true);
    expect(isBlockedHost("172.16.5.5")).toBe(true);
  });
  it("allows a normal public host", () => {
    expect(isBlockedHost("acme.xyz")).toBe(false);
    expect(isBlockedHost("8.8.8.8")).toBe(false);
  });
});

// ── client (bounded fetch, mocked HTTP) ──────────────────────────

describe("fetchWebsiteContext", () => {
  it("parses a normal project site into title/description/excerpt + signals", async () => {
    const body = `<html><head><title>Acme Protocol</title>
      <meta name="description" content="On-chain lending."></head>
      <body><a href="https://docs.acme.xyz">Docs</a>
      <p>${"Acme is a decentralized lending market with a public roadmap and tokenomics. ".repeat(6)}</p>
      </body></html>`;
    fetchMock().mockResolvedValueOnce(mockResponse({ status: 200, body }));

    const result = await fetchWebsiteContext("acme.xyz");
    expect(result.status).toBe("ok");
    expect(result.title).toBe("Acme Protocol");
    expect(result.description).toBe("On-chain lending.");
    expect(result.excerpt).toContain("decentralized lending market");
    expect(result.signals.https).toBe(true);
    expect(result.signals.markers.docs).toBe(true);
    expect(result.signals.markers.roadmap).toBe(true);
    expect(result.signals.hasSubstantiveContent).toBe(true);
    expect(result.finalUrl).toBe("https://acme.xyz/");
  });

  it("flags a parked page with low content", async () => {
    fetchMock().mockResolvedValueOnce(
      mockResponse({ status: 200, body: "<html><title>Parked</title><body><p>Coming soon</p></body></html>" }),
    );
    const result = await fetchWebsiteContext("https://acme.xyz");
    expect(result.status).toBe("ok");
    expect(result.signals.isParkedOrPlaceholder).toBe(true);
    expect(result.signals.hasSubstantiveContent).toBe(false);
  });

  it("returns unavailable on a 404 without throwing", async () => {
    fetchMock().mockResolvedValueOnce(mockResponse({ status: 404 }));
    const result = await fetchWebsiteContext("https://acme.xyz");
    expect(result.status).toBe("unavailable");
    expect(result.reason).toContain("404");
    expect(result.httpStatus).toBe(404);
    expect(result.signals.reachable).toBe(false);
  });

  it("returns unavailable on a network/timeout error without throwing", async () => {
    fetchMock().mockRejectedValueOnce(new Error("Request timed out after 8000ms"));
    const result = await fetchWebsiteContext("https://acme.xyz");
    expect(result.status).toBe("unavailable");
    expect(result.reason).toContain("unreachable");
    expect(result.signals.reachable).toBe(false);
  });

  it("returns unavailable 'no website' when no URL is provided", async () => {
    const result = await fetchWebsiteContext("");
    expect(result.status).toBe("unavailable");
    expect(result.reason).toBe("no website");
    expect(fetchMock()).not.toHaveBeenCalled();
  });

  it("follows a redirect and flags a site that bounces to a social host", async () => {
    fetchMock()
      .mockResolvedValueOnce(mockResponse({ status: 301, location: "https://x.com/acme" }))
      .mockResolvedValueOnce(mockResponse({ status: 200, body: "<html><title>Acme on X</title><body>profile</body></html>" }));
    const result = await fetchWebsiteContext("acme.xyz");
    expect(result.status).toBe("ok");
    expect(result.finalUrl).toBe("https://x.com/acme");
    expect(result.signals.redirectsToSocialOnly).toBe(true);
  });

  it("stops after too many redirects without throwing", async () => {
    fetchMock()
      .mockResolvedValueOnce(mockResponse({ status: 301, location: "https://acme.xyz/a" }))
      .mockResolvedValueOnce(mockResponse({ status: 301, location: "https://acme.xyz/b" }))
      .mockResolvedValueOnce(mockResponse({ status: 301, location: "https://acme.xyz/c" }));
    const result = await fetchWebsiteContext("acme.xyz");
    expect(result.status).toBe("unavailable");
    expect(result.reason).toContain("too many redirects");
  });

  it("blocks a private-host URL without fetching", async () => {
    const result = await fetchWebsiteContext("http://127.0.0.1/admin");
    expect(result.status).toBe("unavailable");
    expect(result.reason).toContain("blocked host");
    expect(fetchMock()).not.toHaveBeenCalled();
  });
});
