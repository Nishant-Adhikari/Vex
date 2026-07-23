/**
 * Express-lane predicates — the returning-user "loading → unlock" fast path.
 *
 * A RETURNING user (onboarding already complete on this machine) should not
 * have to click Begin / Continue through the healthy setup screens on every
 * relaunch — that is the "~4 clicks to even reach the password field" friction.
 * When a setup step is already in its healthy/ready state AND we are in express
 * mode, the screen auto-advances instead of parking on a button, so the user
 * flows straight through a brief loading sequence to the unlock gate (where
 * Touch ID then auto-prompts).
 *
 * FIRST-RUN is never touched: every predicate short-circuits on
 * `returningUser === false`, so a new user still sees the full onboarding flow
 * with its explicit confirmations. Auto-advance is also strictly gated on a
 * healthy state per step — a returning user whose Docker is down after a reboot
 * still lands on the Docker screen so they can fix it, never skipped past a real
 * problem.
 *
 * These are pure functions so the routing decisions are unit-tested with no
 * component render; the components wire them into effects.
 */

import type { StepStatus } from "../features/systemCheck/StepRow.js";
import type { Branch } from "../features/docker/bootstrap/types.js";
import type { Phase } from "../features/compose/bootstrap/types.js";
import type { View } from "../stores/uiStore.js";

/**
 * Startup routing. A returning user skips the decorative splash ritual and
 * drops straight into the (auto-advancing) setup chain toward unlock; a
 * first-run user starts at the splash. `view: null` means "leave currentView
 * as it is" (the store already defaults to `splash`).
 */
export function resolveStartupRoute(onboardingComplete: boolean): {
  readonly returningUser: boolean;
  readonly view: View | null;
} {
  return onboardingComplete
    ? { returningUser: true, view: "systemCheck" }
    : { returningUser: false, view: null };
}

/**
 * System check auto-advances only when every gating probe is healthy. Network
 * may be "warn" (offline) and still proceed, but the OS, Docker daemon and env
 * flag must be OK so the compose stack downstream has a running daemon to talk
 * to. Anything failing keeps the screen visible so the user can act.
 */
export function shouldExpressAdvanceSystemCheck(input: {
  readonly returningUser: boolean;
  readonly anyLoading: boolean;
  readonly osStatus: StepStatus;
  readonly dockerStatus: StepStatus;
  readonly envStatus: StepStatus;
}): boolean {
  const { returningUser, anyLoading, osStatus, dockerStatus, envStatus } = input;
  if (!returningUser || anyLoading) return false;
  return osStatus === "ok" && dockerStatus === "ok" && envStatus === "ok";
}

/** Docker auto-advances only from the ready branch (engine + daemon running). */
export function shouldExpressAdvanceDocker(
  returningUser: boolean,
  branch: Branch,
): boolean {
  return returningUser && branch === "A";
}

/** Compose auto-advances only once the stack has reached the ready phase. */
export function shouldExpressAdvanceCompose(
  returningUser: boolean,
  phaseKind: Phase["kind"],
): boolean {
  return returningUser && phaseKind === "ready";
}
