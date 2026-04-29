import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock search cache repo
const mockGetCached = vi.fn().mockResolvedValue(null);
const mockCacheResult = vi.fn().mockResolvedValue(undefined);
const mockGetCachedFetch = vi.fn().mockResolvedValue(null);
const mockCacheFetchResult = vi.fn().mockResolvedValue(undefined);

vi.mock("@vex-agent/db/repos/search.js", () => ({
  getCached: (...args: unknown[]) => mockGetCached(...args),
  cacheResult: (...args: unknown[]) => mockCacheResult(...args),
  getCachedFetch: (...args: unknown[]) => mockGetCachedFetch(...args),
  cacheFetchResult: (...args: unknown[]) => mockCacheFetchResult(...args),
}));

const { handleWebSearch, handleWebFetch } = await import("../../../../vex-agent/tools/internal/web.js");
import { makeTestContext } from "../_test-context.js";

const baseContext = makeTestContext();

describe("web handlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── web_search ────────────────────────────────────────────────────

  describe("handleWebSearch", () => {
    it("fails on missing query", async () => {
      const result = await handleWebSearch({}, baseContext);
      expect(result.success).toBe(false);
      expect(result.output).toContain("query");
    });

    it("returns cached results when available", async () => {
      mockGetCached.mockResolvedValueOnce([
        { title: "Test", url: "https://example.com", content: "cached content" },
      ]);

      const result = await handleWebSearch({ query: "test" }, baseContext);
      expect(result.success).toBe(true);
      const parsed = JSON.parse(result.output);
      expect(parsed.count).toBe(1);
      expect(parsed.results[0].title).toBe("Test");
      expect(mockCacheResult).not.toHaveBeenCalled();
    });

    it("fails gracefully without TAVILY_API_KEY", async () => {
      const origKey = process.env.TAVILY_API_KEY;
      delete process.env.TAVILY_API_KEY;

      const result = await handleWebSearch({ query: "test" }, baseContext);
      expect(result.success).toBe(false);
      expect(result.output).toContain("TAVILY_API_KEY");

      if (origKey) process.env.TAVILY_API_KEY = origKey;
    });
  });

  // ── web_fetch ─────────────────────────────────────────────────────

  describe("handleWebFetch", () => {
    it("fails on missing url", async () => {
      const result = await handleWebFetch({}, baseContext);
      expect(result.success).toBe(false);
      expect(result.output).toContain("url");
    });

    it("fails on non-http url", async () => {
      const result = await handleWebFetch({ url: "ftp://example.com" }, baseContext);
      expect(result.success).toBe(false);
      expect(result.output).toContain("http");
    });

    it("fails on plain string (not a url)", async () => {
      const result = await handleWebFetch({ url: "just-some-text" }, baseContext);
      expect(result.success).toBe(false);
    });

    it("returns cached fetch when available", async () => {
      mockGetCachedFetch.mockResolvedValueOnce({
        markdown: "# Hello World\n\nCached content",
        title: "Hello World",
      });

      const result = await handleWebFetch({ url: "https://example.com" }, baseContext);
      expect(result.success).toBe(true);
      const parsed = JSON.parse(result.output);
      expect(parsed.title).toBe("Hello World");
      expect(parsed.content).toContain("Cached content");
    });
  });
});
