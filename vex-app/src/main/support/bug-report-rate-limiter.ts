/**
 * Main-side rate limiter for agent bug reports (puzzle 03, Phase 2).
 *
 * Sliding window, in-memory, bounded LRU. Lives in vex-app/main because
 * (a) it's a single-process Electron app — no need for a distributed
 * limiter; (b) the limiter must be on the same side as the sink it
 * gates, so the engine-side `getBugReportSink()` only ever sees a sink
 * that has already accounted for its quota.
 *
 * Key composition (codex acceptance criterion: keys computed AFTER
 * redaction): `category + ":" + (correlationId || "anon") + ":" +
 * stableHash(refs.sessionId + refs.toolName + refs.protocolNamespace
 * + title.slice(0, 80))`. Title is taken from the already-redacted
 * input the sink received — secrets never enter the key material.
 *
 * Default: 5 admits per 60s per key. Beyond that, `tryAdmit` returns
 * `false` and the sink returns without dispatching to
 * `createBugReport`. The drop counter is exposed for telemetry /
 * tests; the limiter does not throw, so a hot loop emitting the same
 * category cannot break runtime.
 *
 * LRU cap: 1024 keys. Eviction is access-order: when the map exceeds
 * the cap, the oldest key (least recently inserted/touched) is dropped.
 * In practice the keyspace is bounded by category × correlationId, so
 * 1024 covers a long-running session without forcing eviction.
 */

import { createHash } from "node:crypto";

export const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000;
export const DEFAULT_RATE_LIMIT_MAX = 5;
export const DEFAULT_RATE_LIMIT_LRU_CAP = 1024;

export interface RateLimiterOptions {
  readonly windowMs?: number;
  readonly maxPerWindow?: number;
  readonly lruCap?: number;
  /** Override for tests so fake timers can drive the window. */
  readonly now?: () => number;
}

export interface RateLimiterKeyInput {
  readonly category: string;
  readonly correlationId?: string | null;
  readonly sessionId?: string | null;
  readonly toolName?: string | null;
  readonly protocolNamespace?: string | null;
  readonly redactedTitle: string;
}

export interface RateLimiter {
  /** Returns `true` if the report is admitted (and accounted), `false` if rate-limited. */
  tryAdmit(key: RateLimiterKeyInput): boolean;
  /** Test helper — total reports dropped since process start. */
  droppedCount(): number;
  /** Test helper — number of keys currently held. */
  size(): number;
  /** Test helper — clear state. */
  reset(): void;
}

function stableHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function buildKey(input: RateLimiterKeyInput): string {
  const contextSummary = [
    input.sessionId ?? "",
    input.toolName ?? "",
    input.protocolNamespace ?? "",
    input.redactedTitle.slice(0, 80),
  ].join("|");
  const corr = input.correlationId ?? "anon";
  return `${input.category}:${corr}:${stableHash(contextSummary)}`;
}

export function createBugReportRateLimiter(
  options: RateLimiterOptions = {},
): RateLimiter {
  const windowMs = options.windowMs ?? DEFAULT_RATE_LIMIT_WINDOW_MS;
  const maxPerWindow = options.maxPerWindow ?? DEFAULT_RATE_LIMIT_MAX;
  const lruCap = options.lruCap ?? DEFAULT_RATE_LIMIT_LRU_CAP;
  const now = options.now ?? Date.now;

  /**
   * Map<key, deque-of-admit-timestamps>. JS Map preserves insertion
   * order — promoting a key on use means deleting + re-inserting, and
   * eviction always pulls the oldest by `keys()` iteration.
   */
  const buckets = new Map<string, number[]>();
  let dropped = 0;

  function evictIfOverCap(): void {
    while (buckets.size > lruCap) {
      const oldestKey = buckets.keys().next().value;
      if (oldestKey === undefined) break;
      buckets.delete(oldestKey);
    }
  }

  function prune(timestamps: number[], cutoff: number): number[] {
    // Drop entries older than cutoff. Timestamps are appended in time
    // order so we can short-circuit at the first in-window value.
    let cutIdx = 0;
    while (cutIdx < timestamps.length && (timestamps[cutIdx] ?? 0) < cutoff) {
      cutIdx++;
    }
    return cutIdx === 0 ? timestamps : timestamps.slice(cutIdx);
  }

  return {
    tryAdmit(input: RateLimiterKeyInput): boolean {
      const key = buildKey(input);
      const t = now();
      const cutoff = t - windowMs;

      const existing = buckets.get(key);
      const pruned = existing ? prune(existing, cutoff) : [];

      if (pruned.length >= maxPerWindow) {
        // Keep the pruned bucket so eviction can re-rank by recent access.
        buckets.delete(key);
        buckets.set(key, pruned);
        dropped += 1;
        return false;
      }

      pruned.push(t);
      buckets.delete(key);
      buckets.set(key, pruned);
      evictIfOverCap();
      return true;
    },
    droppedCount(): number {
      return dropped;
    },
    size(): number {
      return buckets.size;
    },
    reset(): void {
      buckets.clear();
      dropped = 0;
    },
  };
}
