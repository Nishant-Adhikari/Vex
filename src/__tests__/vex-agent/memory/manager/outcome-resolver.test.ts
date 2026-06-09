/**
 * Outcome resolver unit tests — venue dispatch (spot / position / lp / thin) with
 * INJECTED ledger reads (no DB), plus the lessonSignal + evidenceQuality + status
 * + pnlSource mapping. Proves the resolver reads FACTS (realized PnL), not the
 * agent's declaration, and that thin/uncovered venues degrade honestly.
 */

import { describe, it, expect } from "vitest";

import { resolveOutcome, type OutcomeResolverDeps } from "@vex-agent/memory/manager/outcome-resolver.js";
import type { Activity } from "@vex-agent/db/repos/activity.js";
import type { ExecutionRecord } from "@vex-agent/db/repos/executions.js";
import type { Lot } from "@vex-agent/db/repos/pnl-lots.js";
import type { PnlMatch } from "@vex-agent/db/repos/pnl-matches.js";
import type { Position } from "@vex-agent/db/repos/open-positions.js";
import type { LpEvent } from "@vex-agent/db/repos/lp-events.js";
import { makeCandidate } from "./_fixtures.js";

// ── Minimal typed ledger-row builders ───────────────────────────────

function execRow(over: Partial<ExecutionRecord> = {}): ExecutionRecord {
  return {
    id: 5,
    toolId: "swap.buy",
    namespace: "jupiter",
    sessionId: "sess-1",
    success: true,
    tradeCapture: null,
    externalRefs: {},
    durationMs: 10,
    createdAt: "2026-06-01T00:00:00.000Z",
    ...over,
  };
}

function activityRow(over: Partial<Activity> = {}): Activity {
  return {
    id: 1,
    namespace: "jupiter",
    activityType: "swap",
    productType: "spot",
    tradeSide: null,
    chain: "solana",
    executionId: 5,
    captureItemId: null,
    walletAddress: "WALLET",
    inputToken: null,
    inputAmount: null,
    outputToken: null,
    outputAmount: null,
    valueUsd: null,
    inputValueUsd: null,
    outputValueUsd: null,
    feeValueUsd: null,
    unitPriceUsd: null,
    valuationSource: null,
    benchmarkAssetKey: null,
    settlementAssetKey: null,
    inputValueNative: null,
    outputValueNative: null,
    captureStatus: null,
    positionKey: null,
    instrumentKey: "BONK",
    externalRefs: {},
    meta: {},
    createdAt: "2026-06-01T00:00:00.000Z",
    ...over,
  };
}

function matchRow(realizedPnlUsd: string | null, over: Partial<PnlMatch> = {}): PnlMatch {
  return {
    id: 1,
    matchKind: "matched",
    sellActivityId: 1,
    lotId: 1,
    instrumentKey: "BONK",
    walletAddress: "WALLET",
    quantityMatched: "100",
    costBasisUsd: "10",
    proceedsUsd: "20",
    realizedPnlUsd,
    costBasisNative: null,
    proceedsNative: null,
    realizedPnlNative: null,
    benchmarkAssetKey: null,
    namespace: "jupiter",
    chain: "solana",
    matchedAt: "2026-06-02T00:00:00.000Z",
    ...over,
  };
}

function lotRow(over: Partial<Lot> = {}): Lot {
  return {
    id: 1,
    instrumentKey: "BONK",
    walletAddress: "WALLET",
    side: "buy",
    quantityRaw: "100",
    costBasisUsd: "10",
    priceUsd: "0.1",
    costBasisNative: null,
    benchmarkAssetKey: null,
    remainingQuantityRaw: "100",
    executionId: 5,
    activityId: 1,
    namespace: "jupiter",
    chain: "solana",
    status: "open",
    openedAt: "2026-06-01T00:00:00.000Z",
    closedAt: null,
    ...over,
  };
}

function positionRow(over: Partial<Position> = {}): Position {
  return {
    id: 1,
    namespace: "hyperliquid",
    positionType: "perps",
    chain: "hyperliquid",
    externalId: "POS-1",
    walletAddress: "WALLET",
    instrumentKey: "BTC-PERP",
    positionKey: "POSKEY",
    entryPriceUsd: "60000",
    currentValueUsd: "61000",
    unrealizedPnlUsd: "100",
    notionalUsd: "1000",
    feeUsd: "1",
    contracts: "1",
    settlementAssetKey: "USDC",
    data: {},
    status: "open",
    openedAt: "2026-06-01T00:00:00.000Z",
    closedAt: null,
    ...over,
  };
}

