import { describe, it, expect } from "vitest";
import {
  validateEventsResponse, validateEventResponse, validateMarketsResponse,
  validateSearchResponse, validateProfileResponse, validateTagsResponse,
  validateSeriesResponse, validateCommentsResponse, validateSportsMetadataResponse,
  validateTeamsResponse,
} from "@tools/polymarket/gamma/validation.js";

const EVENT = { id: "1", slug: "test", title: "Test Event", active: true, closed: false, markets: [], tags: [] };
const MARKET = { id: "1", conditionId: "0xabc", question: "Will X?", marketMakerAddress: "0x123" };

describe("validateEventsResponse", () => {
  it("parses array of events", () => {
    const result = validateEventsResponse([EVENT]);
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("Test Event");
  });
  it("handles empty array", () => { expect(validateEventsResponse([])).toEqual([]); });
  it("throws for non-array", () => { expect(() => validateEventsResponse(null)).toThrow(); });
});

describe("validateEventResponse", () => {
  it("parses single event", () => {
    const result = validateEventResponse(EVENT);
    expect(result.id).toBe("1");
    expect(result.active).toBe(true);
  });
  it("parses nested markets", () => {
    const result = validateEventResponse({ ...EVENT, markets: [MARKET] });
    expect(result.markets).toHaveLength(1);
    expect(result.markets[0].conditionId).toBe("0xabc");
  });
});

describe("validateMarketsResponse", () => {
  it("parses array", () => {
    const result = validateMarketsResponse([MARKET]);
    expect(result[0].question).toBe("Will X?");
  });
  it("throws for non-array", () => { expect(() => validateMarketsResponse("bad")).toThrow(); });
});

describe("validateSearchResponse", () => {
  it("parses events + tags + profiles", () => {
    const result = validateSearchResponse({
      events: [EVENT],
      tags: [{ id: "1", label: "Politics", slug: "politics", event_count: 5 }],
      profiles: [{ id: "1", name: "Trader" }],
      pagination: { hasMore: false, totalResults: 1 },
    });
    expect(result.events).toHaveLength(1);
    expect(result.tags).toHaveLength(1);
    expect(result.profiles).toHaveLength(1);
    expect(result.pagination?.totalResults).toBe(1);
  });
  it("handles null sections", () => {
    const result = validateSearchResponse({});
    expect(result.events).toBeNull();
    expect(result.tags).toBeNull();
  });
});

describe("validateProfileResponse", () => {
  it("parses profile", () => {
    const result = validateProfileResponse({ name: "Alice", pseudonym: "anon123", verifiedBadge: true, proxyWallet: "0xabc" });
    expect(result.name).toBe("Alice");
    expect(result.verifiedBadge).toBe(true);
  });
  it("handles null fields", () => {
    const result = validateProfileResponse({});
    expect(result.name).toBeNull();
  });
});

describe("validateTagsResponse", () => {
  it("parses tags", () => {
    const result = validateTagsResponse([{ id: "1", label: "Sports", slug: "sports" }]);
    expect(result[0].label).toBe("Sports");
  });
});

describe("validateSeriesResponse", () => {
  it("parses series", () => {
    const result = validateSeriesResponse([{ id: "1", title: "2024 Election", events: [] }]);
    expect(result[0].title).toBe("2024 Election");
  });
});

describe("validateCommentsResponse", () => {
  it("parses comments", () => {
    const result = validateCommentsResponse([{ id: "1", body: "Great market!", userAddress: "0xabc" }]);
    expect(result[0].body).toBe("Great market!");
  });
});

describe("validateSportsMetadataResponse", () => {
  it("parses sports", () => {
    const result = validateSportsMetadataResponse([{ sport: "NFL", image: "https://..." }]);
    expect(result[0].sport).toBe("NFL");
  });
});

describe("validateTeamsResponse", () => {
  it("parses teams", () => {
    const result = validateTeamsResponse([{ id: 1, name: "Chiefs", league: "NFL", abbreviation: "KC" }]);
    expect(result[0].abbreviation).toBe("KC");
  });
});
