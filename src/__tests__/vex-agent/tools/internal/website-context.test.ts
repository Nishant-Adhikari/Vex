/**
 * `website_context` internal handler — thin adapter over the fetch core.
 * The core is stubbed so this focuses on the handler contract: it always
 * returns a successful ToolResult carrying the structured payload (an
 * `unavailable` result is data, never a hard failure).
 */

import { afterEach, describe, expect, it, vi } from "vitest";

const mockFetchWebsiteContext = vi.fn();
vi.mock("@tools/website-context/client.js", () => ({
  fetchWebsiteContext: (...args: unknown[]) => mockFetchWebsiteContext(...args),
}));

const { handleWebsiteContext } = await import("@vex-agent/tools/internal/website-context.js");
import { makeTestContext } from "../_test-context.js";

const ctx = makeTestContext();

afterEach(() => vi.clearAllMocks());

describe("website_context handler", () => {
  it("returns the ok payload for a reachable site", async () => {
    mockFetchWebsiteContext.mockResolvedValueOnce({
      status: "ok",
      requestedUrl: "https://acme.xyz/",
      finalUrl: "https://acme.xyz/",
      httpStatus: 200,
      title: "Acme",
      description: null,
      excerpt: "Acme is a project.",
      signals: { reachable: true },
    });
    const result = await handleWebsiteContext({ url: "acme.xyz" }, ctx);
    expect(result.success).toBe(true);
    expect(mockFetchWebsiteContext).toHaveBeenCalledWith("acme.xyz");
    const data = JSON.parse(result.output);
    expect(data.status).toBe("ok");
    expect(data.title).toBe("Acme");
  });

  it("passes an empty string through when url is omitted (→ unavailable data, still success)", async () => {
    mockFetchWebsiteContext.mockResolvedValueOnce({
      status: "unavailable",
      reason: "no website",
      finalUrl: null,
      httpStatus: null,
      title: null,
      description: null,
      excerpt: "",
      signals: { reachable: false },
    });
    const result = await handleWebsiteContext({}, ctx);
    expect(result.success).toBe(true);
    expect(mockFetchWebsiteContext).toHaveBeenCalledWith("");
    const data = JSON.parse(result.output);
    expect(data.status).toBe("unavailable");
    expect(data.reason).toBe("no website");
  });
});