function lpEventRow(over: Partial<LpEvent> = {}): LpEvent {
  return {
    id: 1,
    executionId: 5,
    captureItemId: null,
    namespace: "orca",
    chain: "solana",
    action: "deposit",
    dex: "orca",
    pool: "POOL",
    positionKey: "LPKEY",
    instrumentKey: "SOL-USDC",
    walletAddress: "WALLET",
    totalValueUsd: "100",
    feeCollectedUsd: null,
    valuationSource: null,
    createdAt: "2026-06-01T00:00:00.000Z",
    ...over,
  };
}

/** Default deps: every read empty; override per case. */
function deps(over: Partial<OutcomeResolverDeps> = {}): OutcomeResolverDeps {
  return {
    getExecutionById: async () => execRow(),
    getActivitiesByExecution: async () => [],
    getMatchesBySell: async () => [],
    getOpenLots: async () => [],
    getPositionByKey: async () => null,
    getLpEventsByPosition: async () => [],
    ...over,
  };
}

const PIT = true;

describe("resolveOutcome — anchor existence", () => {
  it("returns null when no anchor execution survives", async () => {
    const out = await resolveOutcome(makeCandidate(), PIT, deps({ getExecutionById: async () => null }));
    expect(out).toBeNull();
  });

  it("carries the supplied pointInTimeChecked, outcomeVersion 0 and computedBy memory_manager", async () => {
    const out = await resolveOutcome(
      makeCandidate(),
      false,
      deps({ getActivitiesByExecution: async () => [activityRow()] }),
    );
    expect(out).not.toBeNull();
    expect(out?.pointInTimeChecked).toBe(false);
    expect(out?.outcomeVersion).toBe(0);
    expect(out?.outcomeComputedBy).toBe("memory_manager");
  });
});

describe("resolveOutcome — spot venue (realized PnL via proj_pnl_matches)", () => {
  it("closed + positive + strong from a profitable realized match (FACTS, not declaration)", async () => {
    const out = await resolveOutcome(
      makeCandidate(),
      PIT,
      deps({
        getActivitiesByExecution: async () => [activityRow({ tradeSide: "sell" })],
        getMatchesBySell: async () => [matchRow("12.50")],
      }),
    );
    expect(out?.status).toBe("closed");
    expect(out?.lessonSignal).toBe("positive");
    expect(out?.evidenceQuality).toBe("strong");
    expect(out?.pnlSource).toBe("pnl_matches");
    expect(out?.productType).toBe("spot");
    expect(out?.needsReconciliation).toBe(false);
  });

  it("closed + negative from a losing realized match", async () => {
    const out = await resolveOutcome(
      makeCandidate(),
      PIT,
      deps({
        getActivitiesByExecution: async () => [activityRow({ tradeSide: "sell" })],
        getMatchesBySell: async () => [matchRow("-8")],
      }),
    );
    expect(out?.status).toBe("closed");
    expect(out?.lessonSignal).toBe("negative");
    expect(out?.evidenceQuality).toBe("strong");
  });

  it("open + weak when a buy has an open lot but no realized sell (open exposure)", async () => {
    const out = await resolveOutcome(
      makeCandidate(),
      PIT,
      deps({
        getActivitiesByExecution: async () => [activityRow({ tradeSide: "buy" })],
        getOpenLots: async () => [lotRow()],
      }),
    );
    expect(out?.status).toBe("open");
    expect(out?.lessonSignal).toBe("neutral");
    expect(out?.evidenceQuality).toBe("weak");
    expect(out?.pnlSource).toBe("open_position");
    expect(out?.needsReconciliation).toBe(true);
  });

  it("ignores a shortfall match with null realized PnL (no false realized result)", async () => {
    const out = await resolveOutcome(
      makeCandidate(),
      PIT,
      deps({
        getActivitiesByExecution: async () => [activityRow({ tradeSide: "sell" })],
        getMatchesBySell: async () => [matchRow(null, { matchKind: "shortfall", lotId: null })],
      }),
    );
    expect(out?.evidenceQuality).toBe("weak");
    expect(out?.pnlSource).toBe("none");
  });
});

