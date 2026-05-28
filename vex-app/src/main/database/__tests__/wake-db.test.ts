/**
 * wake-db tests — `loop_wake_requests` schema-readiness probe.
 *
 * `pg.Client` and `buildPoolConfig` are mocked so this runs without a live
 * Postgres. Mirrors compaction-db.test.ts: the probe reflects `to_regclass`
 * and fails closed (→ false) on any error so the supervisor stays idle.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

const connectMock = vi.fn();
const queryMock = vi.fn();
const endMock = vi.fn();

vi.mock("pg", () => ({
  Client: class {
    connect = connectMock;
    query = queryMock;
    end = endMock;
  },
}));

vi.mock("../db-config.js", () => ({
  buildPoolConfig: vi.fn(async () => ({
    host: "localhost",
    port: 5432,
    database: "vex",
    user: "vex",
    password: "pw",
  })),
}));

vi.mock("../../logger/index.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { probeLoopWakeReady } = await import("../wake-db.js");

afterEach(() => {
  connectMock.mockReset();
  queryMock.mockReset();
  endMock.mockReset();
});

describe("probeLoopWakeReady", () => {
  it("is true when to_regclass resolves the table", async () => {
    connectMock.mockResolvedValue(undefined);
    queryMock.mockResolvedValueOnce({ rows: [{ reg: "loop_wake_requests" }] });
    endMock.mockResolvedValue(undefined);
    expect(await probeLoopWakeReady()).toBe(true);
  });

  it("is false when the table is absent (migrations not yet run)", async () => {
    connectMock.mockResolvedValue(undefined);
    queryMock.mockResolvedValueOnce({ rows: [{ reg: null }] });
    endMock.mockResolvedValue(undefined);
    expect(await probeLoopWakeReady()).toBe(false);
  });

  it("is false when Postgres is unreachable", async () => {
    connectMock.mockRejectedValueOnce(new Error("no db"));
    expect(await probeLoopWakeReady()).toBe(false);
  });

  it("is false when the probe query errors", async () => {
    connectMock.mockResolvedValue(undefined);
    queryMock.mockRejectedValueOnce(new Error("boom"));
    endMock.mockResolvedValue(undefined);
    expect(await probeLoopWakeReady()).toBe(false);
  });
});
