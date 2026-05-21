/**
 * mission-runs-db tests — empty + active row mapping + defensive status.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type QueryFn = (
  text: string,
  params?: readonly unknown[],
) => Promise<{ rows: ReadonlyArray<Record<string, unknown>> }>;

const mocks = vi.hoisted(() => ({
  query: vi.fn() as QueryFn,
  connect: vi.fn(),
  end: vi.fn(),
  buildPoolConfig: vi.fn(),
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("pg", () => {
  function MockClient() {
    return {
      connect: mocks.connect,
      end: mocks.end,
      query: mocks.query,
    };
  }
  return { Client: MockClient };
});

vi.mock("../db-config.js", () => ({
  buildPoolConfig: mocks.buildPoolConfig,
}));

vi.mock("../../logger/index.js", () => ({ log: mocks.log }));

const { getActiveRunForSession } = await import("../mission-runs-db.js");

const SESSION = "00000000-0000-4000-8000-00000000eeee";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.buildPoolConfig.mockResolvedValue({
    host: "127.0.0.1",
    port: 5777,
    database: "vex",
    user: "vex",
    password: "secret",
  });
  mocks.connect.mockResolvedValue(undefined);
  mocks.end.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("mission-runs-db mapper", () => {
  it("returns inactive shape when session has no active/paused mission run", async () => {
    mocks.query.mockResolvedValueOnce({ rows: [] });
    const result = await getActiveRunForSession(SESSION);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toEqual({
      sessionId: SESSION,
      hasActiveRun: false,
      missionRunId: null,
      status: null,
      stopReason: null,
      lastCheckpointAt: null,
      startedAt: null,
      iterationCount: null,
    });
  });

  it("maps an active mission run row", async () => {
    mocks.query.mockResolvedValueOnce({
      rows: [
        {
          id: "run-1",
          session_id: SESSION,
          status: "running",
          started_at: "2026-05-21T09:00:00.000Z",
          last_checkpoint_at: "2026-05-21T10:00:00.000Z",
          stop_reason: null,
          iteration_count: "12",
        },
      ],
    });
    const result = await getActiveRunForSession(SESSION);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.hasActiveRun).toBe(true);
    expect(result.data.missionRunId).toBe("run-1");
    expect(result.data.status).toBe("running");
    expect(result.data.iterationCount).toBe(12);
  });

  it("collapses unknown status to null (defensive, hasActiveRun false)", async () => {
    mocks.query.mockResolvedValueOnce({
      rows: [
        {
          id: "run-2",
          session_id: SESSION,
          status: "paused_user", // adds in puzzle 03
          started_at: "2026-05-21T09:00:00.000Z",
          last_checkpoint_at: null,
          stop_reason: null,
          iteration_count: 0,
        },
      ],
    });
    const result = await getActiveRunForSession(SESSION);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.status).toBeNull();
    expect(result.data.hasActiveRun).toBe(false);
    expect(result.data.missionRunId).toBe("run-2");
  });

  it("dbUnavailable maps to internal.unexpected with domain=runtime", async () => {
    mocks.buildPoolConfig.mockReset();
    mocks.buildPoolConfig.mockResolvedValueOnce(null);
    const result = await getActiveRunForSession(SESSION);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("internal.unexpected");
    expect(result.error.domain).toBe("runtime");
  });
});
