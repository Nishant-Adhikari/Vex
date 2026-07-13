/**
 * exit-watch wiring tests — SHADOW/ALERT providers + supervisor lifecycle.
 *
 * Pure helpers (token identity, implied price, run-window scoping, row mapping,
 * alert formatting) are asserted directly. The deps factory is exercised with
 * injected `loadActiveRun` / `loadOpenPositions` seams (no DB). The supervisor
 * lifecycle mirrors the other worker supervisors: no start until the DB url
 * resolves, start EXACTLY ONCE, idempotent teardown.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Position as OpenPosition } from "@vex-agent/db/repos/open-positions.js";
import type { WatchAlert } from "@vex-agent/engine/exit/watch-cycle.js";
import type { ActiveMissionRun } from "../exit-watch-wiring.js";

vi.mock("../../logger/index.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../ipc/runtime/_ensure-engine-db-url.js", () => ({
  ensureEngineDbUrl: vi.fn(),
}));

const {
  positionToken,
  impliedPriceUsd,
  isWithinRunWindow,
  toWatchInputPosition,
  formatExitAlert,
  resolveExitEngineMode,
  DEFAULT_EXIT_CONFIG,
  createExitWatchDeps,
  setupExitWatchWorker,
} = await import("../exit-watch-wiring.js");

// ── Fixtures ────────────────────────────────────────────────────

function makePos(overrides: Partial<OpenPosition> = {}): OpenPosition {
  return {
    id: 1,
    namespace: "default",
    positionType: "spot",
    chain: "solana",
    externalId: null,
    walletAddress: "WALLET_A",
    instrumentKey: "TOKEN_MINT_A",
    positionKey: null,
    entryPriceUsd: "1",
    currentValueUsd: "200",
    unrealizedPnlUsd: null,
    notionalUsd: "100",
    feeUsd: null,
    contracts: "100",
    settlementAssetKey: null,
    data: {},
    status: "open",
    openedAt: "2026-07-13T10:00:00.000Z",
    closedAt: null,
    ...overrides,
  };
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 15));
}

afterEach(() => {
  vi.clearAllMocks();
  delete process.env.VEX_EXIT_ENGINE_MODE;
});

// ── Pure helpers ────────────────────────────────────────────────

describe("positionToken", () => {
  it("prefers instrumentKey, then positionKey, then externalId, then row id", () => {
    expect(positionToken(makePos({ instrumentKey: "IK" }))).toBe("IK");
    expect(positionToken(makePos({ instrumentKey: null, positionKey: "PK" }))).toBe("PK");
    expect(
      positionToken(makePos({ instrumentKey: null, positionKey: null, externalId: "EX" })),
    ).toBe("EX");
    expect(
      positionToken(
        makePos({ id: 42, instrumentKey: "  ", positionKey: null, externalId: null }),
      ),
    ).toBe("pos:42");
  });
});

describe("impliedPriceUsd", () => {
  it("is current_value_usd / contracts", () => {
    expect(impliedPriceUsd(makePos({ currentValueUsd: "200", contracts: "100" }))).toBe(2);
  });
  it("returns null on missing / zero / non-finite inputs", () => {
    expect(impliedPriceUsd(makePos({ currentValueUsd: null }))).toBeNull();
    expect(impliedPriceUsd(makePos({ contracts: null }))).toBeNull();
    expect(impliedPriceUsd(makePos({ contracts: "0" }))).toBeNull();
    expect(impliedPriceUsd(makePos({ currentValueUsd: "abc" }))).toBeNull();
    expect(impliedPriceUsd(makePos({ currentValueUsd: "-5" }))).toBeNull();
  });
});

describe("isWithinRunWindow (mission-scoping)", () => {
  const runStart = Date.parse("2026-07-13T09:00:00.000Z");
  it("keeps positions opened at/after the run start", () => {
    expect(isWithinRunWindow("2026-07-13T09:00:00.000Z", runStart)).toBe(true);
    expect(isWithinRunWindow("2026-07-13T12:00:00.000Z", runStart)).toBe(true);
  });
  it("excludes legacy bags opened before the run start", () => {
    expect(isWithinRunWindow("2026-07-13T08:59:59.000Z", runStart)).toBe(false);
    expect(isWithinRunWindow("2020-01-01T00:00:00.000Z", runStart)).toBe(false);
  });
  it("excludes positions with missing / unparseable opened_at", () => {
    expect(isWithinRunWindow(null, runStart)).toBe(false);
    expect(isWithinRunWindow("not-a-date", runStart)).toBe(false);
  });
});

describe("toWatchInputPosition", () => {
  it("maps a healthy row and defaults the peak to entry when unseen", () => {
    const input = toWatchInputPosition(makePos(), undefined);
    expect(input).toEqual({
      token: "TOKEN_MINT_A",
      entryPriceUsd: 1,
      amountTokens: 100,
      openedAtMs: Date.parse("2026-07-13T10:00:00.000Z"),
      consumedRungs: [],
      priorPeakPriceUsd: 1,
    });
  });
  it("carries a prior peak that is >= entry", () => {
    expect(toWatchInputPosition(makePos(), 5)?.priorPeakPriceUsd).toBe(5);
  });
  it("never lets the carried peak sit below entry", () => {
    expect(toWatchInputPosition(makePos({ entryPriceUsd: "2" }), 1)?.priorPeakPriceUsd).toBe(2);
  });
  it("skips rows with a non-finite / non-positive entry price", () => {
    expect(toWatchInputPosition(makePos({ entryPriceUsd: null }), undefined)).toBeNull();
    expect(toWatchInputPosition(makePos({ entryPriceUsd: "0" }), undefined)).toBeNull();
    expect(toWatchInputPosition(makePos({ entryPriceUsd: "-1" }), undefined)).toBeNull();
  });
});

describe("formatExitAlert", () => {
  it("renders decisions with kind, rung and sell fraction", () => {
    const alert: WatchAlert = {
      token: "TOKEN_MINT_A",
      updatedPeakPriceUsd: 3,
      currentPriceUsd: 2,
      decisions: [
        { kind: "take_profit", sellFraction: 0.5, rungIndex: 1, reason: "r" },
        { kind: "stop_loss", sellFraction: 1, reason: "s" },
      ],
    };
    const line = formatExitAlert(alert);
    expect(line).toContain("token=TOKEN_MINT_A");
    expect(line).toContain("take_profit rung1 sell 50%");
    expect(line).toContain("stop_loss sell 100%");
  });
  it("shows the diagnostic note when no decisions fired", () => {
    const line = formatExitAlert({
      token: "T",
      updatedPeakPriceUsd: 1,
      currentPriceUsd: null,
      decisions: [],
      note: "price_unavailable",
    });
    expect(line).toContain("price=n/a");
    expect(line).toContain("decisions=[price_unavailable]");
  });
});

describe("resolveExitEngineMode (defaults to alert)", () => {
  it("defaults to alert when unset", () => {
    expect(resolveExitEngineMode()).toBe("alert");
  });
  it("is alert for any non-execute value", () => {
    process.env.VEX_EXIT_ENGINE_MODE = "banana";
    expect(resolveExitEngineMode()).toBe("alert");
  });
  it("is execute only for an explicit (case-insensitive) execute", () => {
    process.env.VEX_EXIT_ENGINE_MODE = "EXECUTE";
    expect(resolveExitEngineMode()).toBe("execute");
  });
});

describe("DEFAULT_EXIT_CONFIG", () => {
  it("matches the specified ladder + stops", () => {
    expect(DEFAULT_EXIT_CONFIG).toEqual({
      takeProfitLadder: [
        { multiple: 2, sellFraction: 0.5 },
        { multiple: 3, sellFraction: 0.5 },
      ],
      stopLossPct: 0.35,
      trailingStopPct: 0.25,
      timeStopMinutes: 90,
      timeStopFlatBandPct: 0.15,
    });
  });
});

// ── Deps: getOpenPositions / priceOf ────────────────────────────

const RUN: ActiveMissionRun = {
  runId: "run-1",
  missionId: "mission-1",
  startedAtMs: Date.parse("2026-07-13T09:00:00.000Z"),
  wallets: ["WALLET_A"],
};

describe("createExitWatchDeps.getOpenPositions", () => {
  it("returns [] and asks for nothing when no mission is active", async () => {
    const loadOpenPositions = vi.fn(async () => [makePos()]);
    const deps = createExitWatchDeps({
      loadActiveRun: async () => null,
      loadOpenPositions,
    });
    expect(await deps.getOpenPositions()).toEqual([]);
    expect(loadOpenPositions).not.toHaveBeenCalled();
  });

  it("passes the mission wallets to the loader and excludes legacy bags", async () => {
    const loadOpenPositions = vi.fn(async () => [
      makePos({ id: 1, instrumentKey: "IN", openedAt: "2026-07-13T10:00:00.000Z" }),
      makePos({ id: 2, instrumentKey: "LEGACY", openedAt: "2026-07-01T00:00:00.000Z" }),
    ]);
    const deps = createExitWatchDeps({ loadActiveRun: async () => RUN, loadOpenPositions });
    const inputs = await deps.getOpenPositions();
    expect(loadOpenPositions).toHaveBeenCalledWith(["WALLET_A"]);
    expect(inputs.map((i) => i.token)).toEqual(["IN"]);
  });

  it("falls back to a global read (undefined wallets) when the mission has none", async () => {
    const loadOpenPositions = vi.fn(async () => [makePos()]);
    const deps = createExitWatchDeps({
      loadActiveRun: async () => ({ ...RUN, wallets: [] }),
      loadOpenPositions,
    });
    await deps.getOpenPositions();
    expect(loadOpenPositions).toHaveBeenCalledWith(undefined);
  });

  it("skips rows with a bad entry price", async () => {
    const deps = createExitWatchDeps({
      loadActiveRun: async () => RUN,
      loadOpenPositions: async () => [makePos({ entryPriceUsd: null })],
    });
    expect(await deps.getOpenPositions()).toEqual([]);
  });

  it("exposes a consistent implied price via priceOf for the same snapshot", async () => {
    const deps = createExitWatchDeps({
      loadActiveRun: async () => RUN,
      loadOpenPositions: async () => [
        makePos({ instrumentKey: "IN", currentValueUsd: "300", contracts: "100" }),
      ],
    });
    await deps.getOpenPositions();
    expect(deps.priceOf("IN")).toBe(3);
    expect(deps.priceOf("MISSING")).toBeNull();
  });

  it("fails soft to [] when the loader throws", async () => {
    const deps = createExitWatchDeps({
      loadActiveRun: async () => RUN,
      loadOpenPositions: async () => {
        throw new Error("db down");
      },
    });
    expect(await deps.getOpenPositions()).toEqual([]);
  });
});

// ── Supervisor lifecycle ────────────────────────────────────────

describe("setupExitWatchWorker supervisor", () => {
  it("does not start the worker while the DB url is unavailable", async () => {
    const startWorker = vi.fn(() => vi.fn(async () => {}));
    const stop = setupExitWatchWorker({
      ensureDbUrl: vi.fn(async () => ({ ok: false })),
      startWorker,
      intervalMs: 20,
    });
    await flush();
    expect(startWorker).not.toHaveBeenCalled();
    await stop();
  });

  it("starts the worker exactly once and tears it down on stop", async () => {
    const teardown = vi.fn(async () => {});
    const startWorker = vi.fn(() => teardown);
    const stop = setupExitWatchWorker({
      ensureDbUrl: vi.fn(async () => ({ ok: true })),
      startWorker,
      intervalMs: 20,
    });
    await flush();
    await flush();
    expect(startWorker).toHaveBeenCalledTimes(1);
    await stop();
    expect(teardown).toHaveBeenCalledTimes(1);
  });

  it("stop() is idempotent", async () => {
    const teardown = vi.fn(async () => {});
    const stop = setupExitWatchWorker({
      ensureDbUrl: vi.fn(async () => ({ ok: true })),
      startWorker: () => teardown,
      intervalMs: 20,
    });
    await flush();
    await stop();
    await stop();
    expect(teardown).toHaveBeenCalledTimes(1);
  });
});
