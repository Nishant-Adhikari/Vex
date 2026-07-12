import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Result } from "@shared/ipc/result.js";
import type { HyperliquidPositionsDto } from "@shared/schemas/hyperliquid.js";

vi.mock("../../lifecycle/broadcast.js", () => ({ broadcastToAllWindows: vi.fn() }));
vi.mock("../../logger/index.js", () => ({
  log: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { setupHyperliquidPositionsService } = await import("../hyperliquid-positions-service.js");

const SESSION = "00000000-0000-4000-8000-000000000001";
const ISO = "2026-07-11T12:00:00.000Z";

function snapshot(): HyperliquidPositionsDto {
  return {
    sessionId: SESSION,
    updatedAt: ISO,
    account: { equityUsd: "1000", withdrawableUsd: "800", totalUnrealizedPnlUsd: "5" },
    watchlist: [{ coin: "BTC", midPx: "100000", change24hPct: "1", openInterestUsd: "100000000" }],
    positions: [{
      coin: "BTC",
      side: "long",
      size: "0.01",
      entryPx: "100000",
      markPx: "100000",
      leverage: "3",
      marginMode: "isolated",
      liquidationPx: "75000",
      unrealizedPnl: "0",
      fundingAccrued: "0",
      slPrice: "98000",
      tpPrice: null,
      protectionState: "PROTECTED",
      confirmedAt: ISO,
      updatedAt: ISO,
    }],
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("setupHyperliquidPositionsService", () => {
  it("does not poll Hyperliquid while there is no open position or order exposure", async () => {
    const allMids = vi.fn<() => Promise<unknown>>().mockResolvedValue({ BTC: "100100" });
    const stop = setupHyperliquidPositionsService({
      hasExposure: async () => false,
      listSessionIds: async () => [SESSION],
      getPositions: async (): Promise<Result<HyperliquidPositionsDto>> => ({ ok: true, data: snapshot() }),
      allMids,
      publish: vi.fn(),
      intervalMs: 10_000,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(allMids).not.toHaveBeenCalled();
    await stop();
  });

  it("publishes a main-owned mark overlay and drains cleanly on stop", async () => {
    const publish = vi.fn();
    const stop = setupHyperliquidPositionsService({
      hasExposure: async () => true,
      listSessionIds: async () => [SESSION],
      getPositions: async (): Promise<Result<HyperliquidPositionsDto>> => ({ ok: true, data: snapshot() }),
      allMids: async () => ({ BTC: "100100" }),
      publish,
      now: () => new Date(ISO),
      intervalMs: 10_000,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: SESSION,
      account: { equityUsd: "1000", withdrawableUsd: "800", totalUnrealizedPnlUsd: "5" },
      watchlist: [{ coin: "BTC", midPx: "100100", change24hPct: "1", openInterestUsd: "100000000" }],
      positions: [expect.objectContaining({ markPx: "100100", updatedAt: ISO })],
    }));
    await stop();
  });
});
