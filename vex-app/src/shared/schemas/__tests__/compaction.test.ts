import { describe, expect, it } from "vitest";
import {
  COMPACT_JOB_STATUSES,
  COMPACTION_HISTORY_MAX_LIMIT,
  compactionHistoryInputSchema,
  compactionHistoryItemSchema,
  compactionHistoryResultSchema,
  compactionRetryInputSchema,
  compactionRetryResultSchema,
  compactionStatusDtoSchema,
  compactionStatusInputSchema,
  compactionStatusResultSchema,
} from "../compaction.js";

const SESSION = "00000000-0000-4000-8000-000000000007";
const ISO = "2026-05-21T10:00:00.000Z";

describe("compaction schemas", () => {
  it("input requires a uuid sessionId and is strict", () => {
    expect(
      compactionStatusInputSchema.safeParse({ sessionId: SESSION }).success,
    ).toBe(true);
    expect(
      compactionStatusInputSchema.safeParse({ sessionId: "nope" }).success,
    ).toBe(false);
    expect(
      compactionStatusInputSchema.safeParse({ sessionId: SESSION, extra: 1 })
        .success,
    ).toBe(false);
  });

  it("accepts a DTO with a latest job + active count", () => {
    expect(
      compactionStatusDtoSchema.safeParse({
        sessionId: SESSION,
        latest: { status: "running", checkpointGeneration: 2, updatedAt: ISO },
        activeCount: 1,
      }).success,
    ).toBe(true);
  });

  it("accepts a DTO with no jobs (latest null, zero active)", () => {
    expect(
      compactionStatusDtoSchema.safeParse({
        sessionId: SESSION,
        latest: null,
        activeCount: 0,
      }).success,
    ).toBe(true);
  });

  it("rejects an unknown job status and a negative activeCount", () => {
    expect(
      compactionStatusDtoSchema.safeParse({
        sessionId: SESSION,
        latest: { status: "bogus", checkpointGeneration: 0, updatedAt: ISO },
        activeCount: 0,
      }).success,
    ).toBe(false);
    expect(
      compactionStatusDtoSchema.safeParse({
        sessionId: SESSION,
        latest: null,
        activeCount: -1,
      }).success,
    ).toBe(false);
  });

  it("rejects unknown keys (strict) on the DTO and the latest job", () => {
    expect(
      compactionStatusDtoSchema.safeParse({
        sessionId: SESSION,
        latest: null,
        activeCount: 0,
        extra: true,
      }).success,
    ).toBe(false);
    expect(
      compactionStatusDtoSchema.safeParse({
        sessionId: SESSION,
        latest: {
          status: "running",
          checkpointGeneration: 0,
          updatedAt: ISO,
          extra: 1,
        },
        activeCount: 0,
      }).success,
    ).toBe(false);
  });

  it("result accepts null (missing/deleted/out-of-scope session)", () => {
    expect(compactionStatusResultSchema.safeParse(null).success).toBe(true);
  });

  it("mirrors the engine's five compact-job statuses", () => {
    expect([...COMPACT_JOB_STATUSES]).toEqual([
      "pending",
      "running",
      "completed",
      "failed",
      "permanently_failed",
    ]);
  });
});

describe("compaction history schemas (stage 7-2a)", () => {
  const ISO = "2026-05-21T10:00:00.000Z";
  const SESSION = "00000000-0000-4000-8000-000000000008";
  const VALID_ITEM = {
    checkpointGeneration: 3,
    status: "completed",
    sourceStartMessageId: 1,
    sourceEndMessageId: 30,
    chunksInserted: 2,
    createdAt: ISO,
    startedAt: ISO,
    completedAt: ISO,
  };

  it("history input requires a uuid + caps the limit", () => {
    expect(
      compactionHistoryInputSchema.safeParse({ sessionId: SESSION }).success,
    ).toBe(true);
    expect(
      compactionHistoryInputSchema.safeParse({
        sessionId: SESSION,
        limit: COMPACTION_HISTORY_MAX_LIMIT + 1,
      }).success,
    ).toBe(false);
  });

  it("history item accepts null message ids + nullable started/completed", () => {
    expect(compactionHistoryItemSchema.safeParse(VALID_ITEM).success).toBe(true);
    expect(
      compactionHistoryItemSchema.safeParse({
        ...VALID_ITEM,
        sourceStartMessageId: null,
        startedAt: null,
        completedAt: null,
      }).success,
    ).toBe(true);
  });

  it("history result accepts null (foreign session) and an array", () => {
    expect(compactionHistoryResultSchema.safeParse(null).success).toBe(true);
    expect(compactionHistoryResultSchema.safeParse([VALID_ITEM]).success).toBe(
      true,
    );
  });
});

describe("compaction retry schemas (stage 8-5)", () => {
  const SID = "00000000-0000-4000-8000-000000000009";

  it("input requires a uuid + non-negative generation; strict", () => {
    expect(
      compactionRetryInputSchema.safeParse({ sessionId: SID, checkpointGeneration: 0 })
        .success,
    ).toBe(true);
    expect(
      compactionRetryInputSchema.safeParse({ sessionId: "nope", checkpointGeneration: 0 })
        .success,
    ).toBe(false);
    expect(
      compactionRetryInputSchema.safeParse({ sessionId: SID, checkpointGeneration: -1 })
        .success,
    ).toBe(false);
    expect(compactionRetryInputSchema.safeParse({ sessionId: SID }).success).toBe(
      false,
    );
    expect(
      compactionRetryInputSchema.safeParse({
        sessionId: SID,
        checkpointGeneration: 0,
        extra: 1,
      }).success,
    ).toBe(false);
  });

  it("result echoes the generation + a valid job status; rejects a bad status", () => {
    expect(
      compactionRetryResultSchema.safeParse({ checkpointGeneration: 2, status: "pending" })
        .success,
    ).toBe(true);
    expect(
      compactionRetryResultSchema.safeParse({ checkpointGeneration: 2, status: "bogus" })
        .success,
    ).toBe(false);
  });
});
