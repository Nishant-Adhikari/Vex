/**
 * Branch: ready — Compose came back with kind="running" or "reused".
 * Pairs a success StatusTile with a one-shot `dotm-hex-3` shimmer that
 * plays on the `running → ready` transition (skipped entirely under
 * reduced-motion). Continue button lives in the orchestrator footer.
 */

import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { HugeiconsIcon } from "@hugeicons/react";
import { CheckmarkCircle01Icon } from "@hugeicons/core-free-icons";
import type { ComposeUpResult } from "@shared/schemas/docker.js";
import { StatusTile } from "../../../../components/onboarding/StatusTile.js";
import { DotmHex3 } from "../../../../components/ui/dotm-hex-3.js";
import { COMPLETION_SHIMMER_MS } from "../constants.js";

interface ReadyBodyProps {
  readonly result: ComposeUpResult;
  /** Passed by the orchestrator on the setPhase that flipped to ready. */
  readonly celebrate: boolean;
}

/**
 * Read `prefers-reduced-motion: reduce` synchronously on first paint.
 * The shared `usePrefersReducedMotion` hook initializes to `false` and
 * resolves the real value in `useEffect`, which leaves a one-frame
 * window where a reduce-motion user could still see the shimmer
 * (codex post-impl SHOULD-FIX #3). Reading matchMedia in a lazy
 * useState initializer closes that window.
 */
function reducedMotionAtMount(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function ReadyBody({ result, celebrate }: ReadyBodyProps): JSX.Element {
  const [showShimmer, setShowShimmer] = useState(
    () => celebrate && !reducedMotionAtMount(),
  );
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!showShimmer) return;
    timerRef.current = window.setTimeout(
      () => setShowShimmer(false),
      COMPLETION_SHIMMER_MS,
    );
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, [showShimmer]);

  const detail =
    result.kind === "reused"
      ? "Existing stack reused — services already healthy."
      : (result.message ?? "All services started and answered health checks.");

  return (
    <div className="flex flex-col items-center gap-4">
      {showShimmer ? (
        <motion.div
          initial={{ opacity: 0, scale: 0.85 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.4, ease: "easeOut" }}
          aria-hidden
        >
          <DotmHex3 size={56} color="var(--vex-onboarding-accent)" />
        </motion.div>
      ) : null}

      <StatusTile
        tone="success"
        icon={
          <HugeiconsIcon icon={CheckmarkCircle01Icon} size={20} aria-hidden />
        }
        title={result.kind === "reused" ? "Stack reused" : "All services ready"}
        detail={detail}
      />
    </div>
  );
}
