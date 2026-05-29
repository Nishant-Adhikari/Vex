/**
 * In-process unlock backoff gate for the secrets vault.
 *
 * Scrypt N=2^17 (131072) protects the at-rest vault, but a process-resident attacker
 * could still attempt rapid in-memory unlocks. This module rate-limits the
 * `vex:secrets:unlock` IPC handler with an exponential-ish backoff that ramps
 * quickly toward a 5-minute lockout, on top of single-user desktop semantics
 * (no per-IP keying needed).
 *
 * Module state is local to the main process; it resets on every relaunch.
 */

/**
 * Backoff table indexed by the failed-attempt count AFTER recording the
 * current failure. Index 0 is unused (success path resets the counter).
 *   1 → 1s, 2 → 2s, 3 → 4s, 4 → 8s, 5..9 → 30s, 10+ → 300s (5 min).
 */
const BACKOFF_MS: Readonly<Record<number, number>> = Object.freeze({
  1: 1_000,
  2: 2_000,
  3: 4_000,
  4: 8_000,
  5: 30_000,
  10: 300_000,
});

function backoffForAttempt(attempt: number): number {
  if (attempt <= 0) return 0;
  if (attempt >= 10) return BACKOFF_MS[10] ?? 300_000;
  if (attempt >= 5) return BACKOFF_MS[5] ?? 30_000;
  return BACKOFF_MS[attempt] ?? 0;
}

let failedAttempts = 0;
let nextAllowedAtMs = 0;

export type UnlockGate =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly retryAfterMs: number };

/**
 * Snapshot of the throttle gate without mutating any counters. Returns the
 * remaining backoff in milliseconds when locked out.
 */
export function checkUnlockAllowed(): UnlockGate {
  const now = Date.now();
  if (now >= nextAllowedAtMs) return { allowed: true };
  return { allowed: false, retryAfterMs: nextAllowedAtMs - now };
}

/**
 * Bump the failed-attempt counter and arm the backoff window. Call ONLY for
 * wrong-password failures — IO / corrupt-file errors must NOT advance the
 * counter (an unreadable vault is not an attacker signal).
 */
export function recordUnlockFailure(): void {
  failedAttempts += 1;
  const backoff = backoffForAttempt(failedAttempts);
  nextAllowedAtMs = Date.now() + backoff;
}

/**
 * Reset on successful unlock — the user proved knowledge of the password so
 * any prior failures were either typos or stale state.
 */
export function recordUnlockSuccess(): void {
  failedAttempts = 0;
  nextAllowedAtMs = 0;
}

/**
 * Test-only helper. The module otherwise has no public way to reset state
 * mid-process (the throttle is intentionally sticky across renderer reloads).
 */
export function resetUnlockThrottle(): void {
  failedAttempts = 0;
  nextAllowedAtMs = 0;
}
