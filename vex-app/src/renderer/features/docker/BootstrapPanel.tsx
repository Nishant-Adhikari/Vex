/**
 * Docker bootstrap orchestrator. Determines the active branch
 * (A/B/C/D) from the M2 docker.detect status and dispatches to the
 * appropriate sub-component.
 *
 *   A — engine present + daemon running → green check, Continue
 *   B — engine present + daemon stopped → "Start Docker" button
 *   C — engine missing → desktop download (mac/win) OR Linux install
 *   D — failure / declined → actionable error + retry
 */

import { useEffect, useState } from "react";
import { useDockerInstall, useDockerStart, useDockerStatus } from "../../lib/api/docker.js";
import { useSystemHealth } from "../../lib/api/system.js";
import { useUiStore } from "../../stores/uiStore.js";
import { Button } from "../../components/ui/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card.js";
import { InstallProgressStrip } from "./InstallProgress.js";
import { LicenseNotice } from "./LicenseNotice.js";
import { LinuxManualInstructions } from "./LinuxManualInstructions.js";

type Step = "detect" | "install" | "start" | "verify" | "ready" | "failed";

export function BootstrapPanel(): JSX.Element {
  const setCurrentView = useUiStore((s) => s.setCurrentView);
  const dockerStatus = useDockerStatus();
  const systemHealth = useSystemHealth();
  const installMutation = useDockerInstall();
  const startMutation = useDockerStart();

  const [step, setStep] = useState<Step>("detect");
  const [licenseOpen, setLicenseOpen] = useState(false);
  const [manualInstructions, setManualInstructions] = useState<string | null>(null);

  const platform = systemHealth.data?.ok
    ? systemHealth.data.data.os.platform
    : null;

  // Auto-detect the branch from the latest probe whenever it lands.
  useEffect(() => {
    if (step !== "detect") return;
    const result = dockerStatus.data;
    if (!result || !result.ok) return;
    const status = result.data;
    if (status.engine.present && status.daemon.running) {
      setStep("ready");
    }
  }, [dockerStatus.data, step]);

  const branch = decideBranch(dockerStatus.data, platform);
  const failureMessage =
    dockerStatus.data?.ok && !dockerStatus.data.data.endpoint.accepted
      ? dockerStatus.data.data.endpoint.message
      : null;

  function handleStart(): void {
    setStep("start");
    startMutation.mutate(undefined, {
      onSettled: () => {
        // Trigger fresh detection — daemon takes ~30s on macOS Desktop.
        setStep("verify");
        void dockerStatus.refetch();
      },
    });
  }

  function handleDesktopInstall(): void {
    setLicenseOpen(true);
  }

  function handleLicenseAccepted(): void {
    setLicenseOpen(false);
    setStep("install");
    installMutation.mutate(
      { method: "desktop_download" },
      {
        onSettled: () => {
          setStep("verify");
          void dockerStatus.refetch();
        },
      }
    );
  }

  function handleLinuxManual(): void {
    setStep("install");
    installMutation.mutate(
      { method: "linux_manual_instructions" },
      {
        onSettled: (data) => {
          if (data?.ok) {
            setManualInstructions(data.data.fallbackInstructions);
          }
          setStep("verify");
        },
      }
    );
  }

  function handleContinue(): void {
    setCurrentView("composeBootstrap");
  }

  function handleRetry(): void {
    setStep("detect");
    setManualInstructions(null);
    void dockerStatus.refetch();
  }

  return (
    <main
      className="flex min-h-screen flex-col items-center justify-center gap-8 bg-background p-8 text-foreground"
      data-vex-screen="dockerBootstrap"
    >
      <div className="flex flex-col items-center gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Docker setup</h1>
        <p className="text-sm text-[var(--color-text-secondary)]">
          Vex runs Postgres + embeddings locally through Docker.
        </p>
      </div>

      {step === "ready" || branch === "A" ? (
        <ReadyCard onContinue={handleContinue} />
      ) : null}

      {step !== "ready" && branch === "B" ? (
        <DaemonStoppedCard
          onStart={handleStart}
          starting={startMutation.isPending || step === "start" || step === "verify"}
          startMessage={
            startMutation.data?.ok ? startMutation.data.data.message : null
          }
        />
      ) : null}

      {step !== "ready" && branch === "C-desktop" ? (
        <DesktopInstallCard
          onInstall={handleDesktopInstall}
          installing={installMutation.isPending || step === "install"}
        />
      ) : null}

      {step !== "ready" && branch === "C-linux" && manualInstructions === null ? (
        <LinuxInstallCard
          onManualInstall={handleLinuxManual}
          installing={installMutation.isPending || step === "install"}
        />
      ) : null}

      {manualInstructions !== null ? (
        <LinuxManualInstructions
          instructions={manualInstructions}
          onRetry={handleRetry}
        />
      ) : null}

      {branch === "D" || step === "failed" ? (
        <FailureCard message={failureMessage} onRetry={handleRetry} />
      ) : null}

      {step === "install" || step === "start" ? (
        <Card className="w-full max-w-xl">
          <CardContent className="pt-6">
            <InstallProgressStrip active />
          </CardContent>
        </Card>
      ) : null}

      <LicenseNotice
        open={licenseOpen}
        onAccept={handleLicenseAccepted}
        onDismiss={() => setLicenseOpen(false)}
      />
    </main>
  );
}

