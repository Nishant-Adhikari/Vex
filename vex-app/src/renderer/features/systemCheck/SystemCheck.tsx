/**
 * System Check screen — first user-facing post-splash surface.
 *
 * Four step rows revealed via CSS @keyframes cascade (80ms stagger).
 * Each row drives off a M2 TanStack Query hook; status is computed
 * from the Result<T, VexError> envelope so no probe data leaks into
 * renderer state on failure.
 *
 * M11.5.4 — DMR (Docker Model Runner) is no longer surfaced here.
 * vex-app ships its own bundled embeddings runtime via Compose
 * (`embeddings-runtime` service), so the Linux-DMR-gap advisory was
 * misleading. The `dockerStatusSchema.modelRunner` block is retained
 * unchanged for backward compatibility — the probe still runs but
 * no rendered surface consumes it.
 */

import { useEffect, useState } from "react";
import { useDockerStatus } from "../../lib/api/docker.js";
import { useEnvState } from "../../lib/api/onboarding.js";
import { useSystemHealth } from "../../lib/api/system.js";
import { useUiStore } from "../../stores/uiStore.js";
import { Button } from "../../components/ui/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card.js";
import { StepRow, type StepStatus } from "./StepRow.js";

export function SystemCheck(): JSX.Element {
  const setCurrentView = useUiStore((s) => s.setCurrentView);
  const health = useSystemHealth();
  const docker = useDockerStatus();
  const env = useEnvState();

  const [revealCount, setRevealCount] = useState(0);

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (let i = 1; i <= 4; i += 1) {
      timers.push(setTimeout(() => setRevealCount(i), i * 80));
    }
    return () => {
      for (const t of timers) clearTimeout(t);
    };
  }, []);

  const osStatus: StepStatus = health.isPending
    ? "loading"
    : health.data?.ok
      ? "ok"
      : "fail";

  const networkStatus: StepStatus = health.isPending
    ? "loading"
    : health.data?.ok && health.data.data.network.online
      ? "ok"
      : "warn";

  const dockerStatus: StepStatus = docker.isPending
    ? "loading"
    : !docker.data?.ok
      ? "fail"
      : !docker.data.data.endpoint.accepted
        ? "fail"
      : !docker.data.data.engine.present || !docker.data.data.daemon.running
        ? "warn"
        : "ok";

  const envStatus: StepStatus = env.isPending
    ? "loading"
    : !env.data?.ok
      ? "fail"
      : env.data.data.setupCompleteFlag
        ? "ok"
        : "warn";

  const anyLoading =
    health.isPending || docker.isPending || env.isPending;

  return (
    <main
      className="flex min-h-screen flex-col items-center justify-center gap-8 bg-background p-8 text-foreground"
      data-vex-screen="systemCheck"
    >
      <div className="flex flex-col items-center gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">System check</h1>
        <p className="text-sm text-[var(--color-text-secondary)]">
          Verifying environment before bootstrap. This takes a few seconds.
        </p>
      </div>

      <Card className="w-full max-w-xl">
        <CardHeader>
          <CardTitle>Environment</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="flex flex-col gap-2">
            {revealCount >= 1 ? (
              <StepRow
                label="Detecting operating system"
                status={osStatus}
                detail={
                  health.data?.ok
                    ? `${health.data.data.os.platform} / ${health.data.data.os.arch}${
                        health.data.data.os.distro
                          ? ` · ${health.data.data.os.distro}`
                          : ""
                      } · Electron ${health.data.data.os.electronVersion}`
                    : null
                }
              />
            ) : null}
            {revealCount >= 2 ? (
              <StepRow
                label="Checking network connectivity"
                status={networkStatus}
                detail={
                  health.data?.ok
                    ? health.data.data.network.online
                      ? `online · ${health.data.data.network.latencyMs ?? "?"} ms`
                      : "offline — agent will run with limited capabilities"
                    : null
                }
              />
            ) : null}
            {revealCount >= 3 ? (
              <StepRow
                label="Looking for Docker"
                status={dockerStatus}
                detail={
                  docker.data?.ok
                    ? formatDockerDetail(docker.data.data)
                    : null
                }
              />
            ) : null}
            {revealCount >= 4 ? (
              <StepRow
                label="Existing Vex configuration"
                status={envStatus}
                detail={
                  env.data?.ok
                    ? formatEnvDetail(env.data.data)
                    : null
                }
              />
            ) : null}
          </ol>
        </CardContent>
      </Card>

      <Button
        type="button"
        size="lg"
        disabled={anyLoading}
        onClick={() => setCurrentView("dockerBootstrap")}
      >
        Continue
      </Button>
    </main>
  );
}

function formatDockerDetail(status: import("@shared/schemas/docker.js").DockerStatus): string {
  if (!status.endpoint.accepted) {
    return status.endpoint.message ?? "Docker endpoint rejected.";
  }
  const engine = status.engine.present
    ? `Docker ${status.engine.version ?? "?"}`
    : "Docker not found";
  const daemon = status.daemon.running ? "daemon running" : "daemon stopped";
  const compose = status.compose.present
    ? `Compose ${status.compose.version ?? "?"}`
    : "Compose missing";
  return `${engine} · ${daemon} · ${compose}`;
}

function formatEnvDetail(state: import("@shared/schemas/onboarding.js").EnvState): string {
  if (state.setupCompleteFlag) return "Setup previously completed.";
  const parts: string[] = [];
  if (state.walletStatus.evm === "present") parts.push("EVM keystore present");
  if (state.walletStatus.solana === "present") parts.push("Solana keystore present");
  if (state.embeddings.configured) parts.push("Embeddings configured");
  return parts.length > 0
    ? `Partial config: ${parts.join(", ")}.`
    : "First run — wizard will guide setup.";
}
