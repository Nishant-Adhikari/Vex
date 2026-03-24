/**
 * Predictions handlers.
 *
 * GET /api/agent/predictions?source=...        — current prediction state
 * GET /api/agent/predictions/stream?source=... — Polymarket live SSE
 */

import type { IncomingMessage } from "node:http";
import { errorResponse, jsonResponse, registerRoute } from "../routes.js";
import { getJupiterPredictionState } from "../predictions.js";
import { getCurrentPolymarketPredictionState, subscribePolymarketPredictionUpdates } from "../polymarket-live.js";

const VALID_SOURCES = new Set(["jupiter", "polymarket"]);

function getSource(req: IncomingMessage): "jupiter" | "polymarket" | null {
  const url = new URL(req.url ?? "/", "http://localhost");
  const source = url.searchParams.get("source") ?? "polymarket";
  return VALID_SOURCES.has(source) ? source as "jupiter" | "polymarket" : null;
}

function sseEvent(type: string, data: Record<string, unknown>): string {
  return `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
}

export function registerPredictionsRoutes(): void {
  registerRoute("GET", "/api/agent/predictions", async (req, res) => {
    const source = getSource(req);
    if (!source) {
      errorResponse(res, 400, "INVALID_SOURCE", "source must be one of: jupiter, polymarket");
      return;
    }

    const state = source === "jupiter"
      ? await getJupiterPredictionState()
      : await getCurrentPolymarketPredictionState();

    jsonResponse(res, 200, state);
  });

  registerRoute("GET", "/api/agent/predictions/stream", async (req, res) => {
    const source = getSource(req);
    if (source !== "polymarket") {
      errorResponse(res, 400, "INVALID_SOURCE", "predictions stream supports only source=polymarket");
      return;
    }

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    });

    let closed = false;
    req.on("close", () => {
      closed = true;
    });

    const emit = (type: string, data: Record<string, unknown>) => {
      if (!closed && !res.writableEnded) res.write(sseEvent(type, data));
    };

    emit("snapshot", await getCurrentPolymarketPredictionState() as unknown as Record<string, unknown>);

    const unsubscribe = subscribePolymarketPredictionUpdates((state) => {
      emit("snapshot", state as unknown as Record<string, unknown>);
    });

    const keepAlive = setInterval(() => {
      emit("ping", { ts: Date.now() });
    }, 15000);

    req.on("close", () => {
      unsubscribe();
      clearInterval(keepAlive);
      if (!res.writableEnded) res.end();
    });
  });
}