type Branch = "A" | "B" | "C-desktop" | "C-linux" | "D" | null;

function decideBranch(
  result: ReturnType<typeof useDockerStatus>["data"],
  platform: string | null
): Branch {
  if (!result || !result.ok) return null;
  const status = result.data;
  if (!status.endpoint.accepted) return "D";
  if (status.engine.present && status.daemon.running) return "A";
  if (status.engine.present && !status.daemon.running) return "B";
  if (!status.engine.present) {
    if (platform === "darwin" || platform === "win32") return "C-desktop";
    if (platform === "linux") return "C-linux";
  }
  return "D";
}

function ReadyCard({ onContinue }: { readonly onContinue: () => void }): JSX.Element {
  return (
    <Card className="w-full max-w-xl">
      <CardHeader>
        <CardTitle>Docker is ready</CardTitle>
      </CardHeader>
      <CardContent className="flex justify-end">
        <Button size="lg" onClick={onContinue}>
          Continue
        </Button>
      </CardContent>
    </Card>
  );
}

function DaemonStoppedCard({
  onStart,
  starting,
  startMessage,
}: {
  readonly onStart: () => void;
  readonly starting: boolean;
  readonly startMessage: string | null;
}): JSX.Element {
  return (
    <Card className="w-full max-w-xl">
      <CardHeader>
        <CardTitle>Docker is installed but not running</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          We&rsquo;ll launch Docker for you. macOS may need ~30 seconds before
          the daemon answers.
        </p>
        {startMessage ? (
          <p className="text-xs text-muted-foreground">{startMessage}</p>
        ) : null}
        <div className="flex justify-end">
          <Button onClick={onStart} disabled={starting}>
            {starting ? "Starting…" : "Start Docker"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function DesktopInstallCard({
  onInstall,
  installing,
}: {
  readonly onInstall: () => void;
  readonly installing: boolean;
}): JSX.Element {
  return (
    <Card className="w-full max-w-xl">
      <CardHeader>
        <CardTitle>Install Docker Desktop</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          We&rsquo;ll download Docker Desktop&rsquo;s official installer to your
          Downloads folder, then open it for you to run with admin privileges.
        </p>
        <div className="flex justify-end">
          <Button onClick={onInstall} disabled={installing}>
            {installing ? "Downloading…" : "Download installer"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function LinuxInstallCard({
  onManualInstall,
  installing,
}: {
  readonly onManualInstall: () => void;
  readonly installing: boolean;
}): JSX.Element {
  return (
    <Card className="w-full max-w-xl">
      <CardHeader>
        <CardTitle>Install Docker Engine</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          Docker Engine and the Docker Compose plugin must be installed by you
          or your system administrator. Vex will show the official command
          sequence, but it will not run elevated install commands.
        </p>
        <div className="flex justify-end">
          <Button onClick={onManualInstall} disabled={installing}>
            Show manual instructions
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function FailureCard({
  message,
  onRetry,
}: {
  readonly message: string | null;
  readonly onRetry: () => void;
}): JSX.Element {
  return (
    <Card className="w-full max-w-xl">
      <CardHeader>
        <CardTitle>Docker check did not complete</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          {message !== null ? (
            <span>{message} </span>
          ) : (
            <span>Try detecting again, or visit </span>
          )}
          <a
            href="https://docs.docker.com/get-docker/"
            target="_blank"
            rel="noreferrer"
            className="text-primary underline-offset-4 hover:underline"
          >
            Docker&rsquo;s install docs
          </a>
          {" "}for help.
        </p>
        <div className="flex justify-end">
          <Button onClick={onRetry}>Retry detection</Button>
        </div>
      </CardContent>
    </Card>
  );
}
