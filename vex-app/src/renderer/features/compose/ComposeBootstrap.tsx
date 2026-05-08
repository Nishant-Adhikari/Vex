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

import { useEffect, useRef } from "react";
import { useComposeUp } from "../../lib/api/docker.js";
import { useUiStore } from "../../stores/uiStore.js";
import { Button } from "../../components/ui/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card.js";

export function ComposeBootstrap(): JSX.Element {
  const setCurrentView = useUiStore((s) => s.setCurrentView);
  const upMutation = useComposeUp();
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    upMutation.mutate({});
  }, [upMutation]);

  const result = upMutation.data;
  const status: "idle" | "running" | "ready" | "reused" | "error" =
    upMutation.isPending
      ? "running"
      : result === undefined
        ? "idle"
        : !result.ok
          ? "error"
          : result.data.kind === "running"
            ? "ready"
            : result.data.kind === "reused"
              ? "reused"
              : "error";

  return (
    <main
      className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background p-8 text-foreground"
      data-vex-screen="composeBootstrap"
    >
      <Card className="w-full max-w-xl">
        <CardHeader>
          <CardTitle>Starting Vex services</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            {status === "running"
              ? "Rendering compose template, pulling images, waiting for Postgres health…"
              : status === "ready"
                ? "Postgres is healthy on the configured port."
                : status === "reused"
                  ? "Reusing the existing Vex compose project that is already running."
                  : status === "error"
                    ? result?.ok
                      ? result.data.message
                      : "Failed to bring services up. See logs for details."
                    : "Initializing…"}
          </p>
          {status === "running" ? (
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-popover">
              <div className="h-full w-1/3 animate-pulse bg-primary" />
            </div>
          ) : null}
          <div className="flex justify-end gap-2">
            {status === "error" ? (
              <Button
                variant="outline"
                onClick={() => {
                  startedRef.current = false;
                  upMutation.reset();
                }}
              >
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
