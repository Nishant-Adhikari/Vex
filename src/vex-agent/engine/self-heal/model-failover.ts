/**
 * Overnight self-heal — model failover (OV2).
 *
 * When the PRIMARY model has failed the configured number of consecutive times
 * (see `SELF_HEAL_FAILOVER_THRESHOLD`), a self-heal resume switches the active
 * model to the configured backup (`AGENT_MODEL_FALLBACK`, e.g. gemini-2.5-flash)
 * so a whole-model / provider-route outage does not strand the mission.
 *
 * Mechanism (mirrors the existing `switchProvider` precedent, which already
 * mutates `process.env` + resets the cached provider): we swap
 * `process.env.AGENT_MODEL` to the backup and reset the provider registry so
 * the NEXT `resolveProvider()` — which the resume path calls — rebuilds on the
 * backup. The primary value is captured on first failover so it can be restored.
 *
 * Applied at RESUME time (in the wake handler), keyed off the wake payload's
 * `failover` flag, NOT from the watchdog tick — this ties the env state to the
 * single serialized resume the wake executor performs, so there is no
 * watchdog/executor race over the global model.
 *
 * SCOPE NOTE: `process.env.AGENT_MODEL` is process-global, so other env-reading
 * workers (memory-manager / regime / compact) also pick up the backup while a
 * failover is active. That is acceptable and bounded — at most one mission runs
 * at a time, the backup is a first-class configured model, and `restorePrimary`
 * flips everything back the moment a non-failover resume runs. Changes ONLY the
 * inference model; never any trade target, sizing, or scoring input.
 */

import logger from "@utils/logger.js";
import { resetProvider } from "@vex-agent/inference/registry.js";
import { resolveFallbackModel } from "./policy.js";

/** Captured primary model, set on the first failover; null when not failed over. */
let capturedPrimaryModel: string | null = null;

/** True while the active model is the failover backup. */
export function isFailedOver(): boolean {
  return capturedPrimaryModel !== null;
}

/**
 * Switch the active model to the configured backup for subsequent resumes.
 * Idempotent — a no-op when already failed over or when no backup is configured
 * (returns `false` in both of those "did nothing" cases). Fail-soft: never
 * throws.
 */
export function applyModelFailover(
  env: Record<string, string | undefined> = process.env,
): boolean {
  try {
    if (capturedPrimaryModel !== null) return false; // already failed over
    const fallback = resolveFallbackModel(env);
    if (fallback === null) return false; // nothing to fail over to
    const primary = env.AGENT_MODEL?.trim() ?? null;
    if (primary !== null && primary === fallback) return false; // same model

    capturedPrimaryModel = primary ?? "";
    env.AGENT_MODEL = fallback;
    resetProvider();
    logger.warn("engine.self_heal.model_failover_applied", {
      from: primary,
      to: fallback,
    });
    return true;
  } catch (err) {
    logger.error("engine.self_heal.model_failover_error", {
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

/**
 * Restore the primary model captured at failover time. Idempotent — a no-op
 * when not currently failed over (returns `false`). Fail-soft: never throws.
 */
export function restorePrimaryModel(
  env: Record<string, string | undefined> = process.env,
): boolean {
  try {
    if (capturedPrimaryModel === null) return false;
    const primary = capturedPrimaryModel;
    capturedPrimaryModel = null;
    if (primary.length > 0) {
      env.AGENT_MODEL = primary;
    } else {
      delete env.AGENT_MODEL;
    }
    resetProvider();
    logger.info("engine.self_heal.model_failover_restored", { to: primary || null });
    return true;
  } catch (err) {
    logger.error("engine.self_heal.model_restore_error", {
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

/** Test-only reset of module state. */
export function __resetFailoverStateForTests(): void {
  capturedPrimaryModel = null;
}
