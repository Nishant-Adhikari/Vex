/**
 * Welcome stage — the landing hero (projectvex.ai), recomposed CENTERED over
 * the Signal Sky (phase 5).
 *
 * The stage's WOW is the procedural WebGL dither sky a sibling component
 * mounts BEHIND the session panel — this component paints NO canvas, NO
 * imagery and NO scrim panel of its own. It contributes exactly three
 * layers; the absolute ones resolve against the panel's relative frame
 * (`SessionPanel` sets it):
 *
 *   1. VIGNETTE (absolute, decorative): ONE soft bottom gradient to ink
 *      (rgba of --vex-surface-0) so the instrument and chips stay legible
 *      over the sky's brightest flecks.
 *   2. HERO COLUMN (in flow; `mt-auto` bottom-anchors it inside the parent's
 *      flex-1 zone, directly above the docked composer): the landing
 *      .hero-inner grammar — centered mono status line with the live dot,
 *      then the H1 as the ONLY display statement, wearing the landing
 *      barcode flicker (.vex-title-barcode). The H1 "What should I execute?"
 *      is test-pinned: a REAL heading with this exact copy. Nothing else
 *      renders above the composer.
 *   3. BOTTOM ROW (absolute at the stage's bottom edge — the parent's
 *      trailing spacer keeps this band clear): the landing .hero-bottom —
 *      barcode strip + LOCAL-FIRST CAPITAL RUNTIME left, YOU SIGN EVERY
 *      ACTION right. The ONLY other copy on the stage.
 *
 * Load-in: the one-shot .vex-rise choreography (status → d1 H1; the parent
 * staggers the instrument at d2 and the chips row at d3; the bottom row
 * closes at d4). Mount-once — the classes never re-toggle on re-render.
 * Pure presentation: no session state, no composer coupling.
 */

import type { JSX } from "react";

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
          Register open
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
