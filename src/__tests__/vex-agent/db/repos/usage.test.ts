/**
 * usage repo — logUsage column wiring. Pins the two cache-savings columns
 * added by migration 032 (`cached_savings`, `cache_write_tokens`): values
 * flow through when provided (negative savings included — recorded
 * truthfully) and default to 0 when absent.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockExecute = vi.fn();
const mockQueryOne = vi.fn();

vi.mock("@vex-agent/db/client.js", () => ({
  execute: (...a: unknown[]) => mockExecute(...a),
  query: vi.fn().mockResolvedValue([]),
  queryOne: (...a: unknown[]) => mockQueryOne(...a),
}));

const { logUsage, getSessionTotalTokens } = await import("@vex-agent/db/repos/usage.js");

describe("usage repo — logUsage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecute.mockResolvedValue(undefined);
  });

  it("inserts cached_savings + cache_write_tokens with provided values (negative savings preserved)", async () => {
    await logUsage("session-1", {
      promptTokens: 1000,
      completionTokens: 200,
      cost: 0.001,
      cachedTokens: 600,
      cachedSavings: -0.0033,
      cacheWriteTokens: 8000,
      reasoningTokens: 0,
      provider: "openrouter",
      model: "anthropic/claude-sonnet-4",
      currency: "USD",
    });

    expect(mockExecute).toHaveBeenCalledTimes(1);
    const [sql, params] = mockExecute.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("cached_savings");
    expect(sql).toContain("cache_write_tokens");
    // Positional params: [..., currency, cached_savings, cache_write_tokens]
    expect(params).toEqual([
      "session-1", 1000, 200, 1200, 600, 0, 0.001,
      "openrouter", "anthropic/claude-sonnet-4", "USD",
      -0.0033, 8000,
    ]);
  });

  it("defaults cachedSavings and cacheWriteTokens to 0 when omitted", async () => {
    await logUsage("session-1", {
      promptTokens: 10,
      completionTokens: 5,
      cost: 0,
    });

    const [, params] = mockExecute.mock.calls[0] as [string, unknown[]];
    expect(params[10]).toBe(0); // cached_savings
    expect(params[11]).toBe(0); // cache_write_tokens
  });
});

describe("usage repo — getSessionTotalTokens (subtree + since scoping)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQueryOne.mockResolvedValue({ tokens: "0" });
  });

  it("sums the session AND its linked child sessions (subagent spend, fix C) via a recursive session_links walk", async () => {
    mockQueryOne.mockResolvedValue({ tokens: "1234" });

    const total = await getSessionTotalTokens("root-1");

    expect(total).toBe(1234);
    const [sql, params] = mockQueryOne.mock.calls[0] as [string, unknown[]];
    // Recursive CTE over session_links so a subagent's child-session usage is
    // included in the run's cumulative spend, not silently excluded.
    expect(sql).toMatch(/RECURSIVE/i);
    expect(sql).toContain("session_links");
    expect(sql).toContain("usage_log");
    expect(sql).toContain("SUM(");
    expect(params[0]).toBe("root-1");
    // No `since` → no created_at cutoff (all-time, for the setup phase).
    expect(sql).not.toContain("created_at");
    expect(params).toHaveLength(1);
  });

  it("applies a created_at >= since cutoff when a baseline timestamp is given (run-scoping, fix B)", async () => {
    mockQueryOne.mockResolvedValue({ tokens: "500" });

    const total = await getSessionTotalTokens("root-1", { since: "2026-07-22T00:00:00.000Z" });

    expect(total).toBe(500);
    const [sql, params] = mockQueryOne.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("created_at");
    expect(sql).toMatch(/>=/);
    expect(params).toEqual(["root-1", "2026-07-22T00:00:00.000Z"]);
  });

  it("treats a null/undefined since as all-time (no cutoff)", async () => {
    await getSessionTotalTokens("root-1", { since: null });
    const [sqlNull, paramsNull] = mockQueryOne.mock.calls[0] as [string, unknown[]];
    expect(sqlNull).not.toContain("created_at");
    expect(paramsNull).toHaveLength(1);
  });

  it("returns 0 when the session has no usage rows", async () => {
    mockQueryOne.mockResolvedValue(null);
    expect(await getSessionTotalTokens("root-1")).toBe(0);
  });
});
