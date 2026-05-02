/** Cooldown after a noop so a stuck session doesn't re-enter the same path every turn. */
const NOOP_COOLDOWN_MS = 5 * 60 * 1000;

/**
 * Cooldown for the Phase 0 forced handoff pass. 60s prevents a token_count
 * re-trigger loop while still allowing quick recovery when the handoff lands.
 */
const FORCED_HANDOFF_COOLDOWN_MS = 60 * 1000;

/**
 * In-memory cooldown map - process-lifetime only. Sessions landing in `noop`
 * get a 5-min back-off to prevent infinite retry.
 */
const noopCooldownUntil = new Map<string, number>();

/**
 * Per-session cooldown for the forced handoff pass. Matches `noopCooldownUntil`
 * semantics: process-lifetime only, cleared on restart.
 */
const forcedPassCooldownUntil = new Map<string, number>();

/**
 * Per-session serialization for `executeCheckpoint`. Process-local mutex -
 * single-process wake executor contract plus the Phase II row lock is enough
 * for current runtime topology.
 */
const checkpointInFlight = new Map<string, Promise<void>>();

export async function withCheckpointMutex<T>(
  sessionId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const prev = checkpointInFlight.get(sessionId) ?? Promise.resolve();

  let resolveCurrent!: () => void;
  const current = new Promise<void>((resolve) => { resolveCurrent = resolve; });
  const chained = prev.then(() => current);
  checkpointInFlight.set(sessionId, chained);

  try {
    await prev;
    return await fn();
  } finally {
    resolveCurrent();
    // Tail cleanup - only remove if no later caller has chained behind us.
    if (checkpointInFlight.get(sessionId) === chained) {
      checkpointInFlight.delete(sessionId);
    }
  }
}

export function getNoopCooldownUntil(sessionId: string): number | undefined {
  return noopCooldownUntil.get(sessionId);
}

export function markNoopCooldown(sessionId: string): void {
  noopCooldownUntil.set(sessionId, Date.now() + NOOP_COOLDOWN_MS);
}

export function clearNoopCooldown(sessionId: string): void {
  noopCooldownUntil.delete(sessionId);
}

export function getForcedPassCooldownUntil(sessionId: string): number | undefined {
  return forcedPassCooldownUntil.get(sessionId);
}

export function markForcedPassCooldown(sessionId: string): void {
  forcedPassCooldownUntil.set(sessionId, Date.now() + FORCED_HANDOFF_COOLDOWN_MS);
}

export function resetCheckpointCooldownsForTests(): void {
  noopCooldownUntil.clear();
  forcedPassCooldownUntil.clear();
}

export function getForcedPassCooldownForTests(sessionId: string): number | undefined {
  return forcedPassCooldownUntil.get(sessionId);
}

export function resetCheckpointMutexForTests(): void {
  checkpointInFlight.clear();
}
