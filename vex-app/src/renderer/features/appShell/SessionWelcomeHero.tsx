/**
 * Welcome stage — the landing hero (projectvex.ai), recomposed CENTERED over
 * the Signal Sky (phase 5).
 *
 * The stage's WOW is the procedural WebGL dither sky a sibling component
 * mounts BEHIND the session panel — this component paints NO canvas and NO
 * scrim panel of its own; its only imagery is the inline script monogram
 * (/logo_clean.png) inside the status line. It contributes exactly three
 * layers; the absolute ones resolve against the panel's relative frame
 * (`SessionPanel` sets it):
 *
 *   1. VIGNETTE (absolute, decorative): ONE soft bottom gradient to ink
 *      (rgba of --vex-surface-0) so the instrument and chips stay legible
 *      over the sky's brightest flecks.
 *   2. HERO COLUMN (in flow; `mt-auto` bottom-anchors it inside the parent's
 *      flex-1 zone, directly above the docked composer): the landing
 *      .hero-inner grammar — centered mono status line with the live dot,
 *      now carrying the TaglineRotator (rotating brand quips where the word
 *      VEX is the script monogram image), then the H1 as the ONLY display
 *      statement, wearing the landing barcode flicker (.vex-title-barcode).
 *      The H1 "What should I execute?" is test-pinned: a REAL heading with
 *      this exact copy. Nothing else renders above the composer.
 *   3. BOTTOM ROW (absolute at the stage's bottom edge — the parent's
 *      trailing spacer keeps this band clear): the landing .hero-bottom —
 *      barcode strip + LOCAL-FIRST CAPITAL RUNTIME left, YOU SIGN EVERY
 *      ACTION right. The ONLY other copy on the stage.
 *
 * Load-in: the one-shot .vex-rise choreography (status → d1 H1; the parent
 * staggers the instrument at d2 and the chips row at d3; the bottom row
 * closes at d4). Mount-once — the choreography classes on the H1 and the
 * bottom row never re-toggle on re-render; the rotator's phrase swap
 * remounts ONLY its own phrase span (keyed) so each quip replays the same
 * one-shot rise without new keyframes (CSP-safe).
 * Pure presentation: no session state, no composer coupling.
 */

import { useEffect, useState, type JSX } from "react";

/** ~4.2s per quip — long enough to read, short enough to feel alive. */
const TAGLINE_ROTATE_MS = 4200;

/**
 * The word VEX rendered as the script monogram, sized in em so it scales
 * with the phrase's mono type and sunk slightly below the baseline
 * (vertical-align: -0.35em) so the script mark sits like a signature.
 */
function VexMark(): JSX.Element {
  return (
    <img
      src="/logo_clean.png"
      alt="Vex"
      className="inline-block h-[1.35em] w-auto align-[-0.35em] opacity-95"
    />
  );
}

/**
 * Brand quips for the status line. Playful but on-brand (enforcement /
 * proof / local-first). JSX fragments so the monogram can sit mid-sentence;
 * the surrounding text is uppercased by CSS, so source casing stays natural.
 */
const TAGLINES: readonly JSX.Element[] = [
  // No list keys needed: the array is indexed into (one element rendered
  // at a time), never rendered as a children list.
  <>
    Time for <VexMark />
    ing?
  </>,
  <>
    <VexMark />
    ed your thoughts…
  </>,
  <>
    What should <VexMark /> hunt today?
  </>,
  <>
    <VexMark /> is listening.
  </>,
  <>
    <VexMark /> keeps the receipts.
  </>,
];

