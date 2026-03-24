import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getPredictions } from "../agent/ui/src/api.js";

describe("agent UI predictions API", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn() as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("fetches predictions for a selected source", async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ source: "polymarket", positions: [] }),
    });

    await expect(getPredictions("polymarket")).resolves.toEqual({ source: "polymarket", positions: [] });
    expect(fetchMock).toHaveBeenCalledWith("/api/agent/predictions?source=polymarket", expect.any(Object));
  });
});
