/**
 * Tests for the M9 dim-lock DB helper.
 *
 * Mocks `pg` Client + `buildPoolConfig` to exercise:
 *  - happy: returns ok(rowCount)
 *  - DB unavailable when buildPoolConfig returns null
 *  - DB unavailable when buildPoolConfig throws
 *  - DB unavailable when client.connect throws
 *  - DB unavailable when client.query throws
 *  - client.end always called (best-effort, swallows its own errors)
 *  - probeDbReachable returns true on connect / false on failure
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockBuildPoolConfig = vi.fn();
const mockConnect = vi.fn();
const mockQuery = vi.fn();
const mockEnd = vi.fn();

vi.mock("pg", () => {
  class FakeClient {
    connect = mockConnect;
    query = mockQuery;
    end = mockEnd;
    constructor(_cfg: unknown) {}
  }
  return { Client: FakeClient };
});

vi.mock("../db-config.js", () => ({
  buildPoolConfig: () => mockBuildPoolConfig(),
}));

vi.mock("../../logger/index.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { countRowsWithDimNotMatching, probeDbReachable } = await import(
  "../dim-lock.js"
);

const HEALTHY_CFG = {
  host: "127.0.0.1",
  port: 55432,
  database: "vex",
  user: "vex",
  password: "secret",
};

beforeEach(() => {
  mockBuildPoolConfig.mockReset();
  mockConnect.mockReset();
  mockQuery.mockReset();
  mockEnd.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("countRowsWithDimNotMatching", () => {
  it("returns ok(rowCount) on success", async () => {
    mockBuildPoolConfig.mockResolvedValue(HEALTHY_CFG);
    mockConnect.mockResolvedValue(undefined);
    mockQuery.mockResolvedValue({ rows: [{ n: "5" }] });
    mockEnd.mockResolvedValue(undefined);

    const r = await countRowsWithDimNotMatching(768);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data).toBe(5);
    expect(mockEnd).toHaveBeenCalled();
  });

  it("returns ok(0) when count is missing/empty", async () => {
    mockBuildPoolConfig.mockResolvedValue(HEALTHY_CFG);
    mockConnect.mockResolvedValue(undefined);
    mockQuery.mockResolvedValue({ rows: [] });
    mockEnd.mockResolvedValue(undefined);

    const r = await countRowsWithDimNotMatching(768);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data).toBe(0);
  });

  it("returns embedding.db_unavailable when buildPoolConfig returns null", async () => {
    mockBuildPoolConfig.mockResolvedValue(null);
    const r = await countRowsWithDimNotMatching(768);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("embedding.db_unavailable");
    expect(mockConnect).not.toHaveBeenCalled();
  });

  it("returns embedding.db_unavailable when buildPoolConfig throws", async () => {
    mockBuildPoolConfig.mockRejectedValue(new Error("file not found"));
    const r = await countRowsWithDimNotMatching(768);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("embedding.db_unavailable");
  });

  it("returns embedding.db_unavailable when client.connect throws", async () => {
    mockBuildPoolConfig.mockResolvedValue(HEALTHY_CFG);
    mockConnect.mockRejectedValue(new Error("ECONNREFUSED"));
    mockEnd.mockResolvedValue(undefined);

    const r = await countRowsWithDimNotMatching(768);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("embedding.db_unavailable");
    expect(mockEnd).toHaveBeenCalled();
  });

  it("returns embedding.db_unavailable when client.query throws", async () => {
    mockBuildPoolConfig.mockResolvedValue(HEALTHY_CFG);
    mockConnect.mockResolvedValue(undefined);
    mockQuery.mockRejectedValue(new Error("relation knowledge_entries does not exist"));
    mockEnd.mockResolvedValue(undefined);

    const r = await countRowsWithDimNotMatching(768);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("embedding.db_unavailable");
    expect(mockEnd).toHaveBeenCalled();
  });

  it("end() failure does not leak through", async () => {
    mockBuildPoolConfig.mockResolvedValue(HEALTHY_CFG);
    mockConnect.mockResolvedValue(undefined);
    mockQuery.mockResolvedValue({ rows: [{ n: "0" }] });
    mockEnd.mockRejectedValue(new Error("end timeout"));

    const r = await countRowsWithDimNotMatching(768);
    expect(r.ok).toBe(true); // primary result preserved
    if (r.ok) expect(r.data).toBe(0);
  });
});

describe("probeDbReachable", () => {
  it("returns true on successful connect", async () => {
    mockBuildPoolConfig.mockResolvedValue(HEALTHY_CFG);
    mockConnect.mockResolvedValue(undefined);
    mockEnd.mockResolvedValue(undefined);
    expect(await probeDbReachable()).toBe(true);
  });

  it("returns false when buildPoolConfig returns null", async () => {
    mockBuildPoolConfig.mockResolvedValue(null);
    expect(await probeDbReachable()).toBe(false);
  });

  it("returns false on connect failure", async () => {
    mockBuildPoolConfig.mockResolvedValue(HEALTHY_CFG);
    mockConnect.mockRejectedValue(new Error("connect failed"));
    mockEnd.mockResolvedValue(undefined);
    expect(await probeDbReachable()).toBe(false);
  });
});