describe("resolveOutcome — position venue (perps/prediction/order)", () => {
  it("open + weak for an open perps position (unrealized current state)", async () => {
    const out = await resolveOutcome(
      makeCandidate(),
      PIT,
      deps({
        getActivitiesByExecution: async () => [
          activityRow({ productType: "perps", positionKey: "POSKEY" }),
        ],
        getPositionByKey: async () => positionRow({ status: "open" }),
      }),
    );
    expect(out?.status).toBe("open");
    expect(out?.evidenceQuality).toBe("weak");
    expect(out?.productType).toBe("perps");
    expect(out?.needsReconciliation).toBe(true);
  });

  it("closed + medium (never strong) for a closed position — no clean FIFO realized", async () => {
    const out = await resolveOutcome(
      makeCandidate(),
      PIT,
      deps({
        getActivitiesByExecution: async () => [
          activityRow({ productType: "perps", positionKey: "POSKEY" }),
        ],
        getPositionByKey: async () =>
          positionRow({ status: "closed", unrealizedPnlUsd: "250", closedAt: "2026-06-03T00:00:00.000Z" }),
      }),
    );
    expect(out?.status).toBe("closed");
    expect(out?.evidenceQuality).toBe("medium");
    expect(out?.lessonSignal).toBe("positive");
    expect(out?.needsReconciliation).toBe(true);
  });

  it("thin fallback when the position row is gone", async () => {
    const out = await resolveOutcome(
      makeCandidate(),
      PIT,
      deps({
        getActivitiesByExecution: async () => [
          activityRow({ productType: "order", positionKey: "POSKEY" }),
        ],
        getPositionByKey: async () => null,
      }),
    );
    expect(out?.evidenceQuality).toBe("weak");
    expect(out?.pnlSource).toBe("none");
  });
});

describe("resolveOutcome — lp venue", () => {
  it("closed + medium with a positive fee signal when a withdraw event exists", async () => {
    const out = await resolveOutcome(
      makeCandidate(),
      PIT,
      deps({
        getActivitiesByExecution: async () => [
          activityRow({ productType: "lp", positionKey: "LPKEY" }),
        ],
        getLpEventsByPosition: async () => [
          lpEventRow({ action: "deposit" }),
          lpEventRow({ action: "withdraw", feeCollectedUsd: "3.5" }),
        ],
      }),
    );
    expect(out?.status).toBe("closed");
    expect(out?.evidenceQuality).toBe("medium");
    expect(out?.lessonSignal).toBe("positive");
    expect(out?.pnlSource).toBe("lp_events");
    expect(out?.productType).toBe("lp");
  });

  it("thin fallback when no LP events exist", async () => {
    const out = await resolveOutcome(
      makeCandidate(),
      PIT,
      deps({
        getActivitiesByExecution: async () => [
          activityRow({ productType: "lp", positionKey: "LPKEY" }),
        ],
        getLpEventsByPosition: async () => [],
      }),
    );
    expect(out?.evidenceQuality).toBe("weak");
    expect(out?.pnlSource).toBe("none");
  });
});

describe("resolveOutcome — thin / uncovered venue", () => {
  it("honest neutral+weak+needsReconciliation for an unmapped product type", async () => {
    const out = await resolveOutcome(
      makeCandidate(),
      PIT,
      deps({ getActivitiesByExecution: async () => [activityRow({ productType: "bridge" })] }),
    );
    expect(out?.status).toBe("open");
    expect(out?.lessonSignal).toBe("neutral");
    expect(out?.evidenceQuality).toBe("weak");
    expect(out?.pnlSource).toBe("none");
    expect(out?.needsReconciliation).toBe(true);
    // bridge IS in the outcome product vocabulary, so productType is carried.
    expect(out?.productType).toBe("bridge");
  });

  it("omits productType when the execution has no activity row", async () => {
    const out = await resolveOutcome(
      makeCandidate(),
      PIT,
      deps({ getActivitiesByExecution: async () => [] }),
    );
    expect(out?.productType).toBeUndefined();
    expect(out?.evidenceQuality).toBe("weak");
  });
});
