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
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowUp01Icon, Cancel01Icon } from "@hugeicons/core-free-icons";
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
    // Solid ink strip + hairline rule — no glass (the landing depth law:
    // luminance steps + hairlines, never backdrop-filter).
    <div
      className="fixed inset-x-0 top-0 z-[60] flex items-center justify-center gap-3 border-b border-white/10 bg-card px-4 py-2 text-foreground"
      data-vex-screen="updateBanner"
      role="status"
    >
      {status.kind === "downloading" ? (
        // Live in-flight work → the sanctioned pulse ring on the status dot.
        <span
          aria-hidden
          className="vex-pulse-dot h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-accent-primary)]"
        />
      ) : (
        <HugeiconsIcon
          icon={ArrowUp01Icon}
          size={14}
          className="shrink-0 text-[var(--color-accent-secondary)]"
          aria-hidden
        />
      )}
      <span className="font-mono text-[11px] uppercase tracking-[0.16em] tabular-nums">
        {bannerLabel(status)}
      </span>
      <Button size="sm" onClick={onView}>
        View
      </Button>
      {onDismiss ? (
        <button
          type="button"
          aria-label="Dismiss update notification"
          onClick={onDismiss}
          className="text-muted-foreground transition-colors hover:text-foreground"
        >
          <HugeiconsIcon icon={Cancel01Icon} size={14} aria-hidden />
        </button>
      ) : null}
    </div>
  );
}

function bannerLabel(status: UpdateStatus): string {
  switch (status.kind) {
    case "available":
      return `Update available — Vex ${status.latestVersion}`;
    case "downloading":
      return `Downloading… ${Math.round(status.percent)}%`;
    case "downloaded":
      return "Ready to install";
    case "blockedByOperation":
      return "Update blocked during an operation";
    case "error":
      return "Update failed";
    default:
      return "Vex update";
  }
}
