/**
 * Docker Desktop license notice modal — shown BEFORE the user triggers
 * an installer download (skill Appendix A + codex turn 4 YELLOW #1).
 *
 * Plain inline modal (no Radix Portal yet — that primitive needs its
 * own CSP audit per MOTION-POLICY.md before adoption). Backdrop
 * deny-clicks outside the dialog so the user must explicitly accept or
 * dismiss.
 *
 * Visual under the onboarding glass aesthetic — stronger backdrop blur
 * + frosted card matching the BootstrapPanel surface + accent color
 * matching `--dockerbootstrap-accent`.
 *
 * No "I have a license" toggle — Vex cannot verify legal state and
 * presenting one would imply a verification it doesn't perform.
 */

import { useCallback, useEffect, useRef } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowUpRight01Icon } from "@hugeicons/core-free-icons";
import { cn } from "../../lib/utils.js";

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
    // Anchor-target so the renderer's deny-all window-open handler
    // routes via the main process `shell.openExternal` allowlist.
    const win = globalThis.open(DOCKER_LICENSE_URL, "_blank");
    win?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    const handleKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        onDismiss();
        return;
      }
      // Focus cycle: keep Tab navigation contained inside the dialog
      // while it's open (codex post-impl SHOULD-FIX #5 — Vex UI rules
      // require actual focus containment, not just initial focus).
      if (event.key !== "Tab" || dialog === null) return;
      const focusable = dialog.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (first === undefined || last === undefined) return;
      const active = document.activeElement;
      // Initial open focuses the dialog container itself (tabIndex=-1).
      // Without this branch, the first Tab/Shift+Tab from there would
      // escape to the page behind. Move focus into the dialog instead
      // (codex post-impl SHOULD-FIX — focus trap escape on dialog body).
      if (active === dialog) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
        return;
      }
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKey);
    dialog?.focus();
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, onDismiss]);

  if (!open) return null;

  return (
    <div
      role="presentation"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xl"
      onClick={onDismiss}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="vex-license-title"
        tabIndex={-1}
        className={cn(
          "w-full max-w-md outline-none",
          "rounded-2xl border border-white/[0.12] bg-white/[0.06] p-6 text-[var(--color-text-primary)] backdrop-blur-2xl",
          "shadow-[inset_0_1px_0_rgba(255,255,255,0.14),inset_0_-1px_0_rgba(0,0,0,0.2),0_18px_60px_rgba(0,0,0,0.5)]",
        )}
        onClick={(event) => event.stopPropagation()}
      >
        <h2
          id="vex-license-title"
          className="mb-2 text-lg font-semibold tracking-tight"
        >
          Docker Desktop license
        </h2>
        <p className="mb-3 text-sm leading-relaxed text-[var(--color-text-secondary)]">
          Docker Desktop is a third-party product distributed by Docker, Inc.
          Larger commercial and government use may require a paid Docker
          subscription. By downloading and installing it you agree to
          Docker&rsquo;s terms.
        </p>
        <p className="mb-4 text-sm leading-relaxed text-[var(--color-text-secondary)]">
          Vex does not manage your Docker license — it only starts and stops
          its own local services through Docker&rsquo;s public CLI.
        </p>
        <button
          type="button"
          onClick={openDocs}
          className="mb-5 inline-flex items-center gap-1 text-sm text-[var(--dockerbootstrap-accent,var(--color-accent-primary))] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--dockerbootstrap-accent,var(--color-accent-primary))] focus-visible:ring-offset-2 focus-visible:ring-offset-transparent"
        >
          Docker Desktop license terms
          <HugeiconsIcon icon={ArrowUpRight01Icon} size={14} aria-hidden />
        </button>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onDismiss}
            className={cn(
              "rounded-lg border border-white/[0.1] bg-white/[0.04] px-4 py-2 font-mono text-xs uppercase tracking-[0.18em] text-[var(--color-text-secondary)] backdrop-blur-md",
              "hover:border-white/[0.2] hover:bg-white/[0.1] hover:text-[var(--color-text-primary)]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--dockerbootstrap-accent,var(--color-accent-primary))] focus-visible:ring-offset-2 focus-visible:ring-offset-transparent",
              "transition-colors duration-150",
            )}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onAccept}
            className={cn(
              "rounded-lg border border-white/[0.16] bg-[var(--dockerbootstrap-accent,var(--color-accent-primary))]/85 px-4 py-2 font-mono text-xs uppercase tracking-[0.18em] text-white backdrop-blur-md",
              "shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_8px_24px_rgba(50,117,248,0.28)]",
              "hover:bg-[var(--dockerbootstrap-accent,var(--color-accent-primary))]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--dockerbootstrap-accent,var(--color-accent-primary))] focus-visible:ring-offset-2 focus-visible:ring-offset-transparent",
              "active:scale-[0.98] transition-all duration-150",
            )}
          >
            Continue to download
          </button>
        </div>
      </div>
    </div>
  );
}
