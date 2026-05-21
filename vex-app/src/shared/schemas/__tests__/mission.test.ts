import { describe, expect, it } from "vitest";
import {
  MISSION_DRAFT_LIST_ITEM_MAX,
  missionConstraintsSchema,
  missionDraftDtoSchema,
  missionGetDraftInputSchema,
  missionListEntrySchema,
} from "../mission.js";

const SESSION = "00000000-0000-4000-8000-000000000003";
const ISO = "2026-05-21T10:00:00.000Z";

describe("mission schemas", () => {
  it("missionConstraintsSchema strips unknown keys via .strict()", () => {
    expect(
      missionConstraintsSchema.safeParse({
        maxSpendUsd: 100,
        leakedSecret: "kab00m",
      }).success,
    ).toBe(false);
  });

  it("missionConstraintsSchema accepts empty object", () => {
    expect(missionConstraintsSchema.safeParse({}).success).toBe(true);
  });

  it("missionListEntrySchema enforces trim + length + non-empty", () => {
    expect(missionListEntrySchema.safeParse("").success).toBe(false);
    expect(missionListEntrySchema.safeParse("ok").success).toBe(true);
    expect(
      missionListEntrySchema.safeParse("x".repeat(MISSION_DRAFT_LIST_ITEM_MAX + 1))
        .success,
    ).toBe(false);
  });

  it("missionDraftDtoSchema requires uuid sessionId + enum status + lists", () => {
    const parsed = missionDraftDtoSchema.safeParse({
      missionId: "mission-1",
      sessionId: SESSION,
      status: "draft",
      title: "Rebalance",
      goal: "Rebalance the Arbitrum LP",
      constraints: {},
      successCriteria: ["TVL increased"],
      stopConditions: ["TVL drops by 10%"],
      riskProfile: "balanced",
      allowedChains: ["ethereum", "arbitrum"],
      allowedProtocols: ["uniswap"],
      allowedWallets: ["wallet-1"],
      createdAt: ISO,
      updatedAt: ISO,
      approvedAt: null,
    });
    expect(parsed.success).toBe(true);
  });

  it("missionDraftDtoSchema rejects unknown status outside the enum", () => {
    const parsed = missionDraftDtoSchema.safeParse({
      missionId: "mission-1",
      sessionId: SESSION,
      status: "unknown",
      title: null,
      goal: null,
      constraints: {},
      successCriteria: [],
      stopConditions: [],
      riskProfile: null,
      allowedChains: [],
      allowedProtocols: [],
      allowedWallets: [],
      createdAt: ISO,
      updatedAt: ISO,
      approvedAt: null,
    });
    expect(parsed.success).toBe(false);
  });

  it("missionGetDraftInputSchema requires uuid sessionId", () => {
    expect(missionGetDraftInputSchema.safeParse({ sessionId: SESSION }).success).toBe(
      true,
    );
    expect(missionGetDraftInputSchema.safeParse({ sessionId: "x" }).success).toBe(
      false,
    );
  });
});
