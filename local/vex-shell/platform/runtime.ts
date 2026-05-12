/**
 * Runtime singletons + process-lifetime hooks for the local shell.
 *
 * `startWakeExecutor()` (src/vex-agent/engine/wake/executor.ts) has no
 * built-in re-entry guard — calling it twice spins up two timer loops in the
 * same process. The shell holds exactly one handle and exposes idempotent
 * `enableWake()` / `disableWake()` toggles so the operator can flip wake on
 * and off without leaking timers on hot-reload (`tsx` watcher) or SIGINT.
 */

import { startWakeExecutor, type WakeExecutorHandle } from "@vex-agent/engine/wake/executor.js";
import { startSyncExecutor, type SyncExecutorHandle } from "@vex-agent/sync/executor.js";
import { runtimeLog } from "./log.js";

export interface WakeEnableOptions {
  intervalMs?: number;
  batchSize?: number;
}

let handle: WakeExecutorHandle | null = null;
let syncHandle: SyncExecutorHandle | null = null;
let shutdownInstalled = false;
const shutdownTasks: Array<() => Promise<void> | void> = [];

export function isWakeEnabled(): boolean {
  return handle !== null;
}

export function isSyncEnabled(): boolean {
  return syncHandle !== null;
}

/**
 * Start the wake executor singleton. Idempotent — subsequent calls are
 * no-ops (the first `options` wins). To change `intervalMs` / `batchSize`
 * at runtime call `disableWake()` first.
 */
export function enableWake(options: WakeEnableOptions = {}): void {
  if (handle) return;
  handle = startWakeExecutor(options);
}

export async function disableWake(): Promise<void> {
  if (!handle) return;
  const current = handle;
  handle = null;
  await current.stop();
}

/**
 * Start the portfolio sync executor singleton. Idempotent — local shell uses
 * this only after bootstrap succeeds so short readiness probes do not create
 * background loops.
 */
export function enableSync(): void {
  if (syncHandle) return;
  syncHandle = startSyncExecutor();
}

export async function disableSync(): Promise<void> {
  if (!syncHandle) return;
  const current = syncHandle;
  syncHandle = null;
  await current.stop();
}

/**
 * Register a callback to run before the shell exits. Used by the shell loop
 * to release readline, close DB pool, etc. Tasks run sequentially in
 * registration order; failures are logged to stderr but do not block the
 * remaining tasks.
 */
export function onShutdown(task: () => Promise<void> | void): void {
  shutdownTasks.push(task);
}

export async function runShutdown(): Promise<void> {
  await disableWake();
  await disableSync();
  for (const task of shutdownTasks) {
    try {
      await task();
    } catch (err) {
      runtimeLog.error("shutdown.task_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

export function installSignalHandlers(): void {
  if (shutdownInstalled) return;
  shutdownInstalled = true;

  const handler = (signal: NodeJS.Signals) => {
    runtimeLog.warn("signal.received", { signal });
    runShutdown().finally(() => process.exit(0));
  };

  process.once("SIGINT", handler);
  process.once("SIGTERM", handler);
}
