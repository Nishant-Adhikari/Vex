/**
 * Self-improving strategy loop — configuration (env-driven, SAFETY-CRITICAL
 * defaults).
 *
 * Two independent OFF-by-default safety switches:
 *   - KILL SWITCH (`VEX_STRATEGY_AUTOTUNE_ENABLED`, default OFF): when off, NO
 *     rewrite is generated at finalize; missions run under the currently-active
 *     (baseline until a human approves one) adaptive section. This is the master
 *     disable.
 *   - APPROVAL POSTURE (`VEX_STRATEGY_AUTOTUNE_AUTO_APPROVE`, default OFF): even
 *     with the loop enabled, a revision is stored PENDING and requires ONE human
 *     approval before it becomes the live strategy. Only flip this to full-auto
 *     once the loop is trusted. This is STRICTER than the kill switch — the
 *     default is propose-then-approve, not silent-auto.
 *
 * The guardrail knobs (recurrence threshold, delta / baseline distance bounds,
 * flip-flop window, recent-mission window) are overridable for tuning but ship
 * with conservative defaults.
 */

import {
  DEFAULT_GUARDRAIL_CONFIG,
  type GuardrailConfig,
} from "@vex-agent/engine/mission/strategy-guardrails.js";

export interface StrategyLoopConfig {
  /** Master kill switch — when false the loop never runs a rewrite. */
  readonly enabled: boolean;
  /** When false (default) a revision is PENDING until a human approves it. */
  readonly autoApprove: boolean;
  /** How many recent finalized missions to pull for recurrence + digest. */
  readonly recentMissionWindow: number;
  readonly guardrails: GuardrailConfig;
}

function boolEnv(env: NodeJS.ProcessEnv, key: string, dflt: boolean): boolean {
  const raw = env[key];
  if (raw === undefined) return dflt;
  const v = raw.trim().toLowerCase();
  if (v === "1" || v === "true" || v === "yes" || v === "on") return true;
  if (v === "0" || v === "false" || v === "no" || v === "off") return false;
  return dflt;
}

function numEnv(env: NodeJS.ProcessEnv, key: string, dflt: number): number {
  const raw = env[key];
  if (raw === undefined) return dflt;
  const n = Number(raw);
  return Number.isFinite(n) ? n : dflt;
}

/** Resolve the loop config from the environment (defaults are the safe posture). */
export function resolveStrategyLoopConfig(
  env: NodeJS.ProcessEnv = process.env,
): StrategyLoopConfig {
  return {
    // DEFAULT OFF — the loop stays inert until explicitly enabled + reviewed.
    enabled: boolEnv(env, "VEX_STRATEGY_AUTOTUNE_ENABLED", false),
    // DEFAULT OFF — propose-then-approve is the safe posture for real money.
    autoApprove: boolEnv(env, "VEX_STRATEGY_AUTOTUNE_AUTO_APPROVE", false),
    recentMissionWindow: Math.max(
      1,
      Math.floor(numEnv(env, "VEX_STRATEGY_RECENT_WINDOW", 8)),
    ),
    guardrails: {
      recurrenceMin: Math.max(
        1,
        Math.floor(
          numEnv(
            env,
            "VEX_STRATEGY_RECURRENCE_MIN",
            DEFAULT_GUARDRAIL_CONFIG.recurrenceMin,
          ),
        ),
      ),
      maxDeltaRatio: numEnv(
        env,
        "VEX_STRATEGY_MAX_DELTA_RATIO",
        DEFAULT_GUARDRAIL_CONFIG.maxDeltaRatio,
      ),
      maxBaselineDistanceRatio: numEnv(
        env,
        "VEX_STRATEGY_MAX_BASELINE_DISTANCE",
        DEFAULT_GUARDRAIL_CONFIG.maxBaselineDistanceRatio,
      ),
      flipFlopWindow: Math.max(
        1,
        Math.floor(
          numEnv(
            env,
            "VEX_STRATEGY_FLIPFLOP_WINDOW",
            DEFAULT_GUARDRAIL_CONFIG.flipFlopWindow,
          ),
        ),
      ),
    },
  };
}
