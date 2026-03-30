vi.mock("@config/store.js", () => ({ loadConfig: () => ({ polymarket: {} }) }));
vi.mock("@utils/logger.js", () => ({ default: { debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PolyGammaClient } from "@tools/polymarket/gamma/client.js";
import { ErrorCodes } from "../../errors.js";

const originalFetch = globalThis.fetch;

function mockOk(body: unknown) {
  (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: true, json: async () => body });
}
function mockErr(status: number, body: unknown) {
  (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: false, status, json: async () => body });
}

describe("PolyGammaClient", () => {
  let client: PolyGammaClient;

  beforeEach(() => { globalThis.fetch = vi.fn(); client = new PolyGammaClient("https://gamma-api.polymarket.com"); });
  afterEach(() => { globalThis.fetch = originalFetch; });

  it("listEvents: builds correct URL", async () => {
    mockOk([{ id: "1", title: "Test", markets: [], tags: [] }]);
    const events = await client.listEvents({ limit: 5, featured: true });
    const url = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(url).toContain("/events");
    expect(url).toContain("limit=5");
    expect(url).toContain("featured=true");
    expect(events).toHaveLength(1);
  });

  it("getEvent: by ID", async () => {
    mockOk({ id: "42", title: "Event 42", markets: [], tags: [] });
    const event = await client.getEvent(42);
    expect(event.id).toBe("42");
    const url = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(url).toContain("/events/42");
  });

  it("getEventBySlug: by slug", async () => {
    mockOk({ id: "1", slug: "test-event", title: "Test", markets: [], tags: [] });
    const event = await client.getEventBySlug("test-event");
    expect(event.slug).toBe("test-event");
  });

  it("search: passes query param", async () => {
    mockOk({ events: [], tags: [], profiles: [] });
    await client.search("Bitcoin");
    const url = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(url).toContain("q=Bitcoin");
  });

  it("getPublicProfile: passes address", async () => {
    mockOk({ name: "Alice", verifiedBadge: true });
    const profile = await client.getPublicProfile("0xabc");
    expect(profile.name).toBe("Alice");
    const url = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(url).toContain("address=0xabc");
  });

  it("maps 404 to POLYMARKET_MARKET_NOT_FOUND", async () => {
    mockErr(404, { error: "Not found" });
    await expect(client.getEvent(999)).rejects.toMatchObject({ code: ErrorCodes.POLYMARKET_MARKET_NOT_FOUND });
  });

  it("maps 429 to POLYMARKET_RATE_LIMITED", async () => {
    mockErr(429, { error: "Rate limit" });
    await expect(client.listEvents()).rejects.toMatchObject({ code: ErrorCodes.POLYMARKET_RATE_LIMITED });
  });

  it("listTeams: returns teams", async () => {
    mockOk([{ id: 1, name: "Chiefs", league: "NFL" }]);
    const teams = await client.listTeams();
    expect(teams[0].name).toBe("Chiefs");
  });
});
