/**
 * Docker Desktop license notice modal — shown BEFORE the user triggers
 * an installer download (skill Appendix A + codex turn 4 YELLOW #1).
 *
 * Plain inline modal (no Radix Portal yet — that primitive needs its own
 * CSP audit per MOTION-POLICY.md before adoption). Backdrop deny-clicks
 * outside the dialog so the user must explicitly accept or dismiss.
 *
 * No "I have a license" toggle — Vex cannot verify legal state and
 * presenting one would imply a verification it doesn't perform.
 */

import { useCallback, useEffect, useRef } from "react";
import { Button } from "../../components/ui/button.js";

interface LicenseNoticeProps {
  readonly open: boolean;
  readonly onAccept: () => void;
  readonly onDismiss: () => void;
}

const DOCKER_LICENSE_URL = "https://docs.docker.com/subscription/desktop-license/";

export function LicenseNotice({
  open,
  onAccept,
  onDismiss,
}: LicenseNoticeProps): JSX.Element | null {
  const dialogRef = useRef<HTMLDivElement | null>(null);

  const openDocs = useCallback((): void => {
    void window.vex; // ensures bridge type usage; openExternal goes via main allowlist
    // M4 will wire `vex.shell.openExternal(url)` once the bridge surface
    // exists; for now use anchor-target so the renderer's deny-all
    // window-open handler routes via shell.openExternal allowlist.
    const win = globalThis.open(DOCKER_LICENSE_URL, "_blank");
    win?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const handleKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        onDismiss();
      }
    };
    document.addEventListener("keydown", handleKey);
    dialogRef.current?.focus();
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, onDismiss]);

  if (!open) return null;

  return (
    <div
      role="presentation"
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm"
      onClick={onDismiss}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="vex-license-title"
        tabIndex={-1}
        className="w-full max-w-md rounded-lg border border-border bg-card p-6 text-card-foreground shadow-lg outline-none"
        onClick={(event) => event.stopPropagation()}
      >
        <h2
          id="vex-license-title"
          className="mb-2 text-lg font-semibold tracking-tight"
        >
          Docker Desktop license
        </h2>
        <p className="mb-3 text-sm text-[var(--color-text-secondary)]">
          Docker Desktop is a third-party product distributed by Docker, Inc.
          Larger commercial and government use may require a paid Docker
          subscription. By downloading and installing it you agree to
          Docker&rsquo;s terms.
        </p>
        <p className="mb-4 text-sm text-[var(--color-text-secondary)]">
          Vex does not manage your Docker license — it only starts and stops
          its own local services through Docker&rsquo;s public CLI.
        </p>
        <button
          type="button"
          onClick={openDocs}
          className="mb-4 text-sm text-primary underline-offset-4 hover:underline"
        >
          Open Docker Desktop license terms
        </button>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" type="button" onClick={onDismiss}>
            Cancel
          </Button>
          <Button type="button" onClick={onAccept}>
            Continue to download
          </Button>
        </div>
      </div>
    </div>
  );
}
