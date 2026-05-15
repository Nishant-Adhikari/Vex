/**
 * Compose bootstrap surface — 3rd user-facing screen in the onboarding
 * flow. Runs `composeUpAbortable`, parses the streamed log lines into
 * per-service substate, dispatches to the right branch body based on
 * the IPC result kind, and (on success) lets the user continue to the
 * migrations screen.
 *
 * Visual system inherits the onboarding glass aesthetic
 * (data-vex-onboarding wrapper, full-bleed `setup.png` background,
 * right-side iOS Liquid Glass panel, electric-blue
 * `--vex-onboarding-accent`). Per-branch render delegates to the body
 * components in `bootstrap/branches/`; shared primitives come from
 * `components/onboarding/`.
 *
 * Cancellation contract (PR3 — `vex:cancel` IPC) is preserved verbatim:
 * the Cancel button calls the `cancel` handle returned by
 * `composeUpAbortable`. We DO NOT call cancel() from the effect cleanup
 * function — React StrictMode double-mount would race the cancel
 * against the main-process single-flight join. The cleanup `cancelled`
 * flag only suppresses stale promise resolutions; user-initiated
 * cancellation goes through the button. Tests in
 * `__tests__/ComposeBootstrap.test.tsx` pin this contract.
 *
 * Log parser is COSMETIC ONLY (codex plan v2): it feeds per-service
 * pill substate but never flips the orchestrator phase — phase
 * transitions are driven solely by the IPC `ComposeUpResult.kind`
 * discriminator.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Docker } from "@thesvg/react";
import type { ComposeLog } from "@shared/schemas/docker.js";

import { useUiStore } from "../../stores/uiStore.js";
import { cn } from "../../lib/utils.js";
import { ContinueButton } from "../../components/onboarding/FooterButtons.js";
import {
  COMPOSE_BOOTSTRAP_STEP,
  COMPOSE_LOG_BUFFER_MAX,
  TOTAL_ONBOARDING_STEPS,
} from "./bootstrap/constants.js";
import type { Phase } from "./bootstrap/types.js";
import {
  parseComposeLog,
  type ParsedLogEvent,
} from "./bootstrap/parseComposeLog.js";
import { useAggregatedServiceState } from "./bootstrap/useAggregatedServiceState.js";
import { RunningBody } from "./bootstrap/branches/RunningBody.js";
import { ReadyBody } from "./bootstrap/branches/ReadyBody.js";
import { PortCollisionBody } from "./bootstrap/branches/PortCollisionBody.js";
import { UnhealthyBody } from "./bootstrap/branches/UnhealthyBody.js";
import { FailedBody } from "./bootstrap/branches/FailedBody.js";
import { CancelledBody } from "./bootstrap/branches/CancelledBody.js";

export function ComposeBootstrap(): JSX.Element {
  const setCurrentView = useUiStore((s) => s.setCurrentView);
  const reducedMotion = useReducedMotion();
  const [logs, setLogs] = useState<ReadonlyArray<ComposeLog>>([]);
  const [phase, setPhase] = useState<Phase>({ kind: "running" });
  const [retryToken, setRetryToken] = useState(0);
  const cancelRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    let cancelled = false;
    setPhase({ kind: "running" });

    const invocation = window.vex.docker.composeUpAbortable({});
    cancelRef.current = invocation.cancel;

    void (async () => {
      try {
        const result = await invocation.promise;
        if (cancelled) return;
        if (!result.ok) {
          if (result.error.code === "internal.cancelled") {
            setPhase({ kind: "error.cancelled" });
          } else {
            setPhase({
              kind: "error.failed",
              message: result.error.message,
            });
          }
          return;
        }
        const data = result.data;
        switch (data.kind) {
          case "running":
          case "reused":
            // `celebrate` flag carries the one-shot completion shimmer
            // signal explicitly through state (codex post-impl SHOULD-FIX
            // #4 — render-mutation of a prev-phase ref was non-pure).
            setPhase({ kind: "ready", result: data, celebrate: true });
            return;
          case "port_collision":
            setPhase({
              kind: "error.port_collision",
              message: data.message,
            });
            return;
          case "unhealthy":
            setPhase({ kind: "error.unhealthy", message: data.message });
            return;
          case "failed":
            setPhase({ kind: "error.failed", message: data.message });
            return;
        }
      } catch (err: unknown) {
        if (cancelled) return;
        setPhase({
          kind: "error.failed",
          message: err instanceof Error ? err.message : "Unknown error",
        });
      }
    })();

    return () => {
      cancelled = true;
      // Intentionally NOT calling invocation.cancel() — StrictMode
      // double-mount race; user-initiated cancellation goes through
      // the button handler. See header comment.
      cancelRef.current = null;
    };
  }, [retryToken]);

  useEffect(() => {
    const off = window.vex.docker.onComposeLog((payload) => {
      setLogs((prev) =>
        [...prev, payload].slice(-COMPOSE_LOG_BUFFER_MAX),
      );
    });
    return () => off();
  }, []);

  const parsedEvents = useMemo<readonly ParsedLogEvent[]>(() => {
    const out: ParsedLogEvent[] = [];
    for (const log of logs) {
      const parsed = parseComposeLog(log.line);
      if (parsed !== null) out.push(parsed);
    }
    return out;
  }, [logs]);

  const services = useAggregatedServiceState(parsedEvents);

  const handleRetry = useCallback((): void => {
    setLogs([]);
    setRetryToken((n) => n + 1);
  }, []);

  const handleCancel = useCallback((): void => {
    const cancel = cancelRef.current;
    if (cancel === null) return;
    setPhase({ kind: "cancelling" });
    cancel();
  }, []);

  const handleContinue = useCallback((): void => {
    setCurrentView("migrations");
  }, [setCurrentView]);

  const recentLogLines = useMemo<readonly string[]>(
    () => logs.map((l) => l.line),
    [logs],
  );

  return (
    <div
      data-vex-onboarding="true"
      data-vex-screen="composeBootstrap"
      className="relative h-screen w-screen overflow-hidden bg-[var(--color-bg-primary)] text-[var(--color-text-primary)]"
    >
      <img
        src="/setup.png"
        alt=""
        aria-hidden
        draggable={false}
        className="absolute inset-0 h-full w-full object-cover object-center"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-gradient-to-r from-transparent via-transparent to-[rgba(5,8,22,0.6)]"
      />

      <div className="pointer-events-none absolute right-8 top-6">
        <img
          src="/logo_clean.png"
          alt=""
          aria-hidden
          draggable={false}
          className="h-10 w-10 object-contain drop-shadow-[0_2px_8px_rgba(50,117,248,0.35)]"
        />
      </div>

      <section
        aria-labelledby="composebootstrap-heading"
        className="relative ml-auto flex h-full w-[44%] min-w-[420px] max-w-[560px] flex-col items-center justify-center px-8"
      >
        <motion.div
          initial={reducedMotion ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: reducedMotion ? 0 : 0.45, ease: "easeOut" }}
          className={cn(
            "flex w-full max-h-[88vh] flex-col overflow-hidden rounded-3xl border border-white/[0.12] bg-white/[0.05] backdrop-blur-2xl",
            "shadow-[inset_0_1px_0_rgba(255,255,255,0.14),inset_0_-1px_0_rgba(0,0,0,0.2),0_18px_60px_rgba(0,0,0,0.45)]",
          )}
        >
          <header className="flex items-start gap-3 border-b border-white/[0.06] px-6 py-5">
            <span
              aria-hidden
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/[0.1] bg-[var(--vex-onboarding-accent)]/15 text-[var(--vex-onboarding-accent)]"
            >
              <Docker width={24} height={24} aria-hidden />
            </span>
            <div className="flex flex-col gap-1">
              <h1
                id="composebootstrap-heading"
                className="text-xl font-semibold tracking-tight text-[var(--color-text-primary)]"
              >
                Starting Vex services
              </h1>
              <p className="text-xs text-[var(--color-text-secondary)]">
                Postgres + embeddings are coming up locally through Docker.
              </p>
            </div>
          </header>

          <div className="flex-1 overflow-y-auto px-5 py-5">
            {phase.kind === "running" || phase.kind === "cancelling" ? (
              <RunningBody
                services={services}
                onCancel={handleCancel}
                cancelling={phase.kind === "cancelling"}
              />
            ) : phase.kind === "ready" ? (
              <ReadyBody
                result={phase.result}
                celebrate={phase.celebrate}
              />
            ) : phase.kind === "error.port_collision" ? (
              <PortCollisionBody
                message={phase.message}
                onRetry={handleRetry}
              />
            ) : phase.kind === "error.unhealthy" ? (
              <UnhealthyBody message={phase.message} onRetry={handleRetry} />
            ) : phase.kind === "error.failed" ? (
              <FailedBody
                message={phase.message}
                recentLogs={recentLogLines}
                onRetry={handleRetry}
              />
            ) : phase.kind === "error.cancelled" ? (
              <CancelledBody onRetry={handleRetry} />
            ) : null}
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-white/[0.06] px-6 py-4">
            <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-[var(--color-text-muted)]">
              Step {COMPOSE_BOOTSTRAP_STEP} of {TOTAL_ONBOARDING_STEPS}
            </span>
            {phase.kind === "ready" ? (
              <ContinueButton onClick={handleContinue} />
            ) : null}
          </div>
        </motion.div>
      </section>
    </div>
  );
}
