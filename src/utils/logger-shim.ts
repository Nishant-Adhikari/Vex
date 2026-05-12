/**
 * Pure, dependency-free logger shim used by the wallet + config primitives
 * that vex-app pulls via the `@vex-lib/wallet` cross-boundary bridge.
 *
 * Why this exists:
 *   `src/utils/logger.ts` imports `winston`, which transitively imports
 *   `@colors/colors` whose `supports-colors.js` calls `os.release()` at
 *   module-init. When Vite bundles `@vex-lib/wallet` for the Electron
 *   main process, it cannot prune that side-effecting init and the call
 *   resolves through a `__vite-browser-external` stub on Windows → crash
 *   at startup (`TypeError: os.release is not a function`).
 *
 *   Splitting the wallet / config helpers off the winston import chain
 *   restores skill §1 + §3 bridge purity (no fs-or-DB-or-heavy-dep
 *   imports from cross-boundary code). vex-shell's top-level CLI code
 *   keeps using full winston via `src/utils/logger.ts`; this shim is
 *   only for primitives shared across boundaries.
 *
 * Output contract:
 *   - All log lines go to `process.stderr` so stdout stays free for
 *     machine-readable agent output (matches winston transport above).
 *   - `debug` is silent unless `LOG_LEVEL=debug`.
 *   - `warn` and `error` always emit.
 *   - Single-line format `level: message [meta-as-json]`.
 */

import type { Writable } from "node:stream";

export interface MinLogger {
  debug(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

function emit(
  stream: Writable,
  level: "debug" | "warn" | "error",
  msg: string,
  meta?: Record<string, unknown>,
): void {
  const metaStr =
    meta && Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : "";
  stream.write(`${level}: ${msg}${metaStr}\n`);
}

const debugEnabled = (process.env.LOG_LEVEL ?? "info").toLowerCase() === "debug";

export const minLogger: MinLogger = {
  debug(msg, meta) {
    if (debugEnabled) emit(process.stderr, "debug", msg, meta);
  },
  warn(msg, meta) {
    emit(process.stderr, "warn", msg, meta);
  },
  error(msg, meta) {
    emit(process.stderr, "error", msg, meta);
  },
};
