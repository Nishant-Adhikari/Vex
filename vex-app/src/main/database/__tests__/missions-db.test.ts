/**
 * missions-db tests — JSONB allowlist + fallback.
 *
 * Codex review hard requirement: every JSONB column (`constraints_json`,
 * `success_criteria_json`, `stop_conditions_json`) gets allow-listed +
 * Zod-validated before reaching the renderer. Unparseable payloads
 * collapse to safe defaults so the boundary stays leak-proof.
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

const { getDraftForSession } = await import("../missions-db.js");

const SESSION = "00000000-0000-4000-8000-00000000cccc";

/** A minimal draft row with a custom `constraints_json` blob. */
function rowWithConstraints(constraints: Record<string, unknown>) {
  return {
    id: "mission-ar",
    root_session_id: SESSION,
    status: "draft",
    title: "AR",
    goal: "g",
    constraints_json: constraints,
    success_criteria_json: [],
    stop_conditions_json: [],
    risk_profile: null,
    allowed_protocols: [],
    allowed_chains: [],
    allowed_wallets: [],
    created_at: "2026-05-21T10:00:00.000Z",
    updated_at: "2026-05-21T10:00:00.000Z",
    approved_at: null,
  };
}

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

describe("missions-db mapper", () => {
  it("returns null when no draft row exists for session", async () => {
    mocks.query.mockResolvedValueOnce({ rows: [] });
    const result = await getDraftForSession(SESSION);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toBeNull();
  });

  it("strips unknown keys from constraints_json via allowlist projection", async () => {
    mocks.query.mockResolvedValueOnce({
      rows: [
        {
          id: "mission-1",
          root_session_id: SESSION,
          status: "draft",
          title: "Rebalance",
          goal: "Move LP",
          constraints_json: {
            maxSpendUsd: 100,
            secretApiKey: "leak-this", // unknown -> dropped
            maxLossUsd: 10,
          },
          success_criteria_json: ["TVL up"],
          stop_conditions_json: ["TVL down 10%"],
          risk_profile: "balanced",
          allowed_protocols: ["uniswap"],
          allowed_chains: ["ethereum"],
          allowed_wallets: ["w1"],
          created_at: "2026-05-21T10:00:00.000Z",
          updated_at: "2026-05-21T10:00:00.000Z",
          approved_at: null,
        },
      ],
    });

    const result = await getDraftForSession(SESSION);
    expect(result.ok).toBe(true);
    if (!result.ok || result.data === null) {
      expect.fail("Expected mission draft to be present");
      return;
    }
    expect(result.data.constraints).toEqual({
      maxSpendUsd: 100,
      maxLossUsd: 10,
    });
    expect(result.data.constraints).not.toHaveProperty("secretApiKey");
  });

  it("projects autoRetryEnabled=true through the allowlist (4d-5)", async () => {
    mocks.query.mockResolvedValueOnce({
      rows: [
        rowWithConstraints({
          autoRetryEnabled: true,
          maxSpendUsd: 50,
          secretApiKey: "leak", // forces the allowlist projection branch
        }),
      ],
    });
    const result = await getDraftForSession(SESSION);
    expect(result.ok).toBe(true);
    if (!result.ok || result.data === null) {
      expect.fail("Expected mission draft to be present");
      return;
    }
    expect(result.data.constraints.autoRetryEnabled).toBe(true);
    expect(result.data.constraints.maxSpendUsd).toBe(50);
    expect(result.data.constraints).not.toHaveProperty("secretApiKey");
  });

  it("preserves autoRetryEnabled=false (typeof guard, not truthiness)", async () => {
    mocks.query.mockResolvedValueOnce({
      rows: [rowWithConstraints({ autoRetryEnabled: false, secretApiKey: "x" })],
    });
    const result = await getDraftForSession(SESSION);
    expect(result.ok).toBe(true);
    if (!result.ok || result.data === null) {
      expect.fail("Expected mission draft to be present");
      return;
    }
    expect(result.data.constraints.autoRetryEnabled).toBe(false);
  });

  it("drops a non-boolean autoRetryEnabled", async () => {
    mocks.query.mockResolvedValueOnce({
      rows: [rowWithConstraints({ autoRetryEnabled: "yes", maxSpendUsd: 50 })],
    });
    const result = await getDraftForSession(SESSION);
    expect(result.ok).toBe(true);
    if (!result.ok || result.data === null) {
      expect.fail("Expected mission draft to be present");
      return;
    }
    expect(result.data.constraints).not.toHaveProperty("autoRetryEnabled");
    expect(result.data.constraints.maxSpendUsd).toBe(50);
  });

  it("collapses constraints_json to empty when entirely unparseable", async () => {
    mocks.query.mockResolvedValueOnce({
      rows: [
        {
          id: "mission-2",
          root_session_id: SESSION,
          status: "draft",
          title: null,
          goal: null,
          constraints_json: "not-an-object",
          success_criteria_json: [],
          stop_conditions_json: [],
          risk_profile: null,
          allowed_protocols: [],
          allowed_chains: [],
          allowed_wallets: [],
          created_at: "2026-05-21T10:00:00.000Z",
          updated_at: "2026-05-21T10:00:00.000Z",
          approved_at: null,
        },
      ],
    });

    const result = await getDraftForSession(SESSION);
    expect(result.ok).toBe(true);
    if (!result.ok || result.data === null) return;
    expect(result.data.constraints).toEqual({});
  });

  it("filters non-string entries from success_criteria_json", async () => {
    mocks.query.mockResolvedValueOnce({
      rows: [
        {
          id: "mission-3",
          root_session_id: SESSION,
          status: "draft",
          title: null,
          goal: null,
          constraints_json: {},
          success_criteria_json: [
            "TVL up",
            42,
            { nested: "object" },
            null,
            "Profit > 10%",
          ],
          stop_conditions_json: [],
          risk_profile: null,
          allowed_protocols: [],
          allowed_chains: [],
          allowed_wallets: [],
          created_at: "2026-05-21T10:00:00.000Z",
          updated_at: "2026-05-21T10:00:00.000Z",
          approved_at: null,
        },
      ],
    });

    const result = await getDraftForSession(SESSION);
    expect(result.ok).toBe(true);
    if (!result.ok || result.data === null) return;
    expect(result.data.successCriteria).toEqual(["TVL up", "Profit > 10%"]);
  });

  it("normalises pg TEXT[] arrays and skips non-string entries", async () => {
    mocks.query.mockResolvedValueOnce({
      rows: [
        {
          id: "mission-4",
          root_session_id: SESSION,
          status: "draft",
          title: null,
          goal: null,
          constraints_json: {},
          success_criteria_json: [],
          stop_conditions_json: [],
          risk_profile: null,
          allowed_protocols: ["uniswap", 123 as unknown as string, "aave"],
          allowed_chains: ["ethereum", "", "polygon"],
          allowed_wallets: null,
          created_at: "2026-05-21T10:00:00.000Z",
          updated_at: "2026-05-21T10:00:00.000Z",
          approved_at: null,
        },
      ],
    });

    const result = await getDraftForSession(SESSION);
    expect(result.ok).toBe(true);
    if (!result.ok || result.data === null) return;
    expect(result.data.allowedProtocols).toEqual(["uniswap", "aave"]);
    expect(result.data.allowedChains).toEqual(["ethereum", "polygon"]);
    expect(result.data.allowedWallets).toEqual([]);
  });

  // Phase-6 acceptance projection + renewedFromMissionId coverage
  // lives in the focused `missions-db.acceptance.test.ts` file so this
  // suite stays under the 350-LOC budget (codex puzzle 04 phase 6 #2).

  it("collapses unknown status to 'draft' (defensive)", async () => {
    mocks.query.mockResolvedValueOnce({
      rows: [
        {
          id: "mission-5",
          root_session_id: SESSION,
          status: "weird",
          title: null,
          goal: null,
          constraints_json: {},
          success_criteria_json: [],
          stop_conditions_json: [],
          risk_profile: null,
          allowed_protocols: [],
          allowed_chains: [],
          allowed_wallets: [],
          created_at: "2026-05-21T10:00:00.000Z",
          updated_at: "2026-05-21T10:00:00.000Z",
          approved_at: null,
        },
      ],
    });

    const result = await getDraftForSession(SESSION);
    expect(result.ok).toBe(true);
    if (!result.ok || result.data === null) return;
    expect(result.data.status).toBe("draft");
  });
});
