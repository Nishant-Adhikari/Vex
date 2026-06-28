/**
 * Single source of truth for the renderer-visible update state (M13).
 *
 * Main owns `electron-updater`; the renderer only ever sees the sanitized
 * `UpdateStatus` cached here and broadcast on `EV.updater.status`. `setStatus`
 * re-validates with the shared schema (defense-in-depth) so a mapping bug can
 * never push an off-contract / unredacted shape across the IPC boundary.
 */

import { app } from "electron";
import { EV } from "@shared/ipc/channels.js";
import {
  updateStatusSchema,
  type UpdateStatus,
} from "@shared/schemas/updater.js";
import { broadcastToAllWindows } from "../lifecycle/broadcast.js";
import { log } from "../logger/index.js";

function resolveVersion(): string {
  try {
    return app.getVersion();
  } catch {
    return "0.0.0";
  }
}

let current: UpdateStatus = { kind: "idle", currentVersion: resolveVersion() };

/** Current app version — the `currentVersion` field on every status. */
export function currentVersion(): string {
  return resolveVersion();
}

/** Last-known status (what `getStatus()` returns; no network call). */
export function getCurrentStatus(): UpdateStatus {
  return current;
}

/** Validate, cache, and broadcast a status transition to all windows. */
export function setStatus(next: UpdateStatus): void {
  const parsed = updateStatusSchema.safeParse(next);
  if (!parsed.success) {
    log.error(
      "[updates] refused to set invalid UpdateStatus",
      parsed.error.format(),
    );
    return;
  }
  current = parsed.data;
  broadcastToAllWindows(EV.updater.status, parsed.data);
}

/** Test-only: reset the cache to idle. */
export function __resetStatusCacheForTests(): void {
  current = { kind: "idle", currentVersion: resolveVersion() };
}
