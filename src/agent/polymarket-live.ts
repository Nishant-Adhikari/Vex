/**
 * Polymarket live tracker.
 *
 * Uses the authenticated user channel server-side, refreshes current state on
 * events, and fans updates out to local SSE subscribers.
 */

import logger from "../utils/logger.js";
import { CLOB_WS_USER_URL } from "../tools/polymarket/constants.js";
import { hasPolyClobCredentials, requirePolyClobCredentials } from "../tools/polymarket/auth.js";
import { getPolymarketPredictionState } from "./predictions.js";
import type { PredictionLiveStatus, PredictionPanelState } from "./types.js";

const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30000;
const BACKOFF_MULTIPLIER = 2;
const JITTER_FACTOR = 0.2;
const HEARTBEAT_INTERVAL_MS = 15000;
const REFRESH_DEBOUNCE_MS = 300;

type Listener = (state: PredictionPanelState) => void;

class PolymarketLiveTracker {
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private refreshInFlight: Promise<void> | null = null;
  private reconnectAttempt = 0;
  private started = false;
  private status: PredictionLiveStatus = "disabled";
  private reason: string | null = "Polymarket CLOB credentials not configured.";
  private lastEventAt: string | null = null;
  private lastSyncAt: string | null = null;
  private cachedState: PredictionPanelState | null = null;
  private listeners = new Set<Listener>();

  start(): void {
    if (this.started) return;
    this.started = true;

    if (!hasPolyClobCredentials()) {
      this.setStatus("disabled", "Polymarket CLOB credentials not configured.");
      return;
    }

    void this.refreshState("startup");
    this.connect();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async getCurrentState(): Promise<PredictionPanelState> {
    this.start();
    if (!this.cachedState) {
      await this.refreshState("initial-request");
    }
    if (!this.cachedState) {
      this.cachedState = this.withLiveStatus(await getPolymarketPredictionState());
    }
    return this.cachedState;
  }

  private connect(): void {
    if (this.ws || !hasPolyClobCredentials()) return;

    this.setStatus(this.reconnectAttempt > 0 ? "reconnecting" : "connecting", null);
    this.ws = new WebSocket(CLOB_WS_USER_URL);

    this.ws.addEventListener("open", () => {
      const creds = requirePolyClobCredentials();
      this.ws?.send(JSON.stringify({
        type: "user",
        auth: {
          apiKey: creds.apiKey,
          secret: creds.apiSecret,
          passphrase: creds.passphrase,
        },
      }));

      this.reconnectAttempt = 0;
      this.startHeartbeat();
      this.setStatus("live", null);
      void this.refreshState("connected");
      logger.info("predictions.polymarket.live.connected");
    });

    this.ws.addEventListener("message", (event) => {
      const raw = typeof event.data === "string" ? event.data : String(event.data);
      if (raw === "PONG") return;

      try {
        const data = JSON.parse(raw) as Record<string, unknown>;
        if (data.event_type === "order" || data.event_type === "trade") {
          this.lastEventAt = new Date().toISOString();
          this.scheduleRefresh();
        } else if (typeof data.status === "string" && data.status.toLowerCase() === "connected") {
          this.setStatus("live", null);
        }
      } catch (err) {
        logger.warn("predictions.polymarket.live.message_parse_failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    });

    this.ws.addEventListener("close", (event) => {
      const reason = event.reason || `code ${event.code}`;
      this.cleanupSocket();
      logger.warn("predictions.polymarket.live.closed", { reason });
      if (hasPolyClobCredentials()) {
        this.setStatus("reconnecting", reason);
        this.scheduleReconnect();
      } else {
        this.setStatus("disabled", "Polymarket CLOB credentials not configured.");
      }
    });

    this.ws.addEventListener("error", (event) => {
      const message = "message" in event ? String(event.message) : "WebSocket error";
      logger.warn("predictions.polymarket.live.error", { error: message });
    });
  }

  private cleanupSocket(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.ws = null;
  }

  private startHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = setInterval(() => {
      try {
        this.ws?.send("PING");
      } catch (err) {
        logger.warn("predictions.polymarket.live.heartbeat_failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    const baseDelay = Math.min(
      INITIAL_BACKOFF_MS * Math.pow(BACKOFF_MULTIPLIER, this.reconnectAttempt),
      MAX_BACKOFF_MS,
    );
    const jitter = baseDelay * JITTER_FACTOR * (Math.random() * 2 - 1);
    const delay = Math.max(0, baseDelay + jitter);
    this.reconnectAttempt++;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer) return;
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      void this.refreshState("ws-event");
    }, REFRESH_DEBOUNCE_MS);
  }

  private async refreshState(reason: string): Promise<void> {
    if (this.refreshInFlight) {
      await this.refreshInFlight;
      return;
    }

    this.refreshInFlight = (async () => {
      try {
        const state = await getPolymarketPredictionState();
        this.lastSyncAt = new Date().toISOString();
        this.cachedState = this.withLiveStatus(state);
        this.broadcast();
        logger.debug("predictions.polymarket.live.refreshed", { reason });
      } catch (err) {
        logger.warn("predictions.polymarket.live.refresh_failed", {
          reason,
          error: err instanceof Error ? err.message : String(err),
        });
        this.reason = err instanceof Error ? err.message : String(err);
        if (this.cachedState) {
          this.cachedState = this.withLiveStatus(this.cachedState);
          this.broadcast();
        }
      } finally {
        this.refreshInFlight = null;
      }
    })();

    await this.refreshInFlight;
  }

  private setStatus(status: PredictionLiveStatus, reason: string | null): void {
    this.status = status;
    this.reason = reason;
    if (this.cachedState) {
      this.cachedState = this.withLiveStatus(this.cachedState);
      this.broadcast();
    }
  }

  private withLiveStatus(state: PredictionPanelState): PredictionPanelState {
    return {
      ...state,
      liveStatus: {
        available: hasPolyClobCredentials(),
        status: hasPolyClobCredentials() ? this.status : "disabled",
        lastEventAt: this.lastEventAt,
        lastSyncAt: this.lastSyncAt,
        reason: hasPolyClobCredentials() ? this.reason : "Polymarket CLOB credentials not configured.",
      },
    };
  }

  private broadcast(): void {
    if (!this.cachedState) return;
    for (const listener of this.listeners) {
      listener(this.cachedState);
    }
  }
}

const tracker = new PolymarketLiveTracker();

export function startPolymarketLiveTracker(): void {
  tracker.start();
}

export async function getCurrentPolymarketPredictionState(): Promise<PredictionPanelState> {
  return tracker.getCurrentState();
}

export function subscribePolymarketPredictionUpdates(listener: Listener): () => void {
  tracker.start();
  return tracker.subscribe(listener);
}
