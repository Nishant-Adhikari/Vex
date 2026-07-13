/**
 * exit-watch wiring tests — SHADOW/ALERT providers + supervisor lifecycle.
 *
 * Spot positions are re-derived from `proj_balances` (holdings + live price)
 * and `proj_activity` (BUY legs → cost basis + open time), NOT the empty
 * `proj_open_positions` table. These tests inject `loadActiveRun` /
 * `loadHeldBalances` / `loadInWindowBuys` seams (no DB) and assert the pure
 * helpers, mission scoping (in-window buy kept, legacy bag dropped), averaged
 * cost basis, price sourcing, and supervisor lifecycle.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import type { WatchAlert } from "@vex-agent/engine/exit/watch-cycle.js";
import type {
  ActiveMissionRun,
  BalanceRow,
  BuyRow,
} from "../exit-watch-wiring.js";

vi.mock("../../logger/index.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../ipc/runtime/_ensure-engine-db-url.js", () => ({
  ensureEngineDbUrl: vi.fn(),
}));

const {
  heldAmount,
  buyValueUsd,
  costBasisFromBuys,
  formatExitAlert,
  resolveExitEngineMode,
  DEFAULT_EXIT_CONFIG,
  createExitWatchDeps,
  setupExitWatchWorker,
} = await import("../exit-watch-wiring.js");

// ── Fixtures ────────────────────────────────────────────────────

const RUN_START = Date.parse("2026-07-13T09:00:00.000Z");

const RUN: ActiveMissionRun = {
  runId: "run-1",
  missionId: "mission-1",
  startedAtMs: RUN_START,
  wallets: ["WALLET_A"],
};

function bal(overrides: Partial<BalanceRow> = {}): BalanceRow {
  return {
    tokenAddress: "TOKEN_A",
    tokenSymbol: "AAA",
    balanceRaw: "1000000000", // 1000 * 1e6
    priceUsd: 3,
    decimals: 6,
    ...overrides,
  };
}

function buy(overrides: Partial<BuyRow> = {}): BuyRow {
  return {
    outputToken: "TOKEN_A",
    outputAmount: "1000",
    outputValueUsd: 1000, // → unit cost 1.0
    unitPriceUsd: 1,
    valueUsd: 1000,
    createdAtMs: Date.parse("2026-07-13T10:00:00.000Z"),
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

describe("heldAmount", () => {
  it("scales raw balance by decimals", () => {
    expect(heldAmount("1000000000", 6)).toBe(1000);
    expect(heldAmount("5", 0)).toBe(5);
  });
  it("returns null for non-positive / missing / invalid inputs", () => {
    expect(heldAmount("0", 6)).toBeNull();
    expect(heldAmount("-1", 6)).toBeNull();
    expect(heldAmount("abc", 6)).toBeNull();
    expect(heldAmount("1000", null)).toBeNull();
    expect(heldAmount("1000", -1)).toBeNull();
  });
});

describe("buyValueUsd", () => {
  it("prefers output_value_usd", () => {
    expect(buyValueUsd(buy({ outputValueUsd: 500 }), 1000)).toBe(500);
  });
  it("falls back to unit_price_usd * amount when output_value_usd is null", () => {
    expect(buyValueUsd(buy({ outputValueUsd: null, unitPriceUsd: 2 }), 100)).toBe(200);
  });
  it("falls back to value_usd when output_value_usd and unit_price_usd are null", () => {
    expect(
      buyValueUsd(buy({ outputValueUsd: null, unitPriceUsd: null, valueUsd: 42 }), 100),
    ).toBe(42);
  });
  it("returns null when nothing is usable", () => {
    expect(
      buyValueUsd(buy({ outputValueUsd: null, unitPriceUsd: null, valueUsd: null }), 100),
    ).toBeNull();
  });
});

describe("costBasisFromBuys", () => {
  it("averages Σ(value) / Σ(amount) across multiple buys and takes the first open time", () => {
    const basis = costBasisFromBuys([
      buy({ outputAmount: "100", outputValueUsd: 100, createdAtMs: Date.parse("2026-07-13T11:00:00.000Z") }),
      buy({ outputAmount: "300", outputValueUsd: 900, createdAtMs: Date.parse("2026-07-13T10:00:00.000Z") }),
    ]);
    // (100 + 900) / (100 + 300) = 2.5
    expect(basis?.entryPriceUsd).toBe(2.5);
    expect(basis?.openedAtMs).toBe(Date.parse("2026-07-13T10:00:00.000Z"));
  });
  it("uses the unit_price fallback per leg", () => {
    const basis = costBasisFromBuys([
      buy({ outputAmount: "100", outputValueUsd: null, unitPriceUsd: 4, valueUsd: null }),
    ]);
    expect(basis?.entryPriceUsd).toBe(4);
  });
  it("returns null when no leg is usable", () => {
    expect(costBasisFromBuys([])).toBeNull();
    expect(costBasisFromBuys([buy({ outputAmount: "0" })])).toBeNull();
    expect(
      costBasisFromBuys([
        buy({ outputAmount: "100", outputValueUsd: null, unitPriceUsd: null, valueUsd: null }),
      ]),
    ).toBeNull();
  });
});

describe("formatExitAlert", () => {
  it("renders decisions with kind, rung and sell fraction", () => {
    const alert: WatchAlert = {
      token: "TOKEN_A",
      updatedPeakPriceUsd: 3,
      currentPriceUsd: 2,
      decisions: [
        { kind: "take_profit", sellFraction: 0.5, rungIndex: 1, reason: "r" },
        { kind: "stop_loss", sellFraction: 1, reason: "s" },
      ],
    };
    const line = formatExitAlert(alert);
    expect(line).toContain("token=TOKEN_A");
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

describe("createExitWatchDeps.getOpenPositions (spot sourcing)", () => {
  it("returns [] and loads nothing when no mission is active", async () => {
    const loadHeldBalances = vi.fn(async () => [bal()]);
    const loadInWindowBuys = vi.fn(async () => [buy()]);
    const deps = createExitWatchDeps({
      loadActiveRun: async () => null,
      loadHeldBalances,
      loadInWindowBuys,
    });
    expect(await deps.getOpenPositions()).toEqual([]);
    expect(loadHeldBalances).not.toHaveBeenCalled();
    expect(loadInWindowBuys).not.toHaveBeenCalled();
  });

  it("returns [] when the mission declares no wallets", async () => {
    const loadHeldBalances = vi.fn(async () => [bal()]);
    const deps = createExitWatchDeps({
      loadActiveRun: async () => ({ ...RUN, wallets: [] }),
      loadHeldBalances,
      loadInWindowBuys: async () => [buy()],
    });
    expect(await deps.getOpenPositions()).toEqual([]);
    expect(loadHeldBalances).not.toHaveBeenCalled();
  });

  it("keeps a held token bought DURING the run with a correct entryPriceUsd + amount + price", async () => {
    const deps = createExitWatchDeps({
      loadActiveRun: async () => RUN,
      loadHeldBalances: async () => [
        bal({ tokenAddress: "TOKEN_A", balanceRaw: "1000000000", decimals: 6, priceUsd: 3 }),
      ],
      loadInWindowBuys: async () => [
        buy({ outputToken: "TOKEN_A", outputAmount: "1000", outputValueUsd: 1000 }),
      ],
    });
    const inputs = await deps.getOpenPositions();
    expect(inputs).toHaveLength(1);
    const pos = inputs[0]!;
    expect(pos.token).toBe("TOKEN_A");
    expect(pos.entryPriceUsd).toBe(1); // 1000 usd / 1000 tokens
    expect(pos.amountTokens).toBe(1000); // 1e9 / 1e6
    expect(pos.openedAtMs).toBe(Date.parse("2026-07-13T10:00:00.000Z"));
    expect(pos.priorPeakPriceUsd).toBe(1); // defaults to entry
    // priceOf sources the LIVE proj_balances price, keyed by token address.
    expect(deps.priceOf("TOKEN_A")).toBe(3);
    expect(deps.priceOf("MISSING")).toBeNull();
  });

  it("drops a legacy bag: held but with NO in-window buy", async () => {
    const deps = createExitWatchDeps({
      loadActiveRun: async () => RUN,
      loadHeldBalances: async () => [
        bal({ tokenAddress: "LEGACY", balanceRaw: "5000000000", decimals: 6, priceUsd: 9 }),
        bal({ tokenAddress: "FRESH", balanceRaw: "1000000000", decimals: 6, priceUsd: 3 }),
      ],
      // only FRESH was bought during the run window
      loadInWindowBuys: async () => [
        buy({ outputToken: "FRESH", outputAmount: "1000", outputValueUsd: 1000 }),
      ],
    });
    const inputs = await deps.getOpenPositions();
    expect(inputs.map((i) => i.token)).toEqual(["FRESH"]);
    // legacy token is not priced either
    expect(deps.priceOf("LEGACY")).toBeNull();
  });

  it("passes the mission wallets and run-start to the loaders", async () => {
    const loadHeldBalances = vi.fn(async () => [bal()]);
    const loadInWindowBuys = vi.fn(async () => [buy()]);
    const deps = createExitWatchDeps({
      loadActiveRun: async () => RUN,
      loadHeldBalances,
      loadInWindowBuys,
    });
    await deps.getOpenPositions();
    expect(loadHeldBalances).toHaveBeenCalledWith(["WALLET_A"]);
    expect(loadInWindowBuys).toHaveBeenCalledWith(["WALLET_A"], RUN_START);
  });

  it("averages cost basis across multiple in-window buys of the same token", async () => {
    const deps = createExitWatchDeps({
      loadActiveRun: async () => RUN,
      loadHeldBalances: async () => [
        bal({ tokenAddress: "TOKEN_A", balanceRaw: "400000000", decimals: 6, priceUsd: 5 }),
      ],
      loadInWindowBuys: async () => [
        buy({ outputToken: "TOKEN_A", outputAmount: "100", outputValueUsd: 100 }),
        buy({ outputToken: "TOKEN_A", outputAmount: "300", outputValueUsd: 900 }),
      ],
    });
    const inputs = await deps.getOpenPositions();
    expect(inputs).toHaveLength(1);
    expect(inputs[0]!.entryPriceUsd).toBe(2.5); // (100+900)/(100+300)
  });

  it("drops a position with an unusable cost basis or zero amount", async () => {
    const deps = createExitWatchDeps({
      loadActiveRun: async () => RUN,
      loadHeldBalances: async () => [
        bal({ tokenAddress: "TOKEN_A", balanceRaw: "0", decimals: 6 }), // zero held
      ],
      loadInWindowBuys: async () => [buy({ outputToken: "TOKEN_A" })],
    });
    expect(await deps.getOpenPositions()).toEqual([]);
  });

  it("fails soft to [] when a loader throws", async () => {
    const deps = createExitWatchDeps({
      loadActiveRun: async () => RUN,
      loadHeldBalances: async () => {
        throw new Error("db down");
      },
      loadInWindowBuys: async () => [buy()],
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
