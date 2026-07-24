/**
 * Orchestration tests for the mission retrospective — the read-or-lazily-
 * generate flow, exercised with fully injected deps + a fake chat client (no
 * real inference, no DB). Covers the fail-soft branches (no finalized run,
 * inference unavailable, malformed reply) and the happy path (generate +
 * persist + return), plus the cache short-circuit.
 *
 * @vitest-environment node
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MissionResultRow } from "@vex-agent/db/repos/mission-results.js";
import type { MissionRetrospectiveRow } from "@vex-agent/db/repos/mission-retrospectives.js";
import type { MoveItem } from "@shared/schemas/portfolio-moves.js";

vi.mock("../../logger/index.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
// The real SDK is never constructed — the orchestration takes an injected
// clientFactory — but the module imports it at load time.
vi.mock("@vex-lib/openrouter-client.js", () => ({ OpenRouter: class {} }));

const { getOrGenerateRetrospective } = await import("../retrospective.js");

const SESSION = "00000000-0000-4000-8000-00000000aaaa";
const RUN = "run-123";

function finalizedResult(over: Partial<MissionResultRow> = {}): MissionResultRow {
  return {
    id: "mres-1",
    missionId: "mission-1",
    missionRunId: RUN,
    sessionId: SESSION,
    walletAddress: "0xabc",
    chainId: 4663,
    seqNo: 1,
    goalSnippet: "Grow the bankroll",
    startedAt: "2026-07-13T10:00:00.000Z",
    endedAt: "2026-07-13T10:40:00.000Z",
    durationS: 2400,
    bankrollStartEth: 1,
    bankrollEndEth: 1.1,
    pnlEth: 0.1,
    pnlPct: 10,
    ethPriceUsdStart: 3000,
    ethPriceUsdEnd: 3000,
    trades: 1,
    wins: 0,
    losses: 0,
    rotations: 0,
    vetoes: 0,
    outcome: "completed",
    stopReason: "goal_reached",
    simulated: false,
    summary: "Target reached",
    openPositions: null,
    startPositions: null,
    ...over,
  };
}

function storedRetro(
  over: Partial<MissionRetrospectiveRow> = {},
): MissionRetrospectiveRow {
  return {
    id: "mretro-1",
    missionRunId: RUN,
    sessionId: SESSION,
    summary: "Disciplined single trade.",
    wentWell: ["Waited for liquidity"],
    wentWrong: [],
    lessons: ["Increase size when sell-back confirmed"],
    model: "test-model",
    createdAt: "2026-07-13T10:41:00.000Z",
    ...over,
  };
}

function move(over: Partial<MoveItem> = {}): MoveItem {
  return {
    id: "1",
    tradeSide: "buy",
    productType: "spot",
    venue: "kyberswap",
    inputToken: "ETH",
    inputTokenSymbol: "ETH",
    inputTokenLocalSymbol: null,
    inputAmount: "0.1",
    outputToken: "0xVENA",
    outputTokenSymbol: "VENA",
    outputTokenLocalSymbol: null,
    outputAmount: "1000",
    valueUsd: 100,
    captureStatus: "executed",
    instrumentKey: null,
    chain: "robinhood",
    txRef: null,
    walletAddress: "0xabc",
    rationale: "Momentum + deep liquidity",
    createdAt: "2026-07-13T10:05:00.000Z",
    ...over,
  };
}

function fakeClient(content: string) {
  return {
    chat: {
      send: vi.fn().mockResolvedValue({
        choices: [{ message: { content } }],
      }),
    },
  };
}

const CID = "corr-1";
let prevKey: string | undefined;
let prevModel: string | undefined;

beforeEach(() => {
  prevKey = process.env["OPENROUTER_API_KEY"];
  prevModel = process.env["AGENT_MODEL"];
  process.env["OPENROUTER_API_KEY"] = "test-key";
  process.env["AGENT_MODEL"] = "test-model";
});

afterEach(() => {
  if (prevKey === undefined) delete process.env["OPENROUTER_API_KEY"];
  else process.env["OPENROUTER_API_KEY"] = prevKey;
  if (prevModel === undefined) delete process.env["AGENT_MODEL"];
  else process.env["AGENT_MODEL"] = prevModel;
  vi.restoreAllMocks();
});

describe("getOrGenerateRetrospective", () => {
  it("returns null when the session has no finalized result", async () => {
    const deps = {
      readResult: vi.fn().mockResolvedValue(null),
      readExisting: vi.fn(),
      readMoves: vi.fn(),
      save: vi.fn(),
    };
    expect(await getOrGenerateRetrospective(SESSION, CID, deps)).toBeNull();
    expect(deps.readExisting).not.toHaveBeenCalled();
  });

  it("returns null when the run is still running (no inference)", async () => {
    const client = fakeClient("{}");
    const deps = {
      readResult: vi.fn().mockResolvedValue(finalizedResult({ outcome: "running" })),
      readExisting: vi.fn(),
      readMoves: vi.fn(),
      save: vi.fn(),
      clientFactory: () => client,
    };
    expect(await getOrGenerateRetrospective(SESSION, CID, deps)).toBeNull();
    expect(client.chat.send).not.toHaveBeenCalled();
  });

  it("serves the cached retrospective without re-inferring", async () => {
    const client = fakeClient("{}");
    const deps = {
      readResult: vi.fn().mockResolvedValue(finalizedResult()),
      readExisting: vi.fn().mockResolvedValue(storedRetro()),
      readMoves: vi.fn(),
      save: vi.fn(),
      clientFactory: () => client,
    };
    const dto = await getOrGenerateRetrospective(SESSION, CID, deps);
    expect(dto?.summary).toBe("Disciplined single trade.");
    expect(dto?.lessons[0]).toContain("sell-back");
    expect(client.chat.send).not.toHaveBeenCalled();
    expect(deps.save).not.toHaveBeenCalled();
  });

  it("returns null (fail-soft) when inference is unavailable (no key/model)", async () => {
    delete process.env["OPENROUTER_API_KEY"];
    const deps = {
      readResult: vi.fn().mockResolvedValue(finalizedResult()),
      readExisting: vi.fn().mockResolvedValue(null),
      readMoves: vi.fn().mockResolvedValue([move()]),
      save: vi.fn(),
    };
    expect(await getOrGenerateRetrospective(SESSION, CID, deps)).toBeNull();
    expect(deps.save).not.toHaveBeenCalled();
  });

  it("generates, persists, and returns the retrospective on a valid reply", async () => {
    const content = JSON.stringify({
      summary: "Bought VENA on momentum and exited at target.",
      wentWell: ["Confirmed liquidity before entry"],
      wentWrong: [],
      lessons: ["Keep requiring a sell-back check before any buy"],
    });
    const client = fakeClient(content);
    const readExisting = vi
      .fn()
      .mockResolvedValueOnce(null) // cache miss
      .mockResolvedValueOnce(
        storedRetro({
          summary: "Bought VENA on momentum and exited at target.",
          wentWell: ["Confirmed liquidity before entry"],
          wentWrong: [],
          lessons: ["Keep requiring a sell-back check before any buy"],
        }),
      ); // re-read after save
    const deps = {
      readResult: vi.fn().mockResolvedValue(finalizedResult()),
      readExisting,
      readMoves: vi.fn().mockResolvedValue([move()]),
      save: vi.fn().mockResolvedValue(undefined),
      clientFactory: () => client,
    };
    const dto = await getOrGenerateRetrospective(SESSION, CID, deps);
    expect(client.chat.send).toHaveBeenCalledTimes(1);
    expect(deps.save).toHaveBeenCalledTimes(1);
    expect(deps.save.mock.calls[0]?.[0]).toMatchObject({
      missionRunId: RUN,
      sessionId: SESSION,
      model: "test-model",
    });
    expect(dto?.summary).toBe("Bought VENA on momentum and exited at target.");
    expect(dto?.lessons[0]).toContain("sell-back check");
    expect(dto?.model).toBe("test-model");
  });

  it("returns null (fail-soft) on a malformed model reply and does not persist", async () => {
    const client = fakeClient("the model refused to answer");
    const deps = {
      readResult: vi.fn().mockResolvedValue(finalizedResult()),
      readExisting: vi.fn().mockResolvedValue(null),
      readMoves: vi.fn().mockResolvedValue([move()]),
      save: vi.fn(),
      clientFactory: () => client,
    };
    expect(await getOrGenerateRetrospective(SESSION, CID, deps)).toBeNull();
    expect(deps.save).not.toHaveBeenCalled();
  });

  it("still returns the generated retrospective when persistence fails", async () => {
    const content = JSON.stringify({
      summary: "ok",
      wentWell: [],
      wentWrong: [],
      lessons: [],
    });
    const client = fakeClient(content);
    const deps = {
      readResult: vi.fn().mockResolvedValue(finalizedResult()),
      readExisting: vi.fn().mockResolvedValue(null),
      readMoves: vi.fn().mockResolvedValue([move()]),
      save: vi.fn().mockRejectedValue(new Error("db down")),
      clientFactory: () => client,
    };
    const dto = await getOrGenerateRetrospective(SESSION, CID, deps);
    expect(dto?.summary).toBe("ok");
    expect(dto?.model).toBe("test-model");
  });
});
