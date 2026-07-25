/**
 * Resolve the ACTIVE adaptive-strategy tactics for a mission slice.
 *
 * Called at slice start (fresh start, resume, renew) to pin the currently-active
 * `strategy_versions` row into the mission prompt. FULLY FAIL-SOFT: if the DB is
 * unavailable or no row is active, it seeds/returns the human baseline constant
 * so a mission can ALWAYS run — a strategy-store hiccup must never block trading.
 *
 * The IMMUTABLE safety core is rendered separately from source and does NOT
 * depend on this value.
 */

import {
  getActiveVersion,
  ensureBaseline,
} from "@vex-agent/db/repos/strategy-versions.js";
import { ADAPTIVE_STRATEGY_BASELINE } from "../prompts/mission-adaptive.js";
import logger from "@utils/logger.js";

/** The active adaptive tactics content, or the baseline seed (never throws). */
export async function loadActiveAdaptiveStrategy(): Promise<string> {
  try {
    const active = await getActiveVersion();
    if (active !== null) return active.content;
    // Nothing active yet — seed the baseline (idempotent) and run under it.
    const baseline = await ensureBaseline(ADAPTIVE_STRATEGY_BASELINE);
    return baseline.content;
  } catch (err) {
    logger.warn("engine.mission.adaptive_load_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return ADAPTIVE_STRATEGY_BASELINE;
  }
}
