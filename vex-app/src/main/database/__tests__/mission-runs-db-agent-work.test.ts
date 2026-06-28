/**
 * hasActiveAgentWork tri-state gate (M13, Codex review #2).
 *
 *   - DB unconfigured (buildPoolConfig null)  -> fail-OPEN ({active:false}).
 *   - configured but connect/query fails      -> fail-CLOSED ({active:true}).
 *   - query succeeds                          -> running/lease/approval signal.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const connect = vi.fn();
const query = vi.fn();
const end = vi.fn();

class FakeClient {
  connect = connect;
  query = query;
  end = end;
  constructor(_config: unknown) {}
}

vi.mock("pg", () => ({ Client: FakeClient }));

const buildPoolConfig = vi.fn();
vi.mock("../db-config.js", () => ({
  buildPoolConfig: () => buildPoolConfig(),
}));

vi.mock("../../logger/index.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { hasActiveAgentWork } = await import("../mission-runs-db.js");

const CONFIG = {
  host: "127.0.0.1",
  port: 5432,
  database: "vex",
  user: "vex",
  password: "secret",
};

beforeEach(() => {
  vi.clearAllMocks();
  connect.mockResolvedValue(undefined);
  end.mockResolvedValue(undefined);
});

describe("hasActiveAgentWork", () => {
  it("fail-OPEN when the DB is unconfigured (pre-onboarding)", async () => {
    buildPoolConfig.mockResolvedValue(null);
    await expect(hasActiveAgentWork()).resolves.toEqual({
      active: false,
      reason: "",
    });
    expect(connect).not.toHaveBeenCalled();
  });

  it("fail-CLOSED when a configured DB cannot connect", async () => {
    buildPoolConfig.mockResolvedValue(CONFIG);
    connect.mockRejectedValue(new Error("ECONNREFUSED"));
    const result = await hasActiveAgentWork();
    expect(result.active).toBe(true);
    expect(result.reason).toMatch(/verify/i);
  });

  it("fail-CLOSED when the query throws (services half-up)", async () => {
    buildPoolConfig.mockResolvedValue(CONFIG);
    query.mockRejectedValue(new Error('relation "mission_runs" does not exist'));
    const result = await hasActiveAgentWork();
    expect(result.active).toBe(true);
    expect(end).toHaveBeenCalled();
  });

  it("active when a mission is running", async () => {
    buildPoolConfig.mockResolvedValue(CONFIG);
    query.mockResolvedValue({
      rows: [
        { running_mission: true, active_lease: false, pending_approval: false },
      ],
    });
    const result = await hasActiveAgentWork();
    expect(result.active).toBe(true);
    expect(end).toHaveBeenCalled();
  });

  it("active when an approval is pending", async () => {
    buildPoolConfig.mockResolvedValue(CONFIG);
    query.mockResolvedValue({
      rows: [
        { running_mission: false, active_lease: false, pending_approval: true },
      ],
    });
    await expect(hasActiveAgentWork()).resolves.toMatchObject({ active: true });
  });

  it("idle when nothing is active", async () => {
    buildPoolConfig.mockResolvedValue(CONFIG);
    query.mockResolvedValue({
      rows: [
        { running_mission: false, active_lease: false, pending_approval: false },
      ],
    });
    await expect(hasActiveAgentWork()).resolves.toEqual({
      active: false,
      reason: "",
    });
  });
});
