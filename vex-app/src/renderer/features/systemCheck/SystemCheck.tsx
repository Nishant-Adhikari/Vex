/**
 * System Check screen — second user-facing surface in the onboarding flow.
 *
 * Visual system mirrors IntroScreen.tsx: a full-bleed anime portrait
 * (`onboarding.png`) covers the viewport, the dark right portion of the
 * image hosts a frosted-glass card with the probe stack, and the Begin-
 * style accent (#3275f8 via `--systemcheck-accent`) carries the same
 * onboarding identity as the intro.
 *
 * Data flow is unchanged: three TanStack Query hooks (`useSystemHealth`,
 * `useDockerStatus`, `useEnvState`) feed four probe rows, each row
 * computes its `StepStatus` from the Result envelope, and the cascade
 * reveal uses the existing `motion-cascade-row` CSS @keyframes (CSP-safe).
 *
 * M11.5.4 — DMR (Docker Model Runner) is no longer surfaced here.
 * vex-app ships its own bundled embeddings runtime via Compose
 * (`embeddings-runtime` service). The `dockerStatusSchema.modelRunner`
 * block is retained unchanged for backward compatibility — the probe
 * still runs but no rendered surface consumes it.
 *
 * CSP: brand icons come from `@thesvg/react` (typed React components,
 * no `dangerouslySetInnerHTML` — `scripts/check-build-artifacts.mjs`
 * rejects that pattern). Generic UI glyphs come from `@hugeicons/react`,
 * already in the bundle.
 */

import { useEffect, useMemo, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Radar02Icon } from "@hugeicons/core-free-icons";

import { useDockerStatus } from "../../lib/api/docker.js";
import { useEnvState } from "../../lib/api/onboarding.js";
import { useSystemHealth } from "../../lib/api/system.js";
import { useUiStore } from "../../stores/uiStore.js";
import { cn } from "../../lib/utils.js";
import { WIZARD_STEP_IDS } from "@shared/schemas/wizard.js";
import { type StepStatus } from "./StepRow.js";
import { platformOf, type Platform } from "./SystemCheck/OperatingSystemIcon.js";
import { ProbeRows } from "./SystemCheck/ProbeRows.js";
import { Footer } from "./SystemCheck/Footer.js";

/**
 * Total onboarding steps surfaced in the "Step X of N" indicator.
 *
 * Composition: 4 top-level views the user passes through after the
 * intro (systemCheck, dockerBootstrap, composeBootstrap, migrations)
 * plus the wizard setup substeps (`WIZARD_STEP_IDS` minus the trailing
 * `review` confirmation, which is not a setup step). Derived from
 * `WIZARD_STEP_IDS` so adding/removing a wizard step does not leave
 * the counter silently drifting (codex round 7 SHOULD-FIX #4).
 */
const SETUP_VIEWS_BEFORE_WIZARD = 4;
const TOTAL_ONBOARDING_STEPS =
  SETUP_VIEWS_BEFORE_WIZARD + (WIZARD_STEP_IDS.length - 1);
const SYSTEM_CHECK_STEP = 1;

