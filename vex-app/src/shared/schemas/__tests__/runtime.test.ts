import { describe, expect, it } from "vitest";
import {
  runtimeRequestInputSchema,
  runtimeRequestResultSchema,
  runtimeStateDtoSchema,
} from "../runtime.js";

const SESSION = "00000000-0000-4000-8000-000000000002";
const ISO = "2026-05-21T10:00:00.000Z";

describe("runtime schemas", () => {
  it("runtimeStateDtoSchema accepts an inactive shape", () => {
    const parsed = runtimeStateDtoSchema.safeParse({
      sessionId: SESSION,
      hasActiveRun: false,
      missionRunId: null,
      status: null,
      stopReason: null,
      lastCheckpointAt: null,
      startedAt: null,
      iterationCount: null,
    });
    expect(parsed.success).toBe(true);
  });

  it("runtimeStateDtoSchema accepts an active shape with status enum", () => {
    const parsed = runtimeStateDtoSchema.safeParse({
      sessionId: SESSION,
      hasActiveRun: true,
      missionRunId: "run-1",
      status: "running",
      stopReason: null,
      lastCheckpointAt: ISO,
      startedAt: ISO,
      iterationCount: 3,
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects unknown mission status (closed enum)", () => {
    const parsed = runtimeStateDtoSchema.safeParse({
      sessionId: SESSION,
      hasActiveRun: true,
      missionRunId: "run-1",
      status: "paused_user", // adds in puzzle 03
      stopReason: null,
      lastCheckpointAt: null,
      startedAt: ISO,
      iterationCount: 0,
    });
    expect(parsed.success).toBe(false);
  });

  it("runtimeRequestInputSchema requires uuid sessionId", () => {
    expect(
      runtimeRequestInputSchema.safeParse({ sessionId: SESSION }).success,
    ).toBe(true);
    expect(runtimeRequestInputSchema.safeParse({ sessionId: "x" }).success).toBe(
      false,
    );
  });

  it("runtimeRequestResultSchema accepts the three documented status variants", () => {
    for (const status of ["queued", "already_terminal", "unavailable"] as const) {
      const parsed = runtimeRequestResultSchema.safeParse({
        status,
        missionRunId: null,
        message: "x",
      });
      expect(parsed.success).toBe(true);
    }
  });
});
