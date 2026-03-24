import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";

const registeredHandlers = new Map<string, (...args: any[]) => any>();
const mockGetJupiterPredictionState = vi.fn();
const mockGetCurrentPolymarketPredictionState = vi.fn();
const mockSubscribePolymarketPredictionUpdates = vi.fn(() => () => {});

vi.mock("../../agent/routes.js", () => ({
  registerRoute: vi.fn((method: string, pattern: string, handler: any) => {
    registeredHandlers.set(`${method} ${pattern}`, handler);
  }),
  jsonResponse: vi.fn((res: any, status: number, body: any) => {
    res._status = status;
    res._body = body;
  }),
  errorResponse: vi.fn((res: any, status: number, code: string, message: string) => {
    res._status = status;
    res._body = { error: { code, message } };
  }),
}));

vi.mock("../../agent/predictions.js", () => ({
  getJupiterPredictionState: (...args: unknown[]) => mockGetJupiterPredictionState(...args),
}));

vi.mock("../../agent/polymarket-live.js", () => ({
  getCurrentPolymarketPredictionState: (...args: unknown[]) => mockGetCurrentPolymarketPredictionState(...args),
  subscribePolymarketPredictionUpdates: (...args: unknown[]) => mockSubscribePolymarketPredictionUpdates(...args),
}));

const { registerPredictionsRoutes } = await import("../../agent/handlers/predictions.js");
registerPredictionsRoutes();

function makeRes(): ServerResponse & {
  _status?: number;
  _body?: unknown;
  writableEnded: boolean;
  writeHead: ReturnType<typeof vi.fn>;
  write: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
} {
  return {
    _status: 0,
    _body: null,
    writableEnded: false,
    writeHead: vi.fn(),
    write: vi.fn(),
    end: vi.fn(),
  } as unknown as ServerResponse & {
    _status?: number;
    _body?: unknown;
    writableEnded: boolean;
    writeHead: ReturnType<typeof vi.fn>;
    write: ReturnType<typeof vi.fn>;
    end: ReturnType<typeof vi.fn>;
  };
}

describe("prediction routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the selected prediction source state", async () => {
    const handler = registeredHandlers.get("GET /api/agent/predictions");
    const res = makeRes();
    mockGetJupiterPredictionState.mockResolvedValue({ source: "jupiter", positions: [] });

    await handler?.({ url: "/api/agent/predictions?source=jupiter" } as IncomingMessage, res, { pathParams: {}, body: null });

    expect(mockGetJupiterPredictionState).toHaveBeenCalledTimes(1);
    expect(res._status).toBe(200);
    expect(res._body).toEqual({ source: "jupiter", positions: [] });
  });

  it("rejects invalid prediction sources", async () => {
    const handler = registeredHandlers.get("GET /api/agent/predictions");
    const res = makeRes();

    await handler?.({ url: "/api/agent/predictions?source=invalid" } as IncomingMessage, res, { pathParams: {}, body: null });

    expect(res._status).toBe(400);
    expect(res._body).toEqual({
      error: {
        code: "INVALID_SOURCE",
        message: "source must be one of: jupiter, polymarket",
      },
    });
  });

  it("streams initial Polymarket snapshot over SSE", async () => {
    const handler = registeredHandlers.get("GET /api/agent/predictions/stream");
    const res = makeRes();
    let closeHandler: (() => void) | null = null;
    mockGetCurrentPolymarketPredictionState.mockResolvedValue({ source: "polymarket", positions: [] });

    await handler?.({
      url: "/api/agent/predictions/stream?source=polymarket",
      on: vi.fn((event: string, cb: () => void) => {
        if (event === "close") closeHandler = cb;
      }),
    } as unknown as IncomingMessage, res, { pathParams: {}, body: null });

    expect(res.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({
      "Content-Type": "text/event-stream",
    }));
    expect(res.write).toHaveBeenCalledWith(expect.stringContaining("event: snapshot"));
    expect(mockSubscribePolymarketPredictionUpdates).toHaveBeenCalledTimes(1);

    closeHandler?.();
  });
});
