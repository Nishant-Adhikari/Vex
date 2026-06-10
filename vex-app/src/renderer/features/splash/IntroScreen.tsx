/**
 * IntroScreen — "Countersign" boot ritual, first user-facing surface.
 *
 * Concept: the Vex mark IS a signature, and the product's core contract is
 * "the agent acts autonomously, execution waits for the human". The boot
 * stages that contract: during init the signature writes itself left→right
 * (a clip-wipe over the lit mark layer, with a travelling nib light riding
 * the wipe edge); the plinth hairline beneath it is the progressbar. At
 * 100% a single one-shot glint fires on the star the mark already carries,
 * the SIGNING readout crossfades into the Begin key inside the same fixed
 * slot (zero layout shift) — the agent has signed; Begin is the user's
 * countersignature. After boot: absolute stillness, nothing loops.
 *
 * Chosen over two runner-up variants ("The Touch" bid/ask convergence and
 * "First Light" showroom light pass) in the June 2026 design review.
 *
 * Chrome discipline ("the room exists before the ink"): overline, ghost
 * mark, plinth track, microcopy and version render at final opacity from
 * the first frame. Only the ink wipe, nib, readout digits, glint and the
 * Begin reveal animate.
 *
 * A11y: the plinth carries role="progressbar" (persists after ready so
 * aria-valuenow=100 stays queryable); the readout is aria-hidden (it
 * duplicates the same value). Begin receives focus on reveal — click is
 * the only dismiss, no auto-fallback (confirmed UX decision).
 *
 * Reduced motion: `useLoaderProgress` jumps to 100 — full signature, no
 * nib, Begin immediately (still requires click).
 *
 * CSP: progress-bound visuals are single-property inline styles driven by
 * ONE clock (clip-path wipe, nib `left`, plinth width and readout digits
 * all derive from the same `progress` value, so they cannot drift); the
 * one-shot glint is a stylesheet @keyframes. Do NOT add `'unsafe-inline'`
 * (scripts/check-build-artifacts rejects it).
 *
 * Asset note: the left→right wipe is the documented PNG fallback of the
 * SVG stroke-draw ("ink follows the letterforms"). When logo_clean.png is
 * traced to SVG stroke paths, swap the lit layer for a stroke-dashoffset
 * draw and keep everything else unchanged.
 */

import { useCallback, useEffect, useRef } from "react";
import { motion, useReducedMotion } from "motion/react";

import { cn } from "../../lib/utils.js";
import {
  ONBOARDING_COLUMN_CLASS,
  ONBOARDING_KEY_SLOT_CLASS,
} from "../../components/onboarding/geometry.js";
import { useLoaderProgress } from "./useLoaderProgress.js";

export interface IntroScreenProps {
  readonly onComplete: () => void;
  readonly loaderDurationMs?: number;
}

const DEFAULT_LOADER_DURATION_MS = 3500;

