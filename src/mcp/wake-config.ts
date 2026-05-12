/**
 * Wake-executor runtime configuration parsing.
 *
 * Reads three env vars written by the vex-app M11 wizard:
 *   AGENT_WAKE_ENABLED       — "true" | "false" (defaults to true if absent;
 *                              backwards compat with pre-M11 MCP behaviour
 *                              where wake always started)
 *   AGENT_WAKE_INTERVAL_MS   — integer 60..60000 (defaults to undefined →
 *                              executor uses its own 2000ms default)
 *   AGENT_WAKE_BATCH_SIZE    — integer 1..100 (defaults to undefined →
 *                              executor uses its own 10 default)
 *
 * Invalid AGENT_WAKE_ENABLED values (anything other than the two literals)
 * fall back to enabled=true with a warning log; the operator's intent is
 * ambiguous and the safer default is "keep working as before".
 *
 * Invalid integer values for interval/batch fall back to undefined so the
 * executor's compile-time defaults take over. Surfacing a clear log helps
 * an operator see when their `.env` is being silently ignored.
 */

import logger from "@utils/logger.js";

const WAKE_INTERVAL_MIN = 60;
const WAKE_INTERVAL_MAX = 60_000;
const WAKE_BATCH_MIN = 1;
const WAKE_BATCH_MAX = 100;

export interface WakeRuntimeConfig {
  readonly enabled: boolean;
  readonly opts: { intervalMs?: number; batchSize?: number };
}

function parseEnabled(raw: string | undefined): boolean {
  if (raw === undefined) return true;
  const normalized = raw.trim().toLowerCase();
  if (normalized === "" || normalized === "true") return true;
  if (normalized === "false") return false;
  logger.warn("wake.config.invalid_enabled", {
    value: raw,
    fallback: "true",
  });
  return true;
}

function parseInteger(
  raw: string | undefined,
  field: "AGENT_WAKE_INTERVAL_MS" | "AGENT_WAKE_BATCH_SIZE",
  min: number,
  max: number,
): number | undefined {
  if (raw === undefined || raw.trim() === "") return undefined;
  const parsed = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    logger.warn("wake.config.invalid_integer", {
      field,
      value: raw,
      validRange: `${min}..${max}`,
      fallback: "executor default",
    });
    return undefined;
  }
  return parsed;
}

export function parseWakeRuntimeConfig(
  env: NodeJS.ProcessEnv,
): WakeRuntimeConfig {
  const enabled = parseEnabled(env["AGENT_WAKE_ENABLED"]);
  if (!enabled) {
    return { enabled: false, opts: {} };
  }
  const intervalMs = parseInteger(
    env["AGENT_WAKE_INTERVAL_MS"],
    "AGENT_WAKE_INTERVAL_MS",
    WAKE_INTERVAL_MIN,
    WAKE_INTERVAL_MAX,
  );
  const batchSize = parseInteger(
    env["AGENT_WAKE_BATCH_SIZE"],
    "AGENT_WAKE_BATCH_SIZE",
    WAKE_BATCH_MIN,
    WAKE_BATCH_MAX,
  );
  const opts: { intervalMs?: number; batchSize?: number } = {};
  if (intervalMs !== undefined) opts.intervalMs = intervalMs;
  if (batchSize !== undefined) opts.batchSize = batchSize;
  return { enabled: true, opts };
}
