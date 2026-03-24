import { type FC, useEffect, useMemo, useState } from "react";
import { getPredictions, streamPredictions } from "../api";
import type { PredictionPanelState, PredictionSource } from "../types";
import { cn } from "../utils";

interface PredictionsViewProps {
  onBack: () => void;
}

const SOURCES: Array<{ key: PredictionSource; label: string }> = [
  { key: "polymarket", label: "Polymarket" },
  { key: "jupiter", label: "Jupiter" },
];

const POLL_INTERVAL_MS = 15000;

export const PredictionsView: FC<PredictionsViewProps> = ({ onBack }) => {
  const [source, setSource] = useState<PredictionSource>("polymarket");
  const [state, setState] = useState<PredictionPanelState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let streamAbort: AbortController | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const load = async (showSpinner: boolean): Promise<PredictionPanelState | null> => {
      if (showSpinner) setLoading(true);
      setError(null);
      try {
        const next = await getPredictions(source);
        if (cancelled) return null;
        setState(next);
        return next;
      } catch (err) {
        if (cancelled) return null;
        setError(err instanceof Error ? err.message : "Failed to load predictions");
        return null;
      } finally {
        if (!cancelled && showSpinner) setLoading(false);
      }
    };

    const connectStream = () => {
      if (source !== "polymarket") return;
      streamAbort = streamPredictions(
        "polymarket",
        (type, data) => {
          if (type === "snapshot") {
            setState(data as unknown as PredictionPanelState);
            setLoading(false);
            setError(null);
          } else if (type === "error") {
            setError(String(data.message ?? "Prediction stream failed"));
          }
        },
        () => {
          if (!cancelled) {
            reconnectTimer = setTimeout(connectStream, 3000);
          }
        },
      );
    };

    void load(true).then((next) => {
      if (!cancelled && source === "polymarket" && next?.liveStatus.available) connectStream();
    });

    const poll = setInterval(() => {
      void load(false);
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(poll);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      streamAbort?.abort();
    };
  }, [source]);

  const summary = state?.summary;
  const liveTone = useMemo(() => {
    switch (state?.liveStatus.status) {
      case "live":
        return "bg-status-ok/15 text-status-ok border-status-ok/20";
      case "connecting":
      case "reconnecting":
        return "bg-status-warn/15 text-status-warn border-status-warn/20";
      case "offline":
        return "bg-status-error/15 text-status-error border-status-error/20";
      default:
        return "bg-card text-muted-foreground border-border";
    }
  }, [state?.liveStatus.status]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-4 px-5 py-3 border-b border-border">
        <button onClick={onBack} className="text-muted-foreground hover:text-foreground text-sm transition">&larr; Back</button>
        <h2 className="text-sm font-semibold text-foreground">Predictions</h2>
        <button
          onClick={() => {
            setLoading(true);
            setError(null);
            getPredictions(source)
              .then(setState)
              .catch((err) => setError(err instanceof Error ? err.message : "Failed to load predictions"))
              .finally(() => setLoading(false));
          }}
          className="ml-auto text-2xs text-muted-foreground hover:text-foreground transition"
        >
          Refresh
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        <div className="flex gap-1">
          {SOURCES.map((entry) => (
            <button
              key={entry.key}
              onClick={() => setSource(entry.key)}
              className={cn(
                "px-3 py-1.5 text-xs rounded-lg transition border",
                source === entry.key
                  ? "bg-accent/20 text-accent border-accent/20"
                  : "text-muted-foreground hover:text-foreground border-transparent hover:border-border",
              )}
            >
              {entry.label}
            </button>
          ))}
        </div>

        {state && (
          <div className="rounded-2xl border border-border bg-card/50 backdrop-blur-md px-5 py-4">
            <div className="flex items-start gap-3">
              <div>
                <div className="text-2xs text-muted-foreground font-medium uppercase tracking-wide">{state.source}</div>
                <div className="flex items-baseline gap-3 mt-1">
                  <span className="text-2xl font-bold text-foreground">${summary?.totalValueUsd.toFixed(2) ?? "0.00"}</span>
                  {summary?.totalPnlPct != null && (
                    <span className={cn("text-sm font-medium", summary.totalPnlUsd >= 0 ? "text-status-ok" : "text-status-error")}>
                      {summary.totalPnlUsd >= 0 ? "+" : ""}${summary.totalPnlUsd.toFixed(2)} ({summary.totalPnlPct.toFixed(1)}%)
                    </span>
                  )}
                </div>
              </div>

              <div className="ml-auto flex flex-col items-end gap-2">
                <div className="text-2xs text-muted-foreground">As of {new Date(state.asOf).toLocaleTimeString()}</div>
                <div className="flex items-center gap-2">
                  <span className="text-2xs text-muted-foreground">{summary?.positionCount ?? 0} positions</span>
                  {state.source === "polymarket" && (
                    <span className={cn("px-2 py-0.5 text-2xs rounded-full border", liveTone)}>
                      {state.liveStatus.status}
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="flex gap-2 flex-wrap mt-3 text-2xs text-muted-foreground">
              {summary && (
                <>
                  {summary.claimableCount > 0 && <span>{summary.claimableCount} claimable</span>}
                  {summary.redeemableCount > 0 && <span>{summary.redeemableCount} redeemable</span>}
                  {summary.mergeableCount > 0 && <span>{summary.mergeableCount} mergeable</span>}
                  {summary.orderCount > 0 && <span>{summary.orderCount} open orders</span>}
                </>
              )}
            </div>
          </div>
        )}

        {state?.warnings.length ? (
          <div className="rounded-xl border border-status-warn/20 bg-status-warn/10 px-4 py-3 text-xs text-status-warn space-y-1">
            {state.warnings.map((warning) => (
              <div key={warning}>{warning}</div>
            ))}
          </div>
        ) : null}

        {error && !loading && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="text-sm text-status-error mb-2">{error}</div>
          </div>
        )}

        {state && !loading && !error && !state.available && (
          <div className="text-center text-sm text-muted-foreground py-12">
            {state.warnings[0] ?? "Prediction source unavailable."}
          </div>
        )}

        {state && !loading && !error && state.available && (
          <>
            <div className="space-y-2">
              {state.positions.map((position) => (
                <div key={position.id} className="rounded-2xl border border-border bg-card/50 backdrop-blur-md px-4 py-3">
                  <div className="flex items-start gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-foreground truncate">{position.title}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {position.outcome} · {position.marketId}
                      </div>
                    </div>
                    <div className="ml-auto text-right">
                      <div className="text-sm font-medium text-foreground">${position.valueUsd.toFixed(2)}</div>
                      <div className={cn("text-xs", position.pnlUsd >= 0 ? "text-status-ok" : "text-status-error")}>
                        {position.pnlUsd >= 0 ? "+" : ""}${position.pnlUsd.toFixed(2)}
                        {position.pnlPct != null ? ` (${position.pnlPct.toFixed(1)}%)` : ""}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 mt-3 text-xs text-muted-foreground">
                    <div>Size: <span className="text-foreground">{position.size.toFixed(2)}</span></div>
                    <div>Avg: <span className="text-foreground">${position.avgPrice.toFixed(3)}</span></div>
                    <div>Current: <span className="text-foreground">${position.currentPrice.toFixed(3)}</span></div>
                    <div>Cost: <span className="text-foreground">${position.costUsd.toFixed(2)}</span></div>
                  </div>

                  <div className="flex gap-2 flex-wrap mt-3 text-2xs text-muted-foreground">
                    {position.flags.claimable && <span className="px-2 py-0.5 rounded-full bg-status-ok/15 text-status-ok">Claimable</span>}
                    {position.flags.redeemable && <span className="px-2 py-0.5 rounded-full bg-status-ok/15 text-status-ok">Redeemable</span>}
                    {position.flags.mergeable && <span className="px-2 py-0.5 rounded-full bg-status-warn/15 text-status-warn">Mergeable</span>}
                  </div>
                </div>
              ))}
            </div>

            {state.positions.length === 0 && (
              <div className="text-center text-sm text-muted-foreground py-10">
                No {state.source} positions yet.
              </div>
            )}

            {state.source === "polymarket" && state.orders.length > 0 && (
              <div className="rounded-2xl border border-border bg-card/50 backdrop-blur-md px-4 py-3">
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">Open Orders</div>
                <div className="space-y-2">
                  {state.orders.map((order) => (
                    <div key={order.id} className="flex items-center gap-3 text-xs">
                      <div className="min-w-0 flex-1">
                        <div className="text-foreground font-medium truncate">{order.marketId}</div>
                        <div className="text-muted-foreground">{order.side} {order.outcome} @ ${order.price.toFixed(3)}</div>
                      </div>
                      <div className="text-right text-muted-foreground">
                        <div>{order.matchedSize.toFixed(2)} / {order.size.toFixed(2)}</div>
                        <div>{order.status}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {loading && (
          <div className="flex justify-center py-12">
            <div className="h-6 w-6 rounded-full border-2 border-accent/30 border-t-accent animate-spin" />
          </div>
        )}
      </div>
    </div>
  );
};
