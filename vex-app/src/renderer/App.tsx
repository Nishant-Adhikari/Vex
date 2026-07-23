/**
 * Top-level renderer state machine.
 *
 * Flow (Phase 1 onboarding + Phase 2 shell):
 *   splash → systemCheck → dockerBootstrap → composeBootstrap →
 *   migrations → wizard → appShell.
 * The wizard completion screen now routes the user straight into the
 * multi-session app shell (M12) instead of the old M2-era placeholder.
 *
 * The legacy M0 capability/health/security cards are gated behind
 * `import.meta.env.DEV` and are reachable via a dev-only side panel —
 * they are not part of the user-facing flow.
 */

import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import { IntroScreen } from "./features/splash/IntroScreen.js";
import { SystemCheck } from "./features/systemCheck/SystemCheck.js";
import { BootstrapPanel } from "./features/docker/BootstrapPanel.js";
import { ComposeBootstrap } from "./features/compose/ComposeBootstrap.js";
import { Migrations } from "./features/database/Migrations.js";
import { WizardShell } from "./features/wizard/WizardShell.js";
import { AppShell } from "./features/appShell/AppShell.js";
import { UnlockScreen } from "./features/secrets/UnlockScreen.js";
import { UpdateLayer } from "./features/updates/UpdateLayer.js";
import { useUiStore, type View } from "./stores/uiStore.js";
import { resolveStartupRoute } from "./lib/express-lane.js";
import type { Capabilities } from "../shared/schemas/capabilities.js";
import type { HealthReport } from "../shared/schemas/system.js";

export function App(): JSX.Element {
  const currentView = useUiStore((s) => s.currentView);
  const setCurrentView = useUiStore((s) => s.setCurrentView);
  const setReturningUser = useUiStore((s) => s.setReturningUser);

  // Startup gate: before painting any onboarding screen, ask the main process
  // whether onboarding is already complete on this machine. A RETURNING user
  // skips the decorative splash ritual and drops into the (auto-advancing)
  // setup chain toward the unlock gate — collapsing the old "~4 clicks to reach
  // the password field" into a brief loading state. A first-run user falls
  // through to the normal `splash` default. The check is a fast local file
  // probe; if it fails we degrade to the first-run flow (splash) rather than
  // trapping the user on a spinner.
  const [booting, setBooting] = useState(true);
  const bootedRef = useRef(false);
  useEffect(() => {
    if (bootedRef.current) return;
    bootedRef.current = true;
    let cancelled = false;
    void window.vex.capabilities
      .get()
      .then((result) => {
        if (cancelled) return;
        const onboardingComplete = result.ok && result.data.onboardingComplete;
        const route = resolveStartupRoute(onboardingComplete);
        setReturningUser(route.returningUser);
        if (route.view !== null) setCurrentView(route.view);
      })
      .finally(() => {
        if (!cancelled) setBooting(false);
      });
    return () => {
      cancelled = true;
    };
  }, [setCurrentView, setReturningUser]);

  const handleSplashComplete = useCallback(() => {
    setCurrentView("systemCheck");
  }, [setCurrentView]);

  // Dispatch map keeps view routing flat: adding a view = one entry,
  // not a new ternary branch. Keep the map inline (no separate registry
  // module) until M7+ wizard step views need real per-step prop wiring
  // or lazy loading (codex turn 4).
  const views: Record<View, () => JSX.Element> = {
    splash: () => <IntroScreen onComplete={handleSplashComplete} />,
    systemCheck: () => <SystemCheck />,
    dockerBootstrap: () => <BootstrapPanel />,
    composeBootstrap: () => <ComposeBootstrap />,
    migrations: () => <Migrations />,
    wizard: () => <WizardShell />,
    unlock: () => <UnlockScreen />,
    appShell: () => <AppShell />,
  };

  return (
    <>
      {booting ? <BootGate /> : views[currentView]()}
      {/* Global, view-independent: a user-triggered update prompt can appear
          over any screen. No-ops when the updater bridge is absent. */}
      <UpdateLayer />
      {import.meta.env.DEV ? <DevDiagnostics /> : null}
    </>
  );
}

/**
 * Neutral startup spinner shown while the capabilities probe decides whether
 * this is a first-run or a returning user. Deliberately quiet and brief — it
 * replaces the flash of the splash ritual for returning users and is gone in a
 * few frames once the local probe resolves. Wears the shared onboarding ink so
 * there is no jarring surface change into the next screen.
 */
function BootGate(): JSX.Element {
  return (
    <main
      data-vex-onboarding="true"
      data-vex-screen="boot"
      aria-busy="true"
      className="flex h-screen w-screen items-center justify-center bg-[var(--vex-onboarding-bg)]"
    >
      <span
        aria-hidden
        className="h-6 w-6 animate-spin rounded-full border-2 border-white/15 border-t-white/70"
      />
      <span className="sr-only">Starting Vex…</span>
    </main>
  );
}

/**
 * Dev-only floating panel that surfaces the M0 IPC health probes. Hidden
 * in production builds via `import.meta.env.DEV`, which Vite tree-shakes
 * out of the bundle.
 */
function DevDiagnostics(): JSX.Element | null {
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [health, setHealth] = useState<HealthReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      try {
        const [capsResult, healthResult] = await Promise.all([
          window.vex.capabilities.get(),
          window.vex.system.health(),
        ]);
        if (cancelled) return;
        if (capsResult.ok) setCapabilities(capsResult.data);
        else setError(`capabilities: ${capsResult.error.message}`);
        if (healthResult.ok) setHealth(healthResult.data);
        else setError(`health: ${healthResult.error.message}`);
      } catch (e: unknown) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Unknown error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  return (
    <div className="fixed bottom-4 right-4 z-50">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="rounded-md border border-border bg-card px-2 py-1 text-[10px] font-mono uppercase tracking-wider text-[var(--color-text-secondary)] hover:text-foreground"
      >
        dev · {open ? "hide" : "diagnostics"}
      </button>
      {open ? (
        <section className="mt-2 w-72 rounded-md border border-border bg-card p-3 text-xs">
          <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-secondary)]">
            M0 diagnostics
          </h2>
          {capabilities ? (
            <ul className="mb-2 space-y-0.5 font-mono">
              <li>phase: {capabilities.phase}</li>
              <li>app: {capabilities.appVersion}</li>
              <li>onboarded: {String(capabilities.onboardingComplete)}</li>
            </ul>
          ) : null}
          {health ? (
            <ul className="mb-2 space-y-0.5 font-mono">
              <li>os: {health.os.platform}/{health.os.arch}</li>
              <li>electron: {health.os.electronVersion}</li>
              <li>net: {health.network.online ? "online" : "offline"}</li>
              <li>overall: {health.overall}</li>
            </ul>
          ) : null}
          <ul className="space-y-0.5 font-mono">
            <li>require: {typeof (window as unknown as { require?: unknown }).require}</li>
            <li>process: {typeof (window as unknown as { process?: unknown }).process}</li>
            <li>vex: {typeof window.vex}</li>
          </ul>
          {error ? <p className="mt-2 text-destructive">{error}</p> : null}
        </section>
      ) : null}
    </div>
  );
}
