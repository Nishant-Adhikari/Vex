/**
 * Shell-local logger — thin wrapper around `createChildLogger` so cold-start
 * stages, provider flow, sessions, commands and runtime hooks share a tagged
 * logger and a consistent `durationMs` timing helper.
 *
 * All logging starts at `src/utils/logger.ts` (winston, stderr). This module
 * stamps `component: "vex-shell"` and owns the temporary TUI log sink used
 * while Ink controls the terminal frame.
 */

import { createWriteStream, mkdirSync } from "node:fs";
import { Writable } from "node:stream";
import { join } from "node:path";
import winston from "winston";
import logger, { createChildLogger } from "../../../src/utils/logger.js";
import { LOCAL_DEBUG_DIR } from "./local-paths.js";

export const SHELL_LOG_FILE = join(LOCAL_DEBUG_DIR, "vex-shell.log");
const TUI_LOG_RING_LIMIT = 200;

const recentTuiLogLines: string[] = [];
const root = createChildLogger({ component: "vex-shell" });
let activeTuiLogRestore: (() => void) | null = null;

export const bootstrapLog = root.child({ stage: "bootstrap" });
export const providerLog = root.child({ stage: "provider" });
export const servicesLog = root.child({ stage: "services" });
export const sessionLog = root.child({ stage: "session" });
export const commandsLog = root.child({ stage: "commands" });
export const runtimeLog = root.child({ stage: "runtime" });
export const diagnosticsLog = root.child({ stage: "diagnostics" });

class RingBufferLogStream extends Writable {
  override _write(
    chunk: Buffer | string,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
    for (const line of text.split(/\r?\n/)) {
      if (!line) continue;
      recentTuiLogLines.push(line);
      while (recentTuiLogLines.length > TUI_LOG_RING_LIMIT) {
        recentTuiLogLines.shift();
      }
    }
    callback();
  }
}

export function getRecentTuiLogLines(limit = 8): readonly string[] {
  return recentTuiLogLines.slice(-Math.max(0, limit));
}

/**
 * While Ink owns the alternate screen, direct stderr logs corrupt the frame.
 * Swap winston to a file + ring-buffer sink and restore the original transports
 * after Ink exits.
 */
export function activateTuiLogSink(): () => void {
  if (activeTuiLogRestore) return activeTuiLogRestore;

  mkdirSync(LOCAL_DEBUG_DIR, { recursive: true });

  const previousTransports = [...logger.transports];
  const fileStream = createWriteStream(SHELL_LOG_FILE, { flags: "a" });
  const ringStream = new RingBufferLogStream();
  const fileTransport = new winston.transports.Stream({ stream: fileStream });
  const ringTransport = new winston.transports.Stream({ stream: ringStream });

  logger.clear();
  logger.add(fileTransport);
  logger.add(ringTransport);

  let restored = false;
  activeTuiLogRestore = () => {
    if (restored) return;
    restored = true;
    logger.clear();
    fileStream.end();
    ringStream.end();
    for (const transport of previousTransports) {
      logger.add(transport);
    }
    activeTuiLogRestore = null;
  };

  runtimeLog.info("tui.log_sink.active", { file: SHELL_LOG_FILE });
  return activeTuiLogRestore;
}

/**
 * Time an async block. Logs `<event>.start` and `<event>.completed` with
 * `durationMs`, plus `<event>.failed` on throw. Returns the inner result so
 * the call site stays one-liner-friendly.
 */
export async function withTiming<T>(
  log: winston.Logger,
  event: string,
  fn: () => Promise<T>,
  meta: Record<string, string | number | undefined> = {},
): Promise<T> {
  const startedAt = Date.now();
  log.info(`${event}.start`, meta);
  try {
    const result = await fn();
    log.info(`${event}.completed`, { ...meta, durationMs: Date.now() - startedAt });
    return result;
  } catch (err) {
    log.error(`${event}.failed`, {
      ...meta,
      durationMs: Date.now() - startedAt,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/**
 * Synchronous variant — useful for non-promise stages (e.g. spawn-based
 * `startLocalServices`) where wrapping in `async` would obscure the call.
 */
export function withTimingSync<T>(
  log: winston.Logger,
  event: string,
  fn: () => T,
  meta: Record<string, string | number | undefined> = {},
): T {
  const startedAt = Date.now();
  log.info(`${event}.start`, meta);
  try {
    const result = fn();
    log.info(`${event}.completed`, { ...meta, durationMs: Date.now() - startedAt });
    return result;
  } catch (err) {
    log.error(`${event}.failed`, {
      ...meta,
      durationMs: Date.now() - startedAt,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
