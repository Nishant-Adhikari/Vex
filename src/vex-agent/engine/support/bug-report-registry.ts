/**
 * Engine-side `BugReportSink` registry (puzzle 03).
 *
 * Singleton getter/setter mirrors the `transcriptEventBus` pattern from
 * puzzle 02 — engine emit points read through `getBugReportSink()` so
 * the wiring is identical across all 5+ emit sites. The vex-app main
 * process calls `setBugReportSink(productionSink)` once at
 * `setupAgentBridges()` boot; tests inject their own spy with
 * `setBugReportSink(spy)` and reset with `resetBugReportSink()` in
 * `afterEach`.
 *
 * The default is `noopBugReportSink` from `@vex-lib/diagnostics/bug-report-sink`
 * — engine code stays inert until the vex-app boot mounts the real one.
 */

import {
  noopBugReportSink,
  type BugReportSink,
} from "../../../lib/diagnostics/bug-report-sink.js";

let currentSink: BugReportSink = noopBugReportSink;

/** Read the currently-installed sink. Engine emit points call this. */
export function getBugReportSink(): BugReportSink {
  return currentSink;
}

/** Install a production sink. Idempotent — last writer wins. */
export function setBugReportSink(sink: BugReportSink): void {
  currentSink = sink;
}

/** Restore the no-op default. Tests use this in `afterEach`. */
export function resetBugReportSink(): void {
  currentSink = noopBugReportSink;
}
