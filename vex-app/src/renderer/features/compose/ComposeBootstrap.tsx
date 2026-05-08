/**
 * Compose bootstrap surface — runs the compose render + up flow once
 * Docker is verified ready, polls for health, then advances the state
 * machine to placeholder when the DB answers `pg_isready`.
 *
 * Logs streaming is not wired into this component yet — the
 * `vex.docker.onComposeLogs` event channel is reserved for a richer
 * log viewer that lands when the wizard does (M11 has its own log
 * panel needs).
 */

import { useCallback, useEffect, useState } from "react";
import type { ComposeLog, ComposeUpResult } from "@shared/schemas/docker.js";
import { useUiStore } from "../../stores/uiStore.js";
import { Button } from "../../components/ui/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card.js";

const MAX_LOG_LINES = 20;

type Phase = "running" | "ready" | "reused" | "error";

interface PhaseState {
  readonly phase: Phase;
  readonly message: string | null;
}

export function ComposeBootstrap(): JSX.Element {
  const setCurrentView = useUiStore((s) => s.setCurrentView);
  const [logs, setLogs] = useState<ReadonlyArray<ComposeLog>>([]);
  const [state, setState] = useState<PhaseState>({ phase: "running", message: null });
  const [retryToken, setRetryToken] = useState(0);

  // Direct IPC call instead of useMutation. We deliberately NO LONGER
  // guard with `startedRef` — React 18 dev StrictMode runs effects
  // twice (mount → cleanup → mount) and a startedRef guard combined
  // with a cancelled flag would let mount1's promise be cancelled while
  // mount2 short-circuits without starting a new one, leaving state
  // stuck at "running" forever. Main-process composeUp is single-flight
  // (see `vex-app/src/main/ipc/docker.ts`) so a second concurrent IPC
  // call joins the in-flight one — no duplicate Docker work either way.
  useEffect(() => {
    let cancelled = false;
    setState({ phase: "running", message: null });

    void (async () => {
      try {
        const result = await window.vex.docker.composeUp({});
        if (cancelled) return;
        if (!result.ok) {
          setState({ phase: "error", message: result.error.message });
          return;
        }
        const data: ComposeUpResult = result.data;
        if (data.kind === "running") {
          setState({ phase: "ready", message: data.message });
        } else if (data.kind === "reused") {
          setState({ phase: "reused", message: data.message });
        } else {
          setState({ phase: "error", message: data.message });
        }
      } catch (err: unknown) {
        if (cancelled) return;
        setState({
          phase: "error",
          message: err instanceof Error ? err.message : "Unknown error",
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [retryToken]);

  // Subscribe to compose log stream — bounded buffer per skill §11.
  useEffect(() => {
    const off = window.vex.docker.onComposeLog((payload) => {
      setLogs((prev) => [...prev, payload].slice(-MAX_LOG_LINES));
    });
    return () => off();
  }, []);

  const handleRetry = useCallback((): void => {
    setLogs([]);
    setRetryToken((n) => n + 1);
  }, []);

  const status = state.phase;
  const lastLog = logs[logs.length - 1] ?? null;

  return (
    <main
      className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background p-8 text-foreground"
      data-vex-screen="composeBootstrap"
    >
      <Card className="w-full max-w-2xl">
        <CardHeader>
          <CardTitle>Starting Vex services</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            {status === "running"
              ? lastLog
                ? lastLog.line
                : "Checking Docker daemon…"
              : status === "ready"
                ? state.message ?? "Postgres is healthy on the configured port."
                : status === "reused"
                  ? state.message ??
                    "Reusing the existing Vex compose project that is already running."
                  : status === "error"
                    ? state.message ?? "Failed to bring services up. See logs for details."
                    : "Initializing…"}
          </p>
          {status === "running" ? (
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-popover">
              <div className="h-full w-1/3 animate-pulse bg-primary" />
            </div>
          ) : null}
          {logs.length > 0 ? (
            <pre className="max-h-48 overflow-y-auto rounded-md border border-border bg-popover/40 p-3 text-xs leading-relaxed text-muted-foreground">
              {logs.map((log, idx) => (
                <div
                  key={`${log.ts}-${idx}`}
                  className={
                    log.stream === "stderr" ? "text-warning" : undefined
                  }
                >
                  {log.line}
                </div>
              ))}
            </pre>
          ) : null}
          <div className="flex justify-end gap-2">
            {status === "error" ? (
              <Button variant="outline" onClick={handleRetry}>
                Retry
              </Button>
            ) : null}
            {status === "ready" || status === "reused" ? (
              <Button onClick={() => setCurrentView("placeholder")}>
                Continue
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
