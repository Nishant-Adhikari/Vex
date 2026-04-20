/**
 * Unit tests for the `loop_defer` handler — Zod validation, defense-in-depth
 * against visibility bypasses, and registry visibility gating. DB is mocked
 * (no testcontainers); claim of the enqueue contract is exercised in
 * `loop-wake.test.ts`.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeTestContext } from "../_test-context.js";

// ── Mocks ─────────────────────────────────────────────────────

const mockEnqueue = vi.fn();
const mockCancelForSession = vi.fn();
const mockClaimDue = vi.fn();
const mockGetPendingForSession = vi.fn();

vi.mock("@echo-agent/db/repos/loop-wake.js", () => ({
  enqueue: (...args: unknown[]) => mockEnqueue(...args),
  cancelForSession: (...args: unknown[]) => mockCancelForSession(...args),
  claimDue: (...args: unknown[]) => mockClaimDue(...args),
  getPendingForSession: (...args: unknown[]) => mockGetPendingForSession(...args),
}));

// Stub DB client — handler doesn't touch it, but import chain via types.ts
// would try to resolve a real pool without this.
vi.mock("@echo-agent/db/client.js", () => ({
  execute: vi.fn(),
  query: vi.fn().mockResolvedValue([]),
  queryOne: vi.fn().mockResolvedValue(null),
  queryOneWith: vi.fn().mockResolvedValue(null),
  getPool: () => ({ connect: vi.fn() }),
}));

const { handleLoopDefer } = await import(
  "../../../../echo-agent/tools/internal/loop-defer.js"
);

const { getOpenAITools, defaultVisibilityContext } = await import(
  "../../../../echo-agent/tools/registry.js"
);

// ── Fixtures ───────────────────────────────────────────────────

function ctxMissionActive() {
  return makeTestContext({
    sessionId: "session-mission-1",
    loopMode: "restricted",
    sessionKind: "mission",
    missionRunId: "run-abc",
  });
}

function ctxFullAutonomous() {
  return makeTestContext({
    sessionId: "session-auto-1",
    loopMode: "full",
    sessionKind: "full_autonomous",
    missionRunId: null,
  });
}

function enqueueReturn(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "wake-uuid-xyz",
    sessionId: "session-mission-1",
    missionRunId: "run-abc",
    kind: "mission_run",
    dueAt: "2026-04-20T11:00:00.000Z",
    status: "pending",
    reason: "waiting for finality",
    payload: null,
    createdAt: "2026-04-20T10:00:00.000Z",
    consumedAt: null,
    cancelledAt: null,
    cancelledReason: null,
    ...overrides,
  };
}

beforeEach(() => {
  mockEnqueue.mockReset();
  mockEnqueue.mockResolvedValue(enqueueReturn());
  vi.useRealTimers();
});

// ── Zod validation ─────────────────────────────────────────────

describe("loop_defer — argument validation", () => {
  it("rejects missing reason", async () => {
    const result = await handleLoopDefer({ after_ms: 10_000 }, ctxMissionActive());
    expect(result.success).toBe(false);
    expect(result.output).toMatch(/reason/i);
  });

  it("rejects empty reason", async () => {
    const result = await handleLoopDefer(
      { after_ms: 10_000, reason: "" },
      ctxMissionActive(),
    );
    expect(result.success).toBe(false);
    expect(result.output).toMatch(/reason/i);
  });

  it("rejects reason over 500 chars", async () => {
    const result = await handleLoopDefer(
      { after_ms: 10_000, reason: "x".repeat(501) },
      ctxMissionActive(),
    );
    expect(result.success).toBe(false);
    expect(result.output).toMatch(/500/);
  });

  it("rejects when neither after_ms nor wake_at is provided", async () => {
    const result = await handleLoopDefer({ reason: "waiting" }, ctxMissionActive());
    expect(result.success).toBe(false);
    expect(result.output).toMatch(/exactly one/i);
  });

  it("rejects when both after_ms and wake_at are provided", async () => {
    const result = await handleLoopDefer(
      { after_ms: 10_000, wake_at: "2026-04-20T11:00:00Z", reason: "waiting" },
      ctxMissionActive(),
    );
    expect(result.success).toBe(false);
    expect(result.output).toMatch(/exactly one/i);
  });

  it("rejects after_ms below 1s", async () => {
    const result = await handleLoopDefer(
      { after_ms: 500, reason: "too short" },
      ctxMissionActive(),
    );
    expect(result.success).toBe(false);
    expect(result.output).toMatch(/1000/);
  });

  it("rejects after_ms over 24h", async () => {
    const result = await handleLoopDefer(
      { after_ms: 86_400_001, reason: "too long" },
      ctxMissionActive(),
    );
    expect(result.success).toBe(false);
  });

  it("rejects non-integer after_ms", async () => {
    const result = await handleLoopDefer(
      { after_ms: 5000.5, reason: "fractional" },
      ctxMissionActive(),
    );
    expect(result.success).toBe(false);
  });

  it("rejects invalid ISO8601 wake_at", async () => {
    const result = await handleLoopDefer(
      { wake_at: "not-a-date", reason: "bad date" },
      ctxMissionActive(),
    );
    expect(result.success).toBe(false);
  });

  it("rejects wake_at in the past", async () => {
    const result = await handleLoopDefer(
      { wake_at: "2020-01-01T00:00:00Z", reason: "time travel" },
      ctxMissionActive(),
    );
    expect(result.success).toBe(false);
    expect(result.output).toMatch(/future/i);
  });
});

// ── Defense-in-depth (runtime context) ─────────────────────────

describe("loop_defer — defense-in-depth", () => {
  it("rejects subagent role even if sessionKind matches", async () => {
    const ctx = makeTestContext({
      sessionKind: "mission",
      missionRunId: "run-abc",
      role: "subagent",
    });
    const result = await handleLoopDefer(
      { after_ms: 10_000, reason: "try" },
      ctx,
    );
    expect(result.success).toBe(false);
    expect(result.output).toMatch(/active mission run or a full-autonomous/i);
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it("rejects chat sessionKind", async () => {
    const ctx = makeTestContext({
      sessionKind: "chat",
      missionRunId: null,
    });
    const result = await handleLoopDefer(
      { after_ms: 10_000, reason: "try" },
      ctx,
    );
    expect(result.success).toBe(false);
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it("rejects mission sessionKind without active missionRunId (setup)", async () => {
    const ctx = makeTestContext({
      sessionKind: "mission",
      missionRunId: null,
    });
    const result = await handleLoopDefer(
      { after_ms: 10_000, reason: "try" },
      ctx,
    );
    expect(result.success).toBe(false);
    expect(mockEnqueue).not.toHaveBeenCalled();
  });
});

// ── Happy path ─────────────────────────────────────────────────

describe("loop_defer — happy path", () => {
  it("enqueues with kind=mission_run for mission active run and returns engineSignal", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-20T10:00:00.000Z"));

    const result = await handleLoopDefer(
      { after_ms: 60_000, reason: "waiting for finality" },
      ctxMissionActive(),
    );

    expect(result.success).toBe(true);
    expect(mockEnqueue).toHaveBeenCalledTimes(1);
    const [input] = mockEnqueue.mock.calls[0];
    expect(input).toMatchObject({
      sessionId: "session-mission-1",
      missionRunId: "run-abc",
      kind: "mission_run",
      reason: "waiting for finality",
      payload: null,
    });
    // after_ms=60s → dueAt = now + 60s.
    expect((input.dueAt as Date).toISOString()).toBe("2026-04-20T10:01:00.000Z");

    expect(result.engineSignal?.type).toBe("defer_until");
    expect(result.engineSignal?.dueAt).toBe("2026-04-20T11:00:00.000Z");
    expect(result.data?.defer_id).toBe("wake-uuid-xyz");
  });

  it("enqueues with kind=full_autonomous for standalone full-autonomous session", async () => {
    mockEnqueue.mockResolvedValueOnce(
      enqueueReturn({ kind: "full_autonomous", missionRunId: null, sessionId: "session-auto-1" }),
    );

    const result = await handleLoopDefer(
      { wake_at: "2030-01-01T00:00:00Z", reason: "long idle" },
      ctxFullAutonomous(),
    );

    expect(result.success).toBe(true);
    const [input] = mockEnqueue.mock.calls[0];
    expect(input).toMatchObject({
      sessionId: "session-auto-1",
      missionRunId: null,
      kind: "full_autonomous",
      reason: "long idle",
    });
    expect((input.dueAt as Date).toISOString()).toBe("2030-01-01T00:00:00.000Z");
  });

  it("soft-fails when a pending wake already exists (enqueue returns null)", async () => {
    mockEnqueue.mockResolvedValueOnce(null);
    const result = await handleLoopDefer(
      { after_ms: 60_000, reason: "already queued" },
      ctxMissionActive(),
    );
    expect(result.success).toBe(false);
    expect(result.output).toMatch(/pending wake already exists/i);
  });
});

// ── Registry visibility ────────────────────────────────────────

describe("loop_defer — visibility", () => {
  it("is visible in a mission active run (restricted)", () => {
    const tools = getOpenAITools(defaultVisibilityContext({
      chatMode: "restricted",
      sessionKind: "mission",
      missionRunActive: true,
    }));
    const names = tools.map((t) => t.function.name);
    expect(names).toContain("loop_defer");
  });

  it("is visible in a mission active run (full)", () => {
    const tools = getOpenAITools(defaultVisibilityContext({
      chatMode: "full",
      sessionKind: "mission",
      missionRunActive: true,
    }));
    const names = tools.map((t) => t.function.name);
    expect(names).toContain("loop_defer");
  });

  it("is visible in a standalone full_autonomous session", () => {
    const tools = getOpenAITools(defaultVisibilityContext({
      chatMode: "full",
      sessionKind: "full_autonomous",
      missionRunActive: false,
    }));
    const names = tools.map((t) => t.function.name);
    expect(names).toContain("loop_defer");
  });

  it("is hidden in a chat session", () => {
    const tools = getOpenAITools(defaultVisibilityContext({ sessionKind: "chat" }));
    const names = tools.map((t) => t.function.name);
    expect(names).not.toContain("loop_defer");
  });

  it("is hidden in mission setup (missionRunActive=false)", () => {
    const tools = getOpenAITools(defaultVisibilityContext({
      chatMode: "off",
      sessionKind: "mission",
      missionRunActive: false,
    }));
    const names = tools.map((t) => t.function.name);
    expect(names).not.toContain("loop_defer");
  });

  it("is hidden from the subagent role even in a mission active run", () => {
    const tools = getOpenAITools(defaultVisibilityContext({
      chatMode: "restricted",
      role: "subagent",
      sessionKind: "mission",
      missionRunActive: true,
    }));
    const names = tools.map((t) => t.function.name);
    expect(names).not.toContain("loop_defer");
  });
});
