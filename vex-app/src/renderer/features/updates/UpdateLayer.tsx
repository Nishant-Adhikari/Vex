/**
 * Global update layer (M13) — mounted once at the app root, above the view
 * switch, so a "new update available" prompt can appear over any screen.
 *
 * Owns the live status subscription + the two-step action wiring; renders a
 * discreet top banner that opens the detail modal. Defensive: a no-op when the
 * updater bridge is absent (plain dev / no feed / isolated renderer tests that
 * don't stub `window.vex.updater`).
 */

import { useState, type JSX } from "react";
import type { UpdateStatus } from "@shared/schemas/updater.js";
import { Button } from "../../components/ui/button.js";
import {
  openReleaseNotes,
  useCancelDownload,
  useCheckForUpdates,
  useRestartAndInstall,
  useStartUpdate,
  useUpdateStatus,
  useUpdaterLiveSync,
} from "../../lib/api/updates.js";
import { UpdateModal } from "./UpdateModal.js";

export function UpdateLayer(): JSX.Element | null {
  if (typeof window === "undefined" || !window.vex?.updater) return null;
  return <UpdateLayerInner />;
}

function UpdateLayerInner(): JSX.Element | null {
  useUpdaterLiveSync();
  const statusQuery = useUpdateStatus();
  const [modalOpen, setModalOpen] = useState(false);
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(null);

  const checkMut = useCheckForUpdates();
  const startMut = useStartUpdate();
  const cancelMut = useCancelDownload();
  const restartMut = useRestartAndInstall();
  const busy =
    checkMut.isPending ||
    startMut.isPending ||
    cancelMut.isPending ||
    restartMut.isPending;

  const status: UpdateStatus | null = statusQuery.data?.ok
    ? statusQuery.data.data
    : null;
  if (status === null) return null;

  const bannerVisible =
    isBannerKind(status) &&
    !(status.kind === "available" && dismissedVersion === status.latestVersion);

  return (
    <>
      {bannerVisible ? (
        <UpdateBanner
          status={status}
          onView={() => setModalOpen(true)}
          {...(status.kind === "available"
            ? { onDismiss: () => setDismissedVersion(status.latestVersion) }
            : {})}
        />
      ) : null}
      <UpdateModal
        open={modalOpen}
        status={status}
        busy={busy}
        onOpenChange={setModalOpen}
        onDownload={() => startMut.mutate()}
        onCancel={() => cancelMut.mutate()}
        onRestart={() => restartMut.mutate()}
        onCheck={() => checkMut.mutate()}
        onReleaseNotes={openReleaseNotes}
      />
    </>
  );
}

function isBannerKind(status: UpdateStatus): boolean {
  return (
    status.kind === "available" ||
    status.kind === "downloading" ||
    status.kind === "downloaded" ||
    status.kind === "blockedByOperation" ||
    status.kind === "error"
  );
}

interface UpdateBannerProps {
  readonly status: UpdateStatus;
  readonly onView: () => void;
  readonly onDismiss?: () => void;
}

function UpdateBanner({
  status,
  onView,
  onDismiss,
}: UpdateBannerProps): JSX.Element {
  return (
    <div
      className="fixed inset-x-0 top-0 z-[60] flex items-center justify-center gap-3 border-b border-border bg-card/95 px-4 py-2 text-sm text-foreground backdrop-blur"
      data-vex-screen="updateBanner"
      role="status"
    >
      <span aria-hidden>⬆</span>
      <span>{bannerLabel(status)}</span>
      <Button size="sm" onClick={onView}>
        Zobacz
      </Button>
      {onDismiss ? (
        <button
          type="button"
          aria-label="Zamknij powiadomienie o aktualizacji"
          onClick={onDismiss}
          className="text-muted-foreground hover:text-foreground"
        >
          ✕
        </button>
      ) : null}
    </div>
  );
}

function bannerLabel(status: UpdateStatus): string {
  switch (status.kind) {
    case "available":
      return `Vex ${status.latestVersion} jest dostępna`;
    case "downloading":
      return `Pobieranie Vex ${status.latestVersion}… ${Math.round(status.percent)}%`;
    case "downloaded":
      return `Vex ${status.latestVersion} gotowa do instalacji`;
    case "blockedByOperation":
      return "Aktualizacja wstrzymana";
    case "error":
      return "Aktualizacja nie powiodła się";
    default:
      return "Aktualizacja Vex";
  }
}
