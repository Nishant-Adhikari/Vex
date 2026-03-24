import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PredictionPanelState } from "../../agent/types.js";

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];

  readonly listeners = new Map<string, Array<(event: any) => void>>();
  readonly sent: string[] = [];
  readonly url: string;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type: string, listener: (event: any) => void): void {
    const current = this.listeners.get(type) ?? [];
    current.push(listener);
    this.listeners.set(type, current);
  }

  send(data: string): void {
    this.sent.push(String(data));
  }

  close(): void {
    // no-op for tests
  }

  emit(type: string, event: any = {}): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }
}

function makeState(source: "polymarket" = "polymarket"): PredictionPanelState {
  return {
    source,
    available: true,
    summary: {
      totalValueUsd: 10,
      totalPnlUsd: 1,
      totalPnlPct: 10,
      positionCount: 1,
      orderCount: 1,
      claimableCount: 0,
      redeemableCount: 0,
      mergeableCount: 0,
    },
    positions: [],
    orders: [],
    liveStatus: {
      available: true,
      status: "offline",
      lastEventAt: null,
      lastSyncAt: null,
      reason: null,
    },
    asOf: new Date().toISOString(),
    warnings: [],
  };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("polymarket live tracker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.restoreAllMocks();
    vi.resetModules();
    vi.stubGlobal("WebSocket", FakeWebSocket as unknown as typeof WebSocket);
    FakeWebSocket.instances.length = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("returns disabled live status when CLOB credentials are missing", async () => {
    const mockGetPolymarketPredictionState = vi.fn(async () => makeState());

    vi.doMock("../../polymarket/auth.js", () => ({
      hasPolyClobCredentials: vi.fn(() => false),
      requirePolyClobCredentials: vi.fn(),
    }));
    vi.doMock("../../agent/predictions.js", () => ({
      getPolymarketPredictionState: (...args: unknown[]) => mockGetPolymarketPredictionState(...args),
    }));
    vi.doMock("../../utils/logger.js", () => ({
      default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    }));

    const { getCurrentPolymarketPredictionState } = await import("../../agent/polymarket-live.js");
    const state = await getCurrentPolymarketPredictionState();

    expect(state.liveStatus.available).toBe(false);
    expect(state.liveStatus.status).toBe("disabled");
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it("authenticates, refreshes on order events, and reconnects after close", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const mockGetPolymarketPredictionState = vi.fn(async () => makeState());

    vi.doMock("../../polymarket/auth.js", () => ({
      hasPolyClobCredentials: vi.fn(() => true),
      requirePolyClobCredentials: vi.fn(() => ({
        apiKey: "api-key",
        apiSecret: "api-secret",
        passphrase: "passphrase",
      })),
    }));
    vi.doMock("../../agent/predictions.js", () => ({
      getPolymarketPredictionState: (...args: unknown[]) => mockGetPolymarketPredictionState(...args),
    }));
    vi.doMock("../../utils/logger.js", () => ({
      default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    }));

    const {
      subscribePolymarketPredictionUpdates,
      getCurrentPolymarketPredictionState,
    } = await import("../../agent/polymarket-live.js");

    const updates: PredictionPanelState[] = [];
    const unsubscribe = subscribePolymarketPredictionUpdates((state) => {
      updates.push(state);
    });

    await flushMicrotasks();

    expect(FakeWebSocket.instances).toHaveLength(1);
    const ws = FakeWebSocket.instances[0];

    ws.emit("open");
    await flushMicrotasks();

    expect(JSON.parse(ws.sent[0] ?? "{}")).toEqual({
      type: "user",
      auth: {
        apiKey: "api-key",
        secret: "api-secret",
        passphrase: "passphrase",
      },
    });

    ws.emit("message", { data: JSON.stringify({ event_type: "order" }) });
    vi.advanceTimersByTime(300);
    await flushMicrotasks();

    const current = await getCurrentPolymarketPredictionState();
    expect(mockGetPolymarketPredictionState).toHaveBeenCalled();
    expect(current.liveStatus.status).toBe("live");
    expect(current.liveStatus.lastEventAt).not.toBeNull();
    expect(updates.at(-1)?.liveStatus.status).toBe("live");

    ws.emit("close", { code: 1006, reason: "network" });
    vi.advanceTimersByTime(1000);

    expect(FakeWebSocket.instances).toHaveLength(2);

    unsubscribe();
  });
});
