/**
 * Overnight self-heal — pure policy primitives (no DB / no engine imports).
 *
 * These are the deadline-bounded, kill-switched, bounded-backoff rules the
 * self-heal watchdog (OV2 provider-outage recovery + OV3 paused_wake stall
 * recovery) consults. Kept import-free so both the watchdog and the wake-side
 * claim can share them without pulling a DB-heavy graph.
 *
 * Composition with the existing Phase 4d auto-retry (`mission-auto-retry.ts`):
 *   - Phase 4d handles the FIRST ~5 retries on a SECONDS-scale backoff, but
 *     only for missions that OPTED IN (`autoRetryEnabled`) and only up to
 *     `MAX_AUTO_RETRIES`. A provider blip longer than ~1 min exhausts it.
 *   - This layer takes over on a MINUTES-scale ladder, is DEFAULT-ON for any
 *     unattended full-mode mission (behind `AGENT_SELF_HEAL_ENABLED`), and
 *     keeps re-arming until the mission DEADLINE / cost cap / an absolute
 *     attempt ceiling — reusing the SAME durable `error_retry_count` epoch and
 *     the SAME wake machinery, so the two never double-fire (the watchdog
 *     defers whenever a retry wake is already pending).
 */

/** Wake-payload trigger that routes the executor to the self-heal claim. */
export const SELF_HEAL_WAKE_TRIGGER = "self_heal_retry" as const;

/**
 * Minutes-scale re-arm ladder (ms): 1m → 2m → 5m → 10m → 15m, then capped at
 * 15m for every subsequent attempt. Deliberately coarse — a provider outage is
 * minutes-to-hours, and a tight loop would burn the token/cost budget for
 * nothing while the provider is down.
 */
export const SELF_HEAL_BACKOFF_LADDER_MS: readonly number[] = [
  60_000, // 1m
  120_000, // 2m
  300_000, // 5m
  600_000, // 10m
  900_000, // 15m
];

/**
 * After this many consecutive prior failures (the durable `error_retry_count`),
 * a scheduled self-heal attempt fails over from the primary model to the
 * configured backup (`AGENT_MODEL_FALLBACK`). Below it, stay on the primary.
 */
export const SELF_HEAL_FAILOVER_THRESHOLD = 2;

/**
 * Absolute ceiling on self-heal retry epochs, a defense-in-depth backstop
 * BENEATH the mission deadline (the deadline is the real bound; on a 1h mission
 * the ladder yields ~10–15 attempts, well under this). Past it the watchdog
 * stops re-arming and leaves the run `paused_error` for the abandoned-run reaper
 * / a human — it never spins unbounded.
 */
export const MAX_SELF_HEAL_ATTEMPTS = 40;

/** Bounded OV3 paused_wake resume attempts before the run is finalized. */
export const MAX_WAKE_STALL_ATTEMPTS = 3;

/**
 * A paused_wake run is only treated as STALLED once its scheduled wake is this
 * far overdue (or, with no wake row, its last checkpoint is this stale). The
 * margin keeps the watchdog off freshly-parked runs the wake executor is about
 * to service on its own 2s cadence.
 */
export const WAKE_STALL_MARGIN_MS = 5 * 60_000; // 5m

/** Default watchdog tick cadence. Minutes-scale — this is not a hot loop. */
export const SELF_HEAL_TICK_INTERVAL_MS = 60_000; // 1m

/**
 * KILL SWITCH. Self-heal is DEFAULT-ON; only an explicit, case-insensitive
 * `"false"` / `"0"` / `"off"` / `"no"` in `AGENT_SELF_HEAL_ENABLED` disables it,
 * reverting to today's park-and-wait behaviour (the run stays `paused_error` /
 * `paused_wake` for a human). Fail-open: any unset/unrecognized value is ON.
 */
export function selfHealEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const raw = env.AGENT_SELF_HEAL_ENABLED;
  if (raw === undefined) return true;
  const v = raw.trim().toLowerCase();
  if (v === "false" || v === "0" || v === "off" || v === "no") return false;
  return true;
}

/**
 * The configured backup model for failover, or `null` when none is set (in
 * which case failover is a no-op and the watchdog keeps retrying the primary).
 */
export function resolveFallbackModel(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const raw = env.AGENT_MODEL_FALLBACK;
  if (raw === undefined) return null;
  const v = raw.trim();
  return v.length > 0 ? v : null;
}

/**
 * Backoff (ms) for the self-heal attempt at 0-based ladder index `attemptIndex`
 * (the PRE-increment `error_retry_count`), clamped into the ladder and capped
 * at its last rung.
 */
export function selfHealBackoffMs(attemptIndex: number): number {
  const i = Number.isFinite(attemptIndex) && attemptIndex > 0 ? Math.floor(attemptIndex) : 0;
  const clamped = Math.min(i, SELF_HEAL_BACKOFF_LADDER_MS.length - 1);
  // `?? 60_000` satisfies `noUncheckedIndexedAccess`; `clamped` is always a
  // valid ladder index so the fallback is unreachable.
  return SELF_HEAL_BACKOFF_LADDER_MS[clamped] ?? 60_000;
}

/**
 * Whether a scheduled attempt at `priorFailures` (pre-increment
 * `error_retry_count`) should fail over to the backup model — only when a
 * backup is actually configured.
 */
export function shouldFailover(
  priorFailures: number,
  hasFallback: boolean,
  threshold: number = SELF_HEAL_FAILOVER_THRESHOLD,
): boolean {
  return hasFallback && Number.isFinite(priorFailures) && priorFailures >= threshold;
}

/**
 * Read the mission's structured box duration (minutes) out of a frozen contract
 * snapshot — `frozenMission.constraintsJson.durationMinutes`. Returns `null`
 * when absent / malformed, so the deadline resolver falls back to the env /
 * default box. Mirrors `snapshotAutoRetryEnabled`'s defensive descent.
 */
export function snapshotDurationMinutes(
  snapshot: Record<string, unknown> | null | undefined,
): number | null {
  if (snapshot === null || snapshot === undefined || typeof snapshot !== "object") {
    return null;
  }
  const frozen = (snapshot as Record<string, unknown>).frozenMission;
  if (frozen === null || frozen === undefined || typeof frozen !== "object") {
    return null;
  }
  const constraints = (frozen as Record<string, unknown>).constraintsJson;
  if (
    constraints === null ||
    constraints === undefined ||
    typeof constraints !== "object"
  ) {
    return null;
  }
  const raw = (constraints as Record<string, unknown>).durationMinutes;
  return typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? raw : null;
}

/**
 * Read the durable transient/permanent classification stamped into
 * `stop_evidence_json.classified` at pause time by
 * `persistErrorPauseWithMaybeAutoRetry` (the SAME `classifyMissionRunError`
 * verdict the fast auto-retry used). `stop_evidence_json` is REWRITTEN on every
 * re-pause, so this field is present + fresh on every `paused_error` row.
 * FAIL-CLOSED: a missing / malformed / non-"transient" value yields `false`, so
 * a run whose error was permanent (or unclassified) is NEVER auto-recovered.
 */
export function evidenceIsTransient(
  evidence: Record<string, unknown> | null | undefined,
): boolean {
  if (evidence === null || evidence === undefined || typeof evidence !== "object") {
    return false;
  }
  return (evidence as Record<string, unknown>).classified === "transient";
}
