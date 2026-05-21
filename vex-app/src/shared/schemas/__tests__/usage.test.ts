import { describe, expect, it } from "vitest";
import {
  lastTurnUsageResultSchema,
  sessionUsageTotalsDtoSchema,
  turnUsageDtoSchema,
  usageInputSchema,
  USAGE_DEFAULT_CURRENCY,
} from "../usage.js";

const SESSION = "00000000-0000-4000-8000-000000000005";
const ISO = "2026-05-21T10:00:00.000Z";

describe("usage schemas", () => {
  it("turnUsageDtoSchema accepts a typical row with USD currency", () => {
    const parsed = turnUsageDtoSchema.safeParse({
      sessionId: SESSION,
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
      cachedTokens: 10,
      reasoningTokens: 5,
      cost: 0.001,
      currency: "USD",
      provider: "openrouter",
      model: "anthropic/claude-opus-4.7",
      createdAt: ISO,
    });
    expect(parsed.success).toBe(true);
  });

  it("turnUsageDtoSchema rejects negative token counts", () => {
    const parsed = turnUsageDtoSchema.safeParse({
      sessionId: SESSION,
      promptTokens: -1,
      completionTokens: 0,
      totalTokens: 0,
      cachedTokens: 0,
      reasoningTokens: 0,
      cost: null,
      currency: "USD",
      provider: null,
      model: null,
      createdAt: ISO,
    });
    expect(parsed.success).toBe(false);
  });

  it("turnUsageDtoSchema permits nullable provider/model/cost for legacy rows", () => {
    const parsed = turnUsageDtoSchema.safeParse({
      sessionId: SESSION,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      cachedTokens: 0,
      reasoningTokens: 0,
      cost: null,
      currency: "USD",
      provider: null,
      model: null,
      createdAt: ISO,
    });
    expect(parsed.success).toBe(true);
  });

  it("sessionUsageTotalsDtoSchema accepts all-zero totals (empty session)", () => {
    const parsed = sessionUsageTotalsDtoSchema.safeParse({
      sessionId: SESSION,
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
      totalTokens: 0,
      totalCost: null,
      currency: "USD",
      requestCount: 0,
      lastRequestAt: null,
    });
    expect(parsed.success).toBe(true);
  });

  it("usageInputSchema defaults currency to USD", () => {
    const parsed = usageInputSchema.safeParse({ sessionId: SESSION });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.currency).toBe(USAGE_DEFAULT_CURRENCY);
  });

  it("lastTurnUsageResultSchema accepts null (empty session) and a turn DTO", () => {
    expect(lastTurnUsageResultSchema.safeParse(null).success).toBe(true);
    expect(
      lastTurnUsageResultSchema.safeParse({
        sessionId: SESSION,
        promptTokens: 1,
        completionTokens: 1,
        totalTokens: 2,
        cachedTokens: 0,
        reasoningTokens: 0,
        cost: 0,
        currency: "USD",
        provider: null,
        model: null,
        createdAt: ISO,
      }).success,
    ).toBe(true);
  });
});
