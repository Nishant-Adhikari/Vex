import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const tweetSearch = vi.fn();
  const Rettiwt = vi.fn(function Rettiwt() {
    return {
      tweet: {
        search: tweetSearch,
      },
    };
  });
  return { Rettiwt, tweetSearch };
});

vi.mock("rettiwt-api", () => ({
  Rettiwt: mocks.Rettiwt,
  TweetRepliesSortType: {
    LATEST: "LATEST",
    LIKES: "LIKES",
    RELEVANCE: "RELEVANCE",
  },
}));

const { executeTwitterAccountRequest } = await import("@tools/twitter-account/client.js");

describe("twitter account client", () => {
  const originalApiKey = process.env.RETTIWT_API_KEY;

  beforeEach(() => {
    mocks.tweetSearch.mockReset();
    process.env.RETTIWT_API_KEY = "test-rettiwt-key";
  });

  afterEach(() => {
    if (originalApiKey === undefined) delete process.env.RETTIWT_API_KEY;
    else process.env.RETTIWT_API_KEY = originalApiKey;
  });

  it("maps tweet_search query into Rettiwt includeWords", async () => {
    mocks.tweetSearch.mockResolvedValueOnce({ list: [], next: "" });

    await executeTwitterAccountRequest({
      action: "tweet_search",
      query: "pump fun",
      count: 5,
    });

    expect(mocks.tweetSearch).toHaveBeenCalledWith(
      { includeWords: ["pump", "fun"] },
      5,
      undefined,
    );
  });

  it("merges query words with granular filter words and normalizes prefixes", async () => {
    mocks.tweetSearch.mockResolvedValueOnce({ list: [], next: "cursor-1" });

    await executeTwitterAccountRequest({
      action: "tweet_search",
      query: "pump fun",
      filter: {
        includeWords: ["moon", "pump"],
        fromUsers: ["@creator"],
        hashtags: ["#solana"],
      },
      cursor: "cursor-0",
    });

    expect(mocks.tweetSearch).toHaveBeenCalledWith(
      {
        includeWords: ["pump", "fun", "moon"],
        fromUsers: ["creator"],
        hashtags: ["solana"],
      },
      undefined,
      "cursor-0",
    );
  });
});