/** jsdom-safe read — mirrors useLoaderProgress / SignalSky. */
function prefersReducedMotion(): boolean {
  if (
    typeof window === "undefined" ||
    typeof window.matchMedia !== "function"
  ) {
    return false;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Rotating tagline — decorative flavor only. The animated line is
 * aria-hidden (rotation would spam screen readers); a visually-hidden
 * sibling carries the stable "Vex is ready." announcement instead. The
 * phrase span is keyed by index so each swap remounts it and replays the
 * one-shot .vex-rise (no new keyframes; CSP style-src 'self' safe).
 *
 * Reduced motion: the preference is read ONCE at first render (lazy
 * initializer, same trade-off as useLoaderProgress — mid-session preference
 * flips are not tracked) and the interval never starts; the first phrase
 * renders statically. Rotation also pauses while the document is hidden
 * (visibilitychange) so a backgrounded window schedules no work.
 */
function TaglineRotator(): JSX.Element {
  const [staticOnly] = useState(prefersReducedMotion);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (staticOnly) {
      return undefined;
    }

    let intervalId: number | null = null;
    const stop = (): void => {
      if (intervalId !== null) {
        window.clearInterval(intervalId);
        intervalId = null;
      }
    };
    const start = (): void => {
      if (intervalId === null) {
        intervalId = window.setInterval(() => {
          setIndex((current) => (current + 1) % TAGLINES.length);
        }, TAGLINE_ROTATE_MS);
      }
    };
    const onVisibilityChange = (): void => {
      if (document.hidden) {
        stop();
      } else {
        start();
      }
    };

    if (!document.hidden) {
      start();
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [staticOnly]);

  return (
    <>
      {/* key={index}: remount per swap replays the one-shot rise. Inline
       * flow (inline-block, NOT flex) keeps the text + monogram on one
       * shared baseline and preserves the spaces between fragments. */}
      <span
        key={index}
        aria-hidden
        className="vex-rise inline-block whitespace-nowrap font-mono text-[12px] uppercase tracking-[0.2em] text-[var(--vex-text-2)]"
      >
        {TAGLINES[index]}
      </span>
      <span className="sr-only">Vex is ready.</span>
    </>
  );
}

export function SessionWelcomeHero(): JSX.Element {
  return (
    <>
      {/* VIGNETTE — the single gradient layer on the stage: melts the sky
       * into ink at the bottom so the composer group always reads. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-[46%] bg-[linear-gradient(180deg,transparent_0%,rgba(10,13,24,0.42)_52%,rgba(10,13,24,0.88)_100%)]"
      />

      {/* HERO COLUMN — the landing .hero-inner, centered. `mt-auto`
       * bottom-anchors it in the parent's flex-1 zone so it sits directly
       * above the docked composer; the parent's trailing spacer balances
       * the column so hero + instrument center vertically as one group. */}
      <div className="relative z-10 mt-auto flex w-full flex-col items-center px-8 pb-4 text-center">
        <span className="vex-eyebrow vex-rise">
          {/* Live dot — STATIC accent ink: no runtime state reaches this
           * component and .vex-pulse-dot stays reserved for verifiable
           * live/pending states. */}
          <span
            aria-hidden
            className="h-[7px] w-[7px] shrink-0 rounded-full bg-[var(--vex-accent)]"
          />
          <TaglineRotator />
        </span>
        {/* H1 — the only display statement on the stage. Pinned by shell
         * tests: stays a REAL heading with this exact copy. */}
        <h1 className="vex-title-barcode vex-rise vex-rise-d1 mt-6 text-center font-display text-[clamp(44px,6vw,72px)] font-black leading-[0.95] tracking-[-0.025em] text-[var(--vex-text)]">
          What should I execute?
        </h1>
      </div>

      {/* BOTTOM ROW — the landing .hero-bottom at the stage's bottom edge.
       * Copy-only (pointer-events-none keeps the band click-transparent). */}
      <div className="vex-rise vex-rise-d4 pointer-events-none absolute inset-x-0 bottom-0 z-10 flex items-center justify-between gap-6 px-8 pb-5 sm:px-12">
        <span className="flex min-w-0 items-center gap-3 font-mono text-[9px] uppercase tracking-[0.3em] text-[var(--vex-text-3)]">
          <span
            aria-hidden
            className="vex-barcode h-3 w-24 shrink-0 opacity-40"
          />
          <span className="truncate">LOCAL-FIRST CAPITAL RUNTIME</span>
        </span>
        <span className="shrink-0 font-mono text-[9px] uppercase tracking-[0.3em] text-[var(--vex-text-3)]">
          YOU SIGN EVERY ACTION
        </span>
      </div>
    </>
  );
}
