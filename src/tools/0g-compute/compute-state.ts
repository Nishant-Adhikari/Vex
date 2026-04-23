/**
 * Persistence layer for the active 0G Compute provider selection.
 *
 * Split out of `readiness.ts` so startup paths that only need to read/write
 * the JSON state (provider registry, inference provider, vex-shell) do not
 * transitively load `broker-factory.ts` and the 0G SDK.
 */

import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { ZG_COMPUTE_DIR, ZG_COMPUTE_STATE_FILE } from "./constants.js";
import logger from "../../utils/logger.js";

export interface ComputeState {
  activeProvider: string;
  model: string;
  configuredAt: number;
}

export function loadComputeState(): ComputeState | null {
  if (!existsSync(ZG_COMPUTE_STATE_FILE)) return null;
  try {
    const raw = readFileSync(ZG_COMPUTE_STATE_FILE, "utf-8");
    const parsed = JSON.parse(raw) as Partial<ComputeState>;
    if (typeof parsed.activeProvider !== "string" || !parsed.activeProvider) return null;
    return parsed as ComputeState;
  } catch {
    return null;
  }
}

export function saveComputeState(state: ComputeState): void {
  if (!existsSync(ZG_COMPUTE_DIR)) {
    mkdirSync(ZG_COMPUTE_DIR, { recursive: true });
  }
  const tmpFile = join(dirname(ZG_COMPUTE_STATE_FILE), `.compute-state.${Date.now()}.tmp`);
  writeFileSync(tmpFile, JSON.stringify(state, null, 2), "utf-8");
  renameSync(tmpFile, ZG_COMPUTE_STATE_FILE);
  logger.debug(`[0G Compute] State saved to ${ZG_COMPUTE_STATE_FILE}`);
}
