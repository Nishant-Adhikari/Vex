/**
 * Update detail modal (M13) — the two-step flow surface.
 *
 * Presentational: it renders the current `UpdateStatus` and calls back into
 * `UpdateLayer` for actions. Step 1 is an explicit "Pobierz aktualizację"
 * (download); step 2 is a SEPARATE "Zrestartuj i zainstaluj" (restart) shown
 * only once the download is ready. No auto-restart, no artifact paths/URLs.
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
            Informacje o wydaniu
          </Button>
          <Button variant="ghost" onClick={a.close}>
            Później
          </Button>
          <Button onClick={a.onDownload} disabled={a.busy}>
            Pobierz aktualizację
          </Button>
        </>
      );
    case "downloading":
      return (
        <Button variant="ghost" onClick={a.onCancel} disabled={a.busy}>
          Anuluj
        </Button>
      );
    case "downloaded":
      return (
        <>
          <Button variant="ghost" onClick={a.close}>
            Później
          </Button>
          <Button onClick={a.onRestart} disabled={a.busy}>
            Zrestartuj i zainstaluj
          </Button>
        </>
      );
    case "blockedByOperation":
      return (
        <Button onClick={a.close}>Rozumiem</Button>
      );
    case "error":
      return (
        <>
          <Button variant="ghost" onClick={a.onReleaseNotes}>
            Otwórz stronę pobierania
          </Button>
          <Button onClick={a.onCheck} disabled={a.busy}>
            Spróbuj ponownie
          </Button>
        </>
      );
    case "installing":
      return <Button disabled>Instalowanie…</Button>;
    case "checking":
      return <Button disabled>Sprawdzanie…</Button>;
    case "current":
    case "idle":
      return (
        <Button variant="ghost" onClick={a.close}>
          Zamknij
        </Button>
      );
  }
}

function titleFor(status: UpdateStatus): string {
  switch (status.kind) {
    case "available":
      return `Dostępna aktualizacja — Vex ${status.latestVersion}`;
    case "downloading":
      return `Pobieranie Vex ${status.latestVersion}`;
    case "downloaded":
      return "Aktualizacja gotowa do instalacji";
    case "installing":
      return "Instalowanie aktualizacji";
    case "blockedByOperation":
      return "Najpierw dokończ bieżącą operację";
    case "error":
      return "Aktualizacja nie powiodła się";
    case "checking":
      return "Sprawdzanie aktualizacji";
    case "current":
      return "Masz najnowszą wersję";
    case "idle":
      return "Aktualizacje";
  }
}

function descriptionFor(status: UpdateStatus): string {
  switch (status.kind) {
    case "available":
      return `Masz wersję ${status.currentVersion}. Pobranie nie uruchomi restartu — zrobisz to osobno.`;
    case "downloading":
      return "Vex pobiera aktualizację. Możesz dalej korzystać z aplikacji.";
    case "downloaded":
      return `Vex ${status.latestVersion} jest gotowa. Vex uruchomi się ponownie, aby zainstalować.`;
    case "installing":
      return "Vex zamyka się i uruchomi ponownie automatycznie.";
    case "blockedByOperation":
      return "Zaktualizuj, gdy bieżąca operacja się zakończy.";
    case "error":
      return "Sprawdź połączenie i spróbuj ponownie.";
    case "checking":
      return "Łączenie z kanałem aktualizacji…";
    case "current":
      return `Vex ${status.currentVersion} jest aktualna.`;
    case "idle":
      return "Brak aktywnej aktualizacji.";
  }
}

function UpdateProgress({ percent }: { readonly percent: number }): JSX.Element {
  const clamped = Math.min(100, Math.max(0, Math.round(percent)));
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between text-xs">
        <span className="font-mono uppercase tracking-[0.2em] text-muted-foreground">
          Pobieranie
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
