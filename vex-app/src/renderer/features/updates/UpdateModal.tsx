/**
 * Update detail modal (M13) — the two-step flow surface.
 *
 * Presentational: it renders the current `UpdateStatus` and calls back into
 * `UpdateLayer` for actions. Step 1 is an explicit "Update now" (download);
 * step 2 is a SEPARATE "Restart and install" shown only once the download is
 * ready. No auto-restart, no artifact paths/URLs. Copy follows the
 * user-triggered-updates contract (vex-user-triggered-updates §Update UX).
 */

import type { JSX } from "react";
import type { UpdateStatus } from "@shared/schemas/updater.js";
import { Button } from "../../components/ui/button.js";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog.js";

interface UpdateModalProps {
  readonly open: boolean;
  readonly status: UpdateStatus;
  readonly busy: boolean;
  readonly onOpenChange: (next: boolean) => void;
  readonly onDownload: () => void;
  readonly onCancel: () => void;
  readonly onRestart: () => void;
  readonly onCheck: () => void;
  readonly onReleaseNotes: () => void;
}

export function UpdateModal({
  open,
  status,
  busy,
  onOpenChange,
  onDownload,
  onCancel,
  onRestart,
  onCheck,
  onReleaseNotes,
}: UpdateModalProps): JSX.Element {
  const close = (): void => onOpenChange(false);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" data-vex-screen="updateModal">
        <DialogHeader>
          <DialogTitle>{titleFor(status)}</DialogTitle>
          <DialogDescription>{descriptionFor(status)}</DialogDescription>
        </DialogHeader>

        <DialogBody>
          {status.kind === "available" && status.summary ? (
            <p className="text-sm text-muted-foreground">{status.summary}</p>
          ) : null}
          {status.kind === "available" ? (
            <p className="text-xs text-muted-foreground">
              Downloads the update and restarts Vex when ready.
            </p>
          ) : null}
          {status.kind === "downloading" ? (
            <UpdateProgress percent={status.percent} />
          ) : null}
          {status.kind === "error" ? (
            <p className="text-sm text-muted-foreground">{status.message}</p>
          ) : null}
          {status.kind === "blockedByOperation" ? (
            <p className="text-sm text-muted-foreground">{status.reason}</p>
          ) : null}
        </DialogBody>

        <DialogFooter>
          {renderFooter(status, {
            busy,
            close,
            onDownload,
            onCancel,
            onRestart,
            onCheck,
            onReleaseNotes,
          })}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface FooterActions {
  readonly busy: boolean;
  readonly close: () => void;
  readonly onDownload: () => void;
  readonly onCancel: () => void;
  readonly onRestart: () => void;
  readonly onCheck: () => void;
  readonly onReleaseNotes: () => void;
}

function renderFooter(status: UpdateStatus, a: FooterActions): JSX.Element {
  switch (status.kind) {
    case "available":
      return (
        <>
          <Button variant="ghost" onClick={a.onReleaseNotes}>
            Release notes
          </Button>
          <Button variant="ghost" onClick={a.close}>
            Later
          </Button>
          <Button onClick={a.onDownload} disabled={a.busy}>
            Update now
          </Button>
        </>
      );
    case "downloading":
      return (
        <Button variant="ghost" onClick={a.onCancel} disabled={a.busy}>
          Cancel
        </Button>
      );
    case "downloaded":
      return (
        <>
          <Button variant="ghost" onClick={a.close}>
            Later
          </Button>
          <Button onClick={a.onRestart} disabled={a.busy}>
            Restart and install
          </Button>
        </>
      );
    case "blockedByOperation":
      return (
        <Button onClick={a.close}>Got it</Button>
      );
    case "error":
      return (
        <>
          <Button variant="ghost" onClick={a.onReleaseNotes}>
            Open download page
          </Button>
          <Button onClick={a.onCheck} disabled={a.busy}>
            Try again
          </Button>
        </>
      );
    case "installing":
      return <Button disabled>Installing…</Button>;
    case "checking":
      return <Button disabled>Checking…</Button>;
    case "current":
    case "idle":
      return (
        <Button variant="ghost" onClick={a.close}>
          Close
        </Button>
      );
  }
}

function titleFor(status: UpdateStatus): string {
  switch (status.kind) {
    case "available":
      return `Vex ${status.latestVersion} is available`;
    case "downloading":
      return `Downloading Vex ${status.latestVersion}`;
    case "downloaded":
      return "Ready to install";
    case "installing":
      return "Installing update";
    case "blockedByOperation":
      return "Update blocked";
    case "error":
      return "Update failed";
    case "checking":
      return "Checking for updates";
    case "current":
      return "You're up to date";
    case "idle":
      return "Updates";
  }
}

function descriptionFor(status: UpdateStatus): string {
  switch (status.kind) {
    case "available":
      return `Current version: ${status.currentVersion}.`;
    case "downloading":
      return "The update is downloading. You can keep using Vex.";
    case "downloaded":
      return `Vex ${status.latestVersion} is ready. Vex will restart to install it.`;
    case "installing":
      return "Vex is closing and will reopen automatically.";
    case "blockedByOperation":
      return "Finish the current operation before updating.";
    case "error":
      return "Check your connection and try again.";
    case "checking":
      return "Contacting the update channel…";
    case "current":
      return `Vex ${status.currentVersion} is the latest version.`;
    case "idle":
      return "No update in progress.";
  }
}

function UpdateProgress({ percent }: { readonly percent: number }): JSX.Element {
  const clamped = Math.min(100, Math.max(0, Math.round(percent)));
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between text-xs">
        <span className="font-mono uppercase tracking-[0.2em] text-muted-foreground">
          Downloading
        </span>
        <span className="font-mono tabular-nums">{clamped}%</span>
      </div>
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className="h-full bg-primary transition-[width] duration-150 ease-out"
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  );
}