export function IntroScreen({
  onComplete,
  loaderDurationMs = DEFAULT_LOADER_DURATION_MS,
}: IntroScreenProps): JSX.Element {
  const reducedMotion = useReducedMotion();
  const progress = useLoaderProgress(loaderDurationMs);
  const ready = progress >= 100;
  const beginRef = useRef<HTMLButtonElement>(null);
  // Guards against rapid double-click on Begin. App.tsx setCurrentView is
  // idempotent today, but Begin is the only exit and may later gain
  // telemetry / bootstrap side effects (codex round 6 P3 hardening).
  const completedRef = useRef(false);
  // Clamp displayed percentage to 99 until `ready` flips true. Without this
  // `Math.round(99.6)` would announce "100%" while Begin is still absent —
  // a single-frame desync between the progressbar's aria-valuenow and the
  // visual CTA state.
  const progressRounded = ready ? 100 : Math.min(99, Math.round(progress));

  // Move focus to Begin once it appears so keyboard users can hit
  // Enter/Space immediately — without auto-dismiss this is the only exit.
  useEffect(() => {
    if (ready) {
      beginRef.current?.focus();
    }
  }, [ready]);

  const handleBegin = useCallback(() => {
    if (completedRef.current) return;
    completedRef.current = true;
    onComplete();
  }, [onComplete]);

  return (
    <div
      data-vex-onboarding="true"
      data-vex-screen="intro"
      className="relative h-screen w-screen overflow-hidden bg-[var(--intro-bg)] text-[var(--color-text-primary)]"
    >
      <section
        aria-labelledby="intro-heading"
        className="relative flex h-full w-full flex-col items-center justify-center"
      >
        <h1 id="intro-heading" className="sr-only">
          Vex
        </h1>

        {/* OVERLINE — static from frame one (chrome never animates). */}
        <span className="font-sans text-[11px] uppercase tracking-[0.32em] text-[var(--color-text-muted)] opacity-70">
          AI-Powered Clarity Engine
        </span>

        {/* SIGNATURE — ghost layer always present (the mark exists in the
         * dark before the ink reaches it); lit layer revealed left→right by
         * the clip wipe; nib light rides the wipe edge while signing. */}
        <div className="relative mt-8 h-[clamp(240px,38vh,420px)] w-[clamp(240px,38vh,420px)]">
          <img
            src="/logo_clean.png"
            alt=""
            aria-hidden
            draggable={false}
            className="absolute inset-0 h-full w-full object-contain opacity-[0.12]"
          />
          <img
            src="/logo_clean.png"
            alt=""
            aria-hidden
            draggable={false}
            className="absolute inset-0 h-full w-full object-contain drop-shadow-[0_4px_24px_color-mix(in_oklab,var(--intro-accent)_18%,transparent)]"
            style={{ clipPath: `inset(0 ${100 - progress}% 0 0)` }}
          />
          {!ready ? (
            <div
              aria-hidden
              className="pointer-events-none absolute inset-y-[8%] w-[2px] -translate-x-1/2 rounded-full bg-gradient-to-b from-transparent via-[rgba(238,240,255,0.9)] to-transparent shadow-[0_0_14px_2px_color-mix(in_oklab,var(--intro-accent)_35%,transparent)]"
              style={{ left: `${progress}%` }}
            />
          ) : null}
          {/* One glint, once, on the star the mark already has — position
           * matches the sparkle in logo_clean.png (tune visually on DPI QA). */}
          {ready ? (
            <span
              aria-hidden
              className="vex-intro-glint pointer-events-none absolute left-[74%] top-[22%] h-1.5 w-1.5 rounded-full bg-white opacity-0 shadow-[0_0_18px_6px_rgba(238,240,255,0.6)]"
            />
          ) : null}
        </div>

        {/* PLINTH — the line the signature stands on IS the progressbar.
         * It persists after ready (resting underline of the mark), keeping
         * aria-valuenow=100 queryable. Negative margin pulls it into the
         * PNG's transparent bottom padding, close under the visual mark. */}
        <div
          role="progressbar"
          aria-valuenow={progressRounded}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Initializing Vex"
          className={cn(
            "relative -mt-6 h-px overflow-hidden bg-white/[0.08]",
            ONBOARDING_COLUMN_CLASS
          )}
        >
          <div
            className="h-full bg-[var(--intro-accent)]"
            style={{ width: `${progress}%` }}
          />
        </div>

        {/* SLOT 208×44 — SIGNING readout becomes the Begin key in place.
         * Fixed geometry: zero layout shift; focus arrives where the eye
         * already rests. The readout is aria-hidden (decorative duplicate
         * of the plinth's aria-valuenow). */}
        <div
          className={cn(
            "relative mt-9 flex items-center justify-center",
            ONBOARDING_KEY_SLOT_CLASS
          )}
        >
          {ready ? (
            <motion.button
              ref={beginRef}
              type="button"
              onClick={handleBegin}
              aria-label="Begin Vex"
              initial={reducedMotion ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: reducedMotion ? 0 : 0.24, ease: "easeOut" }}
              className={cn(
                "inline-flex h-full w-full items-center justify-center rounded-xl",
                "border border-[color-mix(in_oklab,var(--intro-accent)_55%,transparent)] bg-white/[0.03]",
                "font-sans text-[13px] font-medium uppercase tracking-[0.18em] text-[var(--intro-accent)]",
                "transition-colors duration-200 ease-out",
                "hover:border-[color-mix(in_oklab,var(--intro-accent)_85%,transparent)] hover:bg-[color-mix(in_oklab,var(--intro-accent)_8%,transparent)]",
                "active:scale-[0.98]",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--intro-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--intro-bg)]"
              )}
            >
              Begin
            </motion.button>
          ) : (
            <span
              aria-hidden
              className="font-mono text-[11px] uppercase tracking-[0.14em]"
            >
              <span className="text-[var(--color-text-muted)] opacity-60">
                Signing
              </span>{" "}
              <span className="tabular-nums text-[var(--color-text-secondary)]">
                {String(progressRounded).padStart(3, "0")}
              </span>
            </span>
          )}
        </div>
      </section>

      {/* MICROCOPY — brand tetrad from the vex-theme boards, bottom-left. */}
      <div className="pointer-events-none absolute bottom-7 left-10">
        <span className="font-mono text-[10px] uppercase tracking-[0.4em] text-[var(--color-text-muted)] opacity-60">
          Clarity · Focus · Understand · Evolve
        </span>
      </div>

      {/* VERSION — bottom-right, quiet. */}
      <footer className="absolute bottom-7 right-10 font-mono text-[10px] uppercase tracking-[0.3em] text-[var(--color-text-muted)] opacity-60">
        <span>v{__VEX_APP_VERSION__}</span>
      </footer>
    </div>
  );
}
