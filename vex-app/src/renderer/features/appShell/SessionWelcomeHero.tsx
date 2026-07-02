/**
 * Welcome hero — the register head of THE PROTOCOL DESK (S2 rebrand).
 *
 * Composer-hero layout: hallmark → status overline → plinth rule → H1 →
 * subline. The parent (`SessionPanel`) centers the column; the composer +
 * trust line + starter rows render below it. Pure presentation: no session
 * state, no draft state, no composer coupling. The old poster headline
 * ("Your chain. Your rules. I execute.") retired into the SessionCreator
 * ceremony subline; the trust badges became the composer's letterpress line.
 */

import type { JSX } from "react";
import { DotmHex3 } from "../../components/ui/dotm-hex-3.js";

export function SessionWelcomeHero(): JSX.Element {
  return (
    <>
      {/* HALLMARK — same mark language as onboarding's NotaryPage, no glow. */}
      <img
        src="/logo_clean.png"
        alt=""
        draggable={false}
        className="mx-auto h-14 w-auto opacity-90"
      />

      {/* OVERLINE — static register status. The hex matrix is aria-hidden
       * here because it is decoration, not machine work (DotMatrix only
       * animates for verifiable in-flight work). */}
      <div className="mt-6 flex items-center justify-center gap-2.5">
        <span aria-hidden>
          <DotmHex3
            size={16}
            dotSize={2.5}
            color="var(--vex-accent)"
            animated={false}
          />
        </span>
        <span className="font-mono text-[10px] uppercase tracking-[0.35em] text-[var(--vex-text-3)]">
          Register open — no entries today
        </span>
      </div>

      {/* PLINTH RULE — onboarding's plinth carried forward: full hairline
       * with a 24px accent tick centered under the idle mark. */}
      <div aria-hidden className="relative mt-4 h-px w-full bg-[var(--vex-line)]">
        <span className="absolute -top-px left-1/2 h-px w-6 -translate-x-1/2 bg-[var(--vex-accent)]" />
      </div>

      {/* Centered idle landing — the register head sits in the middle of the
       * screen (the left-anchored tape only applies once a session is live).
       * Display voice: Archivo bold with the landing's tight tracking. */}
      <h1 className="mt-7 text-center font-display text-[30px] font-bold leading-[1.1] tracking-[-0.02em] text-foreground">
        What should I execute?
      </h1>

      <p className="mx-auto mt-3 max-w-[52ch] text-center text-sm leading-relaxed text-foreground">
        Type below. Everything runs locally — on-chain actions always wait for
        your signature.
      </p>

      {/* BARCODE STRIP — the landing's print-shop artifact under the subline.
       * currentColor-driven bars at whisper opacity: chrome, never content. */}
      <div className="mt-6 flex flex-col items-center gap-2 text-[var(--vex-text-3)]">
        <div aria-hidden className="vex-barcode h-3 w-20 opacity-40" />
        <span className="font-mono text-[9px] uppercase tracking-[0.3em]">
          Local-first capital runtime
        </span>
      </div>
    </>
  );
}