export function SystemCheck(): JSX.Element {
  const setCurrentView = useUiStore((s) => s.setCurrentView);
  const reducedMotion = useReducedMotion();
  const health = useSystemHealth();
  const docker = useDockerStatus();
  const env = useEnvState();

  // Under reduced motion render all rows immediately; otherwise stagger
  // them every 80ms for the cascade reveal that pairs with the
  // `motion-cascade-row` CSS animation. If `useReducedMotion()` flips
  // mid-mount (matchMedia change), the effect handles the transition
  // by setting revealCount to 4 directly rather than relying on the
  // initial lazy state (codex round 7-post SHOULD-FIX #3).
  const [revealCount, setRevealCount] = useState(() =>
    reducedMotion ? 4 : 0,
  );

  useEffect(() => {
    if (reducedMotion) {
      setRevealCount(4);
      return;
    }
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (let i = 1; i <= 4; i += 1) {
      timers.push(setTimeout(() => setRevealCount(i), i * 80));
    }
    return () => {
      for (const t of timers) clearTimeout(t);
    };
  }, [reducedMotion]);

  const platform = useMemo<Platform>(
    () => platformOf(health.data?.ok ? health.data.data.os.platform : undefined),
    [health.data],
  );

  const osStatus: StepStatus = health.isPending
    ? "loading"
    : health.data?.ok
      ? "ok"
      : "fail";

  const networkStatus: StepStatus = health.isPending
    ? "loading"
    : health.data?.ok && health.data.data.network.online
      ? "ok"
      : "warn";

  const dockerStatus: StepStatus = docker.isPending
    ? "loading"
    : !docker.data?.ok
      ? "fail"
      : !docker.data.data.endpoint.accepted
        ? "fail"
        : !docker.data.data.engine.present || !docker.data.data.daemon.running
          ? "warn"
          : "ok";

  const envStatus: StepStatus = env.isPending
    ? "loading"
    : !env.data?.ok
      ? "fail"
      : env.data.data.setupCompleteFlag
        ? "ok"
        : "warn";

  const anyLoading = health.isPending || docker.isPending || env.isPending;

  return (
    <div
      data-vex-onboarding="true"
      data-vex-screen="systemCheck"
      className="relative h-screen w-screen overflow-hidden bg-[var(--color-bg-primary)] text-[var(--color-text-primary)]"
    >
      {/* BACKGROUND — full-bleed 16:9 portrait, character left, dark right */}
      <img
        src="/onboarding.png"
        alt=""
        aria-hidden
        draggable={false}
        className="absolute inset-0 h-full w-full object-cover object-center"
      />
      {/* Right-side gradient — deepens the dark area for content legibility */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-gradient-to-r from-transparent via-transparent to-[rgba(5,8,22,0.6)]"
      />

      {/* TOP-RIGHT LOGO — matches the brand mark in IntroScreen */}
      <div className="pointer-events-none absolute right-8 top-6">
        <img
          src="/logo_clean.png"
          alt=""
          aria-hidden
          draggable={false}
          className="h-10 w-10 object-contain drop-shadow-[0_2px_8px_rgba(50,117,248,0.35)]"
        />
      </div>

      {/* CONTENT — right-aligned glass card, vertically centered */}
      <section
        aria-labelledby="systemcheck-heading"
        className="relative ml-auto flex h-full w-[44%] min-w-[420px] max-w-[560px] flex-col items-center justify-center px-8"
      >
        <motion.div
          initial={reducedMotion ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: reducedMotion ? 0 : 0.45, ease: "easeOut" }}
          className={cn(
            "w-full overflow-hidden rounded-3xl border border-white/[0.12] bg-white/[0.05] backdrop-blur-2xl",
            "shadow-[inset_0_1px_0_rgba(255,255,255,0.14),inset_0_-1px_0_rgba(0,0,0,0.2),0_18px_60px_rgba(0,0,0,0.45)]",
          )}
        >
          {/* HEADER */}
          <header className="flex items-start gap-3 border-b border-white/[0.06] px-6 py-5">
            <span
              aria-hidden
              className="flex h-10 w-10 shrink-0 items-center justify-center text-[var(--systemcheck-accent)]"
            >
              <HugeiconsIcon icon={Radar02Icon} size={22} aria-hidden />
            </span>
            <div className="flex flex-col gap-1">
              <h1
                id="systemcheck-heading"
                className="text-xl font-semibold tracking-tight text-[var(--color-text-primary)]"
              >
                System Check
              </h1>
              <p className="text-xs text-[var(--color-text-secondary)]">
                Verifying your environment before bootstrap.
              </p>
            </div>
          </header>

          {/* ROWS */}
          <ProbeRows
            revealCount={revealCount}
            platform={platform}
            osStatus={osStatus}
            networkStatus={networkStatus}
            dockerStatus={dockerStatus}
            envStatus={envStatus}
            health={health}
            docker={docker}
            env={env}
          />

          <Footer
            stepNumber={SYSTEM_CHECK_STEP}
            totalSteps={TOTAL_ONBOARDING_STEPS}
            disabled={anyLoading}
            onContinue={() => setCurrentView("dockerBootstrap")}
          />
        </motion.div>
      </section>

    </div>
  );
}
